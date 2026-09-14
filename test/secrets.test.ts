import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
	decryptExternalAccountSecret,
	decryptSecret,
	encryptExternalAccountSecret,
	encryptSecret,
	SecretKeyMissing,
} from "@/worker/auth/secrets";

const withKey = (key: string | undefined) => ({ ...env, CF_TOKEN: key }) as Env;
const withExternalKey = (key: string | undefined) => ({ ...env, EXTERNAL_ACCOUNTS_ENCRYPTION_KEY: key }) as Env;

describe("secret envelope", () => {
	it("round-trips a stored token", async () => {
		const keyed = withKey("a passphrase");
		const sealed = await encryptSecret(keyed, "ghp_example");

		expect(sealed.startsWith("v1:")).toBe(true);
		expect(sealed).not.toContain("ghp_example");
		expect(await decryptSecret(keyed, sealed)).toBe("ghp_example");
	});

	it("gives nothing back under a rotated key", async () => {
		const sealed = await encryptSecret(withKey("first"), "ghp_example");
		expect(await decryptSecret(withKey("second"), sealed)).toBeNull();
	});

	it("refuses tampered ciphertext rather than returning altered bytes", async () => {
		const keyed = withKey("a passphrase");
		const sealed = await encryptSecret(keyed, "ghp_example");
		const [prefix, iterations, salt, iv, payload] = sealed.split(":");
		const flipped = `${payload?.slice(0, -2)}${payload?.endsWith("A") ? "B" : "A"}=`;

		expect(await decryptSecret(keyed, [prefix, iterations, salt, iv, flipped].join(":"))).toBeNull();
	});

	it("rejects a malformed row without throwing", async () => {
		expect(await decryptSecret(withKey("k"), "garbage")).toBeNull();
		expect(await decryptSecret(withKey("k"), "v2:1:a:b:c")).toBeNull();
	});

	it("says so when no key is configured", async () => {
		await expect(encryptSecret(withKey(undefined), "x")).rejects.toBeInstanceOf(SecretKeyMissing);
	});

	it("seals external credentials under an independent key", async () => {
		const sealed = await encryptExternalAccountSecret(withExternalKey("external-key"), "app-password");

		expect(sealed).not.toContain("app-password");
		expect(await decryptExternalAccountSecret(withExternalKey("external-key"), sealed)).toBe("app-password");
		// Rotating the Cloudflare API token must not disconnect mail accounts.
		expect(await decryptExternalAccountSecret({ ...withExternalKey("external-key"), CF_TOKEN: "rotated" }, sealed)).toBe("app-password");
		expect(await decryptExternalAccountSecret(withExternalKey("other-key"), sealed)).toBeNull();
	});
});
