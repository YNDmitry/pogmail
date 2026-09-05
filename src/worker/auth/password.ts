/**
 * PBKDF2-SHA256 via WebCrypto. Workers has no argon2/bcrypt, and pulling one in as
 * WASM costs more startup time than the extra iterations buy in resistance here.
 */
const ITERATIONS = 210_000;
const KEY_BITS = 256;

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

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<ArrayBuffer> {
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
		"deriveBits",
	]);
	return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, KEY_BITS);
}

/** Returns `iterations:salt_b64:hash_b64`. */
export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const bits = await derive(password, salt, ITERATIONS);
	return `${ITERATIONS}:${toB64(salt)}:${toB64(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [iterationsRaw, saltB64, hashB64] = stored.split(":");
	if (!iterationsRaw || !saltB64 || !hashB64) return false;

	const iterations = Number(iterationsRaw);
	if (!Number.isFinite(iterations) || iterations <= 0) return false;

	const bits = await derive(password, fromB64(saltB64), iterations);
	return timingSafeEqual(new Uint8Array(bits), fromB64(hashB64));
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
	return diff === 0;
}

/** Tokens are stored only as their SHA-256, so a database leak cannot mint sessions. */
export async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
