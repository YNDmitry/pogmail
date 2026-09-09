import { describe, expect, it } from "vitest";
import { queueRetryDelay } from "@/worker/queue/retry";

describe("queue retry delay", () => {
	it("backs off exponentially and caps the wait at an hour", () => {
		expect(queueRetryDelay(1)).toBe(10);
		expect(queueRetryDelay(2)).toBe(20);
		expect(queueRetryDelay(6)).toBe(320);
		expect(queueRetryDelay(99)).toBe(3600);
	});
});
