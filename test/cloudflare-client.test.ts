import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareClient } from "@/worker/cloudflare/client";
import { ensureSendingSubdomain } from "@/worker/cloudflare/email-sending";
import { listZones } from "@/worker/cloudflare/zones";

afterEach(() => vi.unstubAllGlobals());

describe("Cloudflare API client", () => {
	it("lists zones using only the runtime token", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ success: true, result: [], errors: [], messages: [] })),
		);
		vi.stubGlobal("fetch", fetchMock);

		await listZones(CloudflareClient.fromEnv({ CF_TOKEN: "token" } as Env));

		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.cloudflare.com/client/v4/zones?per_page=200",
			expect.objectContaining({
				headers: expect.objectContaining({ authorization: "Bearer token" }),
			}),
		);
	});

	it("onboards a missing sender domain and reuses an enabled one", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: [], errors: [], messages: [] })))
			.mockResolvedValueOnce(new Response(JSON.stringify({
				success: true,
				result: { name: "example.test", tag: "sender-tag", enabled: true },
				errors: [],
				messages: [],
			})));
		vi.stubGlobal("fetch", fetchMock);

		const sender = await ensureSendingSubdomain(CloudflareClient.fromEnv({ CF_TOKEN: "token" } as Env), "zone-id", "example.test");

		expect(sender).toMatchObject({ name: "example.test", tag: "sender-tag", enabled: true });
		expect(fetchMock).toHaveBeenLastCalledWith(
			"https://api.cloudflare.com/client/v4/zones/zone-id/email/sending/subdomains",
			expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "example.test" }) }),
		);
	});
});
