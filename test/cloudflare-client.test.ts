import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareClient } from "@/worker/cloudflare/client";
import { ensureSendingSubdomain } from "@/worker/cloudflare/email-sending";
import { getSendingMetrics } from "@/worker/cloudflare/email-analytics";
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

	it("reads only aggregate delivery metrics through Cloudflare GraphQL", async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
			data: {
				viewer: {
					zones: [{ emailSendingAdaptiveGroups: [{ count: 4, dimensions: { date: "2026-09-01", status: "delivered" } }] }],
				},
			},
		})));
		vi.stubGlobal("fetch", fetchMock);

		const metrics = await getSendingMetrics(
			CloudflareClient.fromEnv({ CF_TOKEN: "token" } as Env),
			"zone-id",
			"2026-08-01",
			"2026-09-01",
		);

		expect(metrics).toEqual([{ date: "2026-09-01", status: "delivered", total: 4 }]);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.cloudflare.com/client/v4/graphql",
			expect.objectContaining({
				method: "POST",
				body: expect.stringContaining('"zoneTag":"zone-id"'),
			}),
		);
	});
});
