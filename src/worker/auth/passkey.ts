import { HTTPException } from "hono/http-exception";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64Url(value: Uint8Array): string {
	let binary = "";
	for (const byte of value) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function fromBase64Url(value: string): Uint8Array {
	if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw invalid("Invalid WebAuthn data");
	const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
	try {
		const binary = atob(padded);
		return Uint8Array.from(binary, (char) => char.charCodeAt(0));
	} catch {
		throw invalid("Invalid WebAuthn data");
	}
}

export function randomChallenge(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return toBase64Url(bytes);
}

export async function verifyClientData(
	encoded: string,
	expectedType: "webauthn.create" | "webauthn.get",
	challenge: string,
	expectedOrigins: string | readonly string[],
): Promise<Uint8Array> {
	const clientData = fromBase64Url(encoded);
	let parsed: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
	try {
		parsed = JSON.parse(decoder.decode(clientData)) as typeof parsed;
	} catch {
		throw invalid("Invalid WebAuthn client data");
	}
	const origins = typeof expectedOrigins === "string" ? [expectedOrigins] : expectedOrigins;
	if (
		parsed.type !== expectedType ||
		parsed.challenge !== challenge ||
		typeof parsed.origin !== "string" ||
		!origins.includes(parsed.origin) ||
		parsed.crossOrigin === true
	) {
		throw invalid("Passkey response did not match this sign-in request");
	}
	return clientData;
}

export async function rpIdHash(rpId: string): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(rpId)));
}

export async function verifyRegistration(
	attestationObject: string,
	rpId: string,
): Promise<{ credentialId: string; publicKey: string; signCount: number }> {
	const decoded = decodeCbor(fromBase64Url(attestationObject)).value;
	if (!(decoded instanceof Map) || decoded.get("fmt") !== "none") {
		// We explicitly ask for "none" attestation, so accepting a certificate chain
		// without validating it would be less safe than rejecting it.
		throw invalid("Unsupported passkey attestation");
	}
	const authData = decoded.get("authData");
	if (!(authData instanceof Uint8Array)) throw invalid("Invalid passkey attestation");
	const parsed = await parseAuthenticatorData(authData, rpId, true);
	if (!parsed.credentialId || !parsed.publicKey) throw invalid("Passkey did not provide a credential");
	return { credentialId: toBase64Url(parsed.credentialId), publicKey: parsed.publicKey, signCount: parsed.signCount };
}

export async function verifyAuthentication(
	authenticatorData: string,
	clientDataJSON: Uint8Array,
	signature: string,
	publicKey: string,
	rpId: string,
): Promise<number> {
	const authData = fromBase64Url(authenticatorData);
	const parsed = await parseAuthenticatorData(authData, rpId, false);
	const key = await crypto.subtle.importKey(
		"raw",
		fromBase64Url(publicKey),
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["verify"],
	);
	const clientHash = new Uint8Array(await crypto.subtle.digest("SHA-256", clientDataJSON));
	const signed = new Uint8Array(authData.length + clientHash.length);
	signed.set(authData);
	signed.set(clientHash, authData.length);
	const ok = await crypto.subtle.verify(
		{ name: "ECDSA", hash: "SHA-256" },
		key,
		derEcdsaToRaw(fromBase64Url(signature), 32),
		signed,
	);
	if (!ok) throw invalid("Passkey signature could not be verified");
	return parsed.signCount;
}

async function parseAuthenticatorData(
	data: Uint8Array,
	rpId: string,
	expectCredential: boolean,
): Promise<{ signCount: number; credentialId?: Uint8Array; publicKey?: string }> {
	if (data.length < 37) throw invalid("Invalid authenticator data");
	const expectedRpIdHash = await rpIdHash(rpId);
	if (!equal(data.slice(0, 32), expectedRpIdHash)) throw invalid("Passkey is for a different site");
	const flags = data[32];
	// User presence and verification are both required for a passwordless sign-in.
	if ((flags & 0x05) !== 0x05) throw invalid("Passkey user verification was not completed");
	const signCount = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(33, false);
	if (!expectCredential) return { signCount };
	if ((flags & 0x40) === 0) throw invalid("Passkey did not include credential data");
	if (data.length < 55) throw invalid("Invalid credential data");
	const credentialLength = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(53, false);
	const credentialStart = 55;
	const credentialEnd = credentialStart + credentialLength;
	if (credentialEnd >= data.length) throw invalid("Invalid credential data");
	const cose = decodeCbor(data.slice(credentialEnd)).value;
	const publicKey = coseToP256(cose);
	return { signCount, credentialId: data.slice(credentialStart, credentialEnd), publicKey };
}

function coseToP256(value: unknown): string {
	if (!(value instanceof Map) || value.get(1) !== 2 || value.get(3) !== -7 || value.get(-1) !== 1) {
		throw invalid("Unsupported passkey algorithm");
	}
	const x = value.get(-2);
	const y = value.get(-3);
	if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) {
		throw invalid("Invalid passkey public key");
	}
	const key = new Uint8Array(65);
	key[0] = 4;
	key.set(x, 1);
	key.set(y, 33);
	return toBase64Url(key);
}

function derEcdsaToRaw(der: Uint8Array, size: number): Uint8Array {
	if (der.length < 8 || der[0] !== 0x30) throw invalid("Invalid passkey signature");
	let offset = 1;
	const sequence = readDerLength(der, offset);
	offset = sequence.next;
	if (sequence.length !== der.length - offset) throw invalid("Invalid passkey signature");
	const r = readDerInteger(der, offset);
	const s = readDerInteger(der, r.next);
	if (s.next !== der.length || r.value.length > size + 1 || s.value.length > size + 1) throw invalid("Invalid passkey signature");
	const raw = new Uint8Array(size * 2);
	raw.set(r.value.slice(-size), size - Math.min(size, r.value.length));
	raw.set(s.value.slice(-size), raw.length - Math.min(size, s.value.length));
	return raw;
}

function readDerInteger(data: Uint8Array, offset: number): { value: Uint8Array; next: number } {
	if (data[offset] !== 2) throw invalid("Invalid passkey signature");
	const length = readDerLength(data, offset + 1);
	const end = length.next + length.length;
	if (length.length === 0 || end > data.length) throw invalid("Invalid passkey signature");
	return { value: data.slice(length.next, end), next: end };
}

function readDerLength(data: Uint8Array, offset: number): { length: number; next: number } {
	const first = data[offset];
	if (first === undefined) throw invalid("Invalid passkey signature");
	if (first < 128) return { length: first, next: offset + 1 };
	const bytes = first & 0x7f;
	if (bytes === 0 || bytes > 2 || offset + 1 + bytes > data.length) throw invalid("Invalid passkey signature");
	let length = 0;
	for (let index = 0; index < bytes; index++) length = (length << 8) | data[offset + 1 + index];
	return { length, next: offset + 1 + bytes };
}

type CborValue = string | number | Uint8Array | Map<CborValue, CborValue> | boolean | null;

function decodeCbor(data: Uint8Array, offset = 0): { value: CborValue; next: number } {
	if (offset >= data.length) throw invalid("Invalid CBOR data");
	const initial = data[offset++];
	const major = initial >> 5;
	const info = initial & 0x1f;
	const length = cborLength(data, offset, info);
	offset = length.next;
	if (major === 0) return { value: length.value, next: offset };
	if (major === 1) return { value: -1 - length.value, next: offset };
	if (major === 2 || major === 3) {
		const end = offset + length.value;
		if (end > data.length) throw invalid("Invalid CBOR data");
		const bytes = data.slice(offset, end);
		return { value: major === 2 ? bytes : decoder.decode(bytes), next: end };
	}
	if (major === 4) {
		const array: CborValue[] = [];
		for (let index = 0; index < length.value; index++) {
			const item = decodeCbor(data, offset);
			array.push(item.value);
			offset = item.next;
		}
		// None of the WebAuthn structures we read are CBOR arrays.
		throw invalid("Unexpected CBOR array");
	}
	if (major === 5) {
		const map = new Map<CborValue, CborValue>();
		for (let index = 0; index < length.value; index++) {
			const key = decodeCbor(data, offset);
			const value = decodeCbor(data, key.next);
			map.set(key.value, value.value);
			offset = value.next;
		}
		return { value: map, next: offset };
	}
	if (major === 7 && info === 20) return { value: false, next: offset };
	if (major === 7 && info === 21) return { value: true, next: offset };
	if (major === 7 && info === 22) return { value: null, next: offset };
	throw invalid("Unsupported CBOR data");
}

function cborLength(data: Uint8Array, offset: number, info: number): { value: number; next: number } {
	if (info < 24) return { value: info, next: offset };
	const bytes = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : 0;
	if (!bytes || offset + bytes > data.length) throw invalid("Invalid CBOR data");
	let value = 0;
	for (let index = 0; index < bytes; index++) value = value * 256 + data[offset + index];
	return { value, next: offset + bytes };
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
	if (left.length !== right.length) return false;
	let difference = 0;
	for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
	return difference === 0;
}

function invalid(message: string): HTTPException {
	return new HTTPException(400, { message });
}
