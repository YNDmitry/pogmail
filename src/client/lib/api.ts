import { ApiError, type ApiErrorBody } from "@/shared/http";

/**
 * The client and the Worker share request/response types through `@/shared/contract`
 * rather than importing Worker source: the two live in separate TypeScript programs,
 * because workerd's runtime globals (notably HTMLRewriter's `Element`) silently
 * redefine DOM members if they reach browser code.
 */
type RequestOptions = {
	query?: Record<string, string | number | boolean | undefined | null>;
	signal?: AbortSignal;
};

async function request<TResponse>(
	method: string,
	path: string,
	body?: unknown,
	options: RequestOptions = {},
): Promise<TResponse> {
	const url = new URL(path, location.origin);
	for (const [key, value] of Object.entries(options.query ?? {})) {
		if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
	}

	const isForm = body instanceof FormData;
	const response = await fetch(url, {
		method,
		credentials: "same-origin",
		headers: body !== undefined && !isForm ? { "content-type": "application/json" } : undefined,
		body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
		signal: options.signal,
	});

	if (!response.ok) {
		const parsed = (await response.json().catch(() => null)) as ApiErrorBody | null;
		throw new ApiError(parsed?.error ?? response.statusText, response.status, parsed?.details);
	}

	// 204 and friends carry no body.
	if (response.status === 204 || response.headers.get("content-length") === "0") {
		return undefined as TResponse;
	}

	return (await response.json()) as TResponse;
}

/**
 * Sends one file as the request body.
 *
 * The upload endpoints take the bytes raw rather than as multipart — a Worker
 * buffers the whole thing either way — so the name travels in a header, and
 * `encodeURIComponent` keeps a non-ASCII filename inside what a header may hold.
 */
async function upload<TResponse>(path: string, file: File, extraHeaders?: Record<string, string>): Promise<TResponse> {
	const response = await fetch(new URL(path, location.origin), {
		method: "POST",
		credentials: "same-origin",
		headers: {
			"content-type": file.type || "application/octet-stream",
			"x-filename": encodeURIComponent(file.name),
			...extraHeaders,
		},
		body: file,
	});

	if (!response.ok) {
		const parsed = (await response.json().catch(() => null)) as ApiErrorBody | null;
		throw new ApiError(parsed?.error ?? response.statusText, response.status, parsed?.details);
	}

	return (await response.json()) as TResponse;
}

export const api = {
	upload,
	get: <T>(path: string, options?: RequestOptions) => request<T>("GET", path, undefined, options),
	post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>("POST", path, body, options),
	patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>("PATCH", path, body, options),
	put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>("PUT", path, body, options),
	delete: <T>(path: string, options?: RequestOptions) => request<T>("DELETE", path, undefined, options),
};

export { ApiError } from "@/shared/http";
