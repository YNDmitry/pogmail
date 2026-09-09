import { describe, expect, it } from "vitest";
import { MAX_QUEUE_DELAY_SECONDS, nextScheduledDelay } from "@/worker/email/schedule";

describe("outbound send scheduling", () => {
	it("caps each queue wait at Cloudflare's 24-hour maximum", () => {
		const now = Date.UTC(2026, 0, 1);
		expect(nextScheduledDelay(new Date(now + 90 * 24 * 60 * 60 * 1000), now)).toBe(MAX_QUEUE_DELAY_SECONDS);
	});

	it("waits exactly until nearby sends and runs overdue sends immediately", () => {
		const now = Date.UTC(2026, 0, 1);
		expect(nextScheduledDelay(new Date(now + 90_001), now)).toBe(91);
		expect(nextScheduledDelay(new Date(now), now)).toBeUndefined();
	});
});
