/**
 * Envelope encryption for secrets Pogmail has to store and later replay to another
 * service — today only the GitHub token behind Administration → Overview.
 *
 * The key comes from `CF_TOKEN`, the secret this deployment already requires, so an
 * installation needs nothing new to keep a token safely. It is never used raw: a
 * random per-record salt and PBKDF2-SHA256 stretch it into an AES-GCM key, the same
 * construction (and the same 100k workerd ceiling) as `password.ts`. GCM
 * authenticates, so a row edited in the database fails to decrypt instead of
 * yielding altered bytes.
 *
 * The coupling is deliberate but real: rotating `CF_TOKEN` makes anything sealed
 * under the old one unreadable, and the caller is expected to ask for it again.
 */
const ITERATIONS = 100_000;
const PREFIX = "v1";

export class SecretKeyMissing extends Error {
	constructor() {
		super("CF_TOKEN is not configured, so secrets cannot be stored");
		this.name = "SecretKeyMissing";
	}
}

function toB64(bytes: ArrayBuffer | Uint8Array): string {
	const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let binary = "";
	for (const byte of view) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function fromB64(value: string): Uint8Array<ArrayBuffer> {
	const binary = atob(value);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
	return out;
}

async function deriveKey(
	secret: string,
	salt: Uint8Array<ArrayBuffer>,
	iterations: number,
): Promise<CryptoKey> {
	const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, [
		"deriveKey",
	]);

	return crypto.subtle.deriveKey(
		{ name: "PBKDF2", hash: "SHA-256", salt, iterations },
		material,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

/** Returns `v1:iterations:salt_b64:iv_b64:ciphertext_b64`. */
export async function encryptSecret(env: Env, value: string): Promise<string> {
	if (!env.CF_TOKEN) throw new SecretKeyMissing();

	const salt = crypto.getRandomValues(new Uint8Array(16));
	// GCM wants a 96-bit nonce, fresh for every message under the same key.
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await deriveKey(env.CF_TOKEN, salt, ITERATIONS);

	const sealed = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		new TextEncoder().encode(value),
	);

	return [PREFIX, ITERATIONS, toB64(salt), toB64(iv), toB64(sealed)].join(":");
}

/**
 * Null rather than a throw for anything that does not decrypt — a rotated `CF_TOKEN`
 * or a hand-edited row is an operator problem to report, not a 500.
 */
export async function decryptSecret(env: Env, stored: string): Promise<string | null> {
	if (!env.CF_TOKEN) throw new SecretKeyMissing();

	const [prefix, iterationsRaw, saltB64, ivB64, payloadB64] = stored.split(":");
	if (prefix !== PREFIX || !iterationsRaw || !saltB64 || !ivB64 || !payloadB64) return null;

	const iterations = Number(iterationsRaw);
	if (!Number.isFinite(iterations) || iterations <= 0 || iterations > ITERATIONS) return null;

	try {
		const key = await deriveKey(env.CF_TOKEN, fromB64(saltB64), iterations);

		const opened = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: fromB64(ivB64) },
			key,
			fromB64(payloadB64),
		);
		return new TextDecoder().decode(opened);
	} catch {
		// Wrong key, truncated payload, tampered ciphertext — all indistinguishable here.
		return null;
	}
}
