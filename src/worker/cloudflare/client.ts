const API_BASE = "https://api.cloudflare.com/client/v4";

export type CloudflareResult<T> = {
	success: boolean;
	result: T;
	errors: { code: number; message: string }[];
	messages: { code: number; message: string }[];
};

export class CloudflareError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code?: number,
	) {
		super(message);
		this.name = "CloudflareError";
	}
}

/**
 * Thin typed wrapper over the Cloudflare REST API. Auth is a scoped API token; the
 * legacy `X-Auth-Email` + `X-Auth-Key` global-key pair is deliberately not supported,
 * since it grants the whole account and cannot be scoped to one zone.
 */
export class CloudflareClient {
	constructor(
		private readonly token: string,
		readonly accountId: string,
	) {}

	static fromEnv(env: Env): CloudflareClient {
		if (!env.CF_TOKEN || !env.CF_ACCOUNT_ID) {
			throw new CloudflareError("CF_TOKEN and CF_ACCOUNT_ID are not configured", 500);
		}
		return new CloudflareClient(env.CF_TOKEN, env.CF_ACCOUNT_ID);
	}

	async request<T>(path: string, init: RequestInit = {}): Promise<T> {
		const response = await fetch(`${API_BASE}${path}`, {
			...init,
			headers: {
				authorization: `Bearer ${this.token}`,
				"content-type": "application/json",
				...init.headers,
			},
		});

		const body = (await response.json().catch(() => null)) as CloudflareResult<T> | null;

		if (!response.ok || !body?.success) {
			const first = body?.errors?.[0];
			throw new CloudflareError(
				first?.message ?? `Cloudflare API ${response.status}`,
				response.status,
				first?.code,
			);
		}

		return body.result;
	}

	get<T>(path: string) {
		return this.request<T>(path);
	}
	post<T>(path: string, body: unknown) {
		return this.request<T>(path, { method: "POST", body: JSON.stringify(body) });
	}
	patch<T>(path: string, body: unknown) {
		return this.request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
	}
	put<T>(path: string, body: unknown) {
		return this.request<T>(path, { method: "PUT", body: JSON.stringify(body) });
	}
	delete<T>(path: string) {
		return this.request<T>(path, { method: "DELETE" });
	}
}
