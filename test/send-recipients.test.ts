import { describe, expect, it } from "vitest";
import { deliveryRecipients, isPermanentEmailError } from "@/worker/email/send";

describe("outbound envelope recipients", () => {
	it("delivers To, CC and BCC once each without exposing BCC in headers", () => {
		const message: Parameters<typeof deliveryRecipients>[0] = {
			toAddresses: [{ address: "to@example.test" }, { address: "shared@example.test" }],
			ccAddresses: [{ address: "cc@example.test" }, { address: "SHARED@example.test" }],
			bccAddresses: [{ address: "bcc@example.test" }, { address: "To@example.test" }],
		};

		expect(deliveryRecipients(message)).toEqual([
			"to@example.test",
			"shared@example.test",
			"cc@example.test",
			"bcc@example.test",
		]);
	});

	it("does not queue retries for Cloudflare errors that require a fix", () => {
		expect(isPermanentEmailError({ code: "E_RECIPIENT_SUPPRESSED" })).toBe(true);
		expect(isPermanentEmailError({ code: "E_SENDER_NOT_VERIFIED" })).toBe(true);
		expect(isPermanentEmailError({ code: "E_RATE_LIMIT_EXCEEDED" })).toBe(false);
		expect(isPermanentEmailError(new Error("network interrupted"))).toBe(false);
	});

});
