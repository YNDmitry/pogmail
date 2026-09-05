import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/worker/auth/password";

describe("password hashing", () => {
	it("round-trips a password", async () => {
		const hash = await hashPassword("correct horse battery");
		expect(await verifyPassword("correct horse battery", hash)).toBe(true);
		expect(await verifyPassword("wrong horse battery", hash)).toBe(false);
	});

	it("salts, so identical passwords hash differently", async () => {
		expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
	});

	it("rejects a malformed stored hash instead of throwing", async () => {
		expect(await verifyPassword("x", "garbage")).toBe(false);
		expect(await verifyPassword("x", "0:abc:def")).toBe(false);
	});
});
