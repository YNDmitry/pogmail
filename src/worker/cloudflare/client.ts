const API_BASE = "https://api.cloudflare.com/client/v4";

type GraphQLResult<T> = { data?: T; errors?: { message?: string }[] };

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
	constructor(private readonly token: string) {}

	static fromEnv(env: Env): CloudflareClient {
		if (!env.CF_TOKEN) {
			throw new CloudflareError("CF_TOKEN is not configured", 500);
		}
		return new CloudflareClient(env.CF_TOKEN);
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
			// Cloudflare sometimes answers with an error entry carrying an empty message;
			// `??` would keep the empty string and the failure would surface nameless.
			const message = first?.message?.trim() || `Cloudflare API ${response.status}`;
			throw new CloudflareError(message, response.status, first?.code);
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

	/** Cloudflare Analytics is GraphQL rather than a REST resource. */
	async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
		const response = await fetch(`${API_BASE}/graphql`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${this.token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ query, variables }),
		});
		const body = (await response.json().catch(() => null)) as GraphQLResult<T> | null;
		if (!response.ok || body?.errors?.length || !body?.data) {
			throw new CloudflareError(
				body?.errors?.[0]?.message?.trim() || `Cloudflare Analytics ${response.status}`,
				response.status || 502,
			);
		}
		return body.data;
	}
}
