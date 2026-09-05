import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppBindings } from "../middleware/context";

/**
 * Parses and validates a JSON body. A schema failure is a 400 carrying the field
 * errors, so the client can highlight the offending inputs rather than guess.
 */
export async function parseBody<T extends z.ZodType>(
	c: Context<AppBindings>,
	schema: T,
): Promise<z.infer<T>> {
	const raw = await c.req.json().catch(() => null);
	const parsed = schema.safeParse(raw);

	if (!parsed.success) {
		throw new HTTPException(400, {
			res: c.json({ error: "Invalid request body", details: z.treeifyError(parsed.error) }, 400),
		});
	}
	return parsed.data;
}

export async function parseQuery<T extends z.ZodType>(
	c: Context<AppBindings>,
	schema: T,
): Promise<z.infer<T>> {
	const parsed = schema.safeParse(c.req.query());
	if (!parsed.success) {
		throw new HTTPException(400, {
			res: c.json({ error: "Invalid query parameters", details: z.treeifyError(parsed.error) }, 400),
		});
	}
	return parsed.data;
}

export function notFound(what: string): never {
	throw new HTTPException(404, { message: `${what} not found` });
}

export function forbidden(why: string): never {
	throw new HTTPException(403, { message: why });
}
