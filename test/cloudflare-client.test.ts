import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareClient } from "@/worker/cloudflare/client";
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
});
