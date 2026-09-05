import { HTTPException } from "hono/http-exception";

/**
 * Everything user-uploaded lives in the same R2 bucket as raw mail, under separate
 * prefixes: `avatars/`, `branding/`, `attachments/`, `raw/`, `backups/`.
 */
export type UploadOptions = {
	/** A whitelist, or `"any"` where the type is the sender's business — mail attachments. */
	accept: string[] | "any";
	maxBytes: number;
};

export async function putUpload(
	env: Env,
	keyPrefix: string,
	request: Request,
	options: UploadOptions,
): Promise<string> {
	const contentType = request.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
	if (options.accept !== "any" && !options.accept.includes(contentType)) {
		throw new HTTPException(415, { message: `Unsupported type ${contentType || "(none)"}` });
	}

	const declared = Number(request.headers.get("content-length") ?? "0");
	if (declared > options.maxBytes) {
		throw new HTTPException(413, { message: `File exceeds ${Math.round(options.maxBytes / 1024)} KB` });
	}

	const body = await request.arrayBuffer();
	// Content-Length is a claim, not a fact; check the bytes we actually received.
	if (body.byteLength > options.maxBytes) {
		throw new HTTPException(413, { message: `File exceeds ${Math.round(options.maxBytes / 1024)} KB` });
	}

	// A fresh suffix each time, so a replaced image is never served from cache.
	const key = `${keyPrefix}/${crypto.randomUUID()}`;
	await env.MAIL_BUCKET.put(key, body, { httpMetadata: { contentType } });
	return key;
}

export async function deleteObject(env: Env, key: string): Promise<void> {
	await env.MAIL_BUCKET.delete(key);
}

/** URL the browser fetches an uploaded object from; served by `/api/files/:key`. */
export function publicKeyFor(key: string): string {
	return `/api/files/${encodeURIComponent(key)}`;
}

/** Streams a stored object, with the caller responsible for authorization. */
export async function serveObject(env: Env, key: string, filename?: string): Promise<Response> {
	const object = await env.MAIL_BUCKET.get(key);
	if (!object) throw new HTTPException(404, { message: "File not found" });

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("etag", object.httpEtag);
	// Keys carry a UUID, so an object at a given key never changes.
	headers.set("cache-control", "private, max-age=31536000, immutable");
	if (filename) {
		headers.set("content-disposition", `attachment; filename="${filename.replaceAll('"', "")}"`);
	}

	return new Response(object.body, { headers });
}
