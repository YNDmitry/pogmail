import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareClient } from "@/worker/cloudflare/client";
import { ensureSendingSubdomain } from "@/worker/cloudflare/email-sending";
import { getSendingMetrics } from "@/worker/cloudflare/email-analytics";
import { deleteSuppression, getSuppression, listSuppressions } from "@/worker/cloudflare/suppressions";
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

	it("pages account suppressions and preserves Cloudflare's server mutability flag", async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
			success: true,
			result: [{
				id: "182bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e",
				created_at: "2026-09-01T00:00:00Z",
				email: "bounced@example.test",
				expires_at: null,
				read_only: true,
				reason: "hard_bounce",
			}],
			result_info: { count: 1, per_page: 100, next_cursor: "opaque-next-page" },
			errors: [],
			messages: [],
		})));
		vi.stubGlobal("fetch", fetchMock);

		const page = await listSuppressions(
			CloudflareClient.fromEnv({ CF_TOKEN: "token" } as Env),
			"account-id",
			{ reason: "hard_bounce", search: "bounced@" },
		);

		expect(page).toMatchObject({ nextCursor: "opaque-next-page", items: [{ read_only: true, reason: "hard_bounce" }] });
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.cloudflare.com/client/v4/accounts/account-id/email/sending/suppressions?per_page=100&reason=hard_bounce&search=bounced%40",
			expect.anything(),
		);
	});

	it("uses account-scoped endpoints when checking and deleting a suppression", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: { id: "row-id" }, errors: [], messages: [] })))
			.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: { id: "row-id" }, errors: [], messages: [] })));
		vi.stubGlobal("fetch", fetchMock);
		const cf = CloudflareClient.fromEnv({ CF_TOKEN: "token" } as Env);

		await getSuppression(cf, "account-id", "row-id");
		await deleteSuppression(cf, "account-id", "row-id");

		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"https://api.cloudflare.com/client/v4/accounts/account-id/email/sending/suppressions/row-id",
			expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer token" }) }),
		);
		expect(fetchMock).toHaveBeenLastCalledWith(
			"https://api.cloudflare.com/client/v4/accounts/account-id/email/sending/suppressions/row-id",
			expect.objectContaining({ method: "DELETE" }),
		);
	});
});
