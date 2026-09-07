import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { putRawMessage } from "@/worker/storage";

/**
 * R2 rejects a stream of unknown length, which is exactly what `EmailMessage.raw`
 * is: every inbound message threw `Provided readable stream must have a known
 * length` before the raw MIME ever reached the bucket.
 */
function stream(body: string): ReadableStream {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(body));
			controller.close();
		},
	});
}

describe("putRawMessage", () => {
	it("stores a stream whose length is only known from rawSize", async () => {
		const body = "Subject: hi\r\n\r\nbody";
		const size = new TextEncoder().encode(body).byteLength;
		const key = `raw/test/${crypto.randomUUID()}.eml`;

		await putRawMessage(env, key, stream(body), size);

		const stored = await env.MAIL_BUCKET.get(key);
		expect(await stored?.text()).toBe(body);
		await env.MAIL_BUCKET.delete(key);
	});
});
