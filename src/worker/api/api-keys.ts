import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { API_KEY_SCOPES, apiKeys } from "@/db/schema";
import { audit } from "../audit";
import { sha256Hex } from "../auth/password";
import type { AppBindings } from "../middleware/context";
import { notFound, parseBody } from "./_util";

const createInput = z.object({
	name: z.string().min(1).max(80),
	scopes: z.array(z.enum(API_KEY_SCOPES)).min(1),
	/** Days until expiry; omit for a key that never expires. */
	expiresInDays: z.number().int().min(1).max(3650).optional(),
});

const PREFIX = "pbk_";

export const apiKeyRoutes = new Hono<AppBindings>()
	.get("/", async (c) => {
		const rows = await c
			.get("db")
			.select({
				id: apiKeys.id,
				name: apiKeys.name,
				tokenPrefix: apiKeys.tokenPrefix,
				scopes: apiKeys.scopes,
				lastUsedAt: apiKeys.lastUsedAt,
				expiresAt: apiKeys.expiresAt,
				revokedAt: apiKeys.revokedAt,
				createdAt: apiKeys.createdAt,
			})
			.from(apiKeys)
			.where(eq(apiKeys.userId, c.get("user").id))
			.orderBy(desc(apiKeys.createdAt))
			.all();

		return c.json({ items: rows });
	})

	.post("/", async (c) => {
		const input = await parseBody(c, createInput);

		const secret = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
		const token = `${PREFIX}${secret}`;

		const row = await c
			.get("db")
			.insert(apiKeys)
			.values({
				userId: c.get("user").id,
				name: input.name,
				tokenHash: await sha256Hex(token),
				tokenPrefix: token.slice(0, PREFIX.length + 6),
				scopes: input.scopes,
				expiresAt: input.expiresInDays
					? new Date(Date.now() + input.expiresInDays * 86_400_000)
					: null,
			})
			.returning()
			.get();

		audit(c, { action: "api_key.create", metadata: { name: input.name, scopes: input.scopes } });

		// The only time the raw token exists anywhere; only its hash is stored.
		return c.json({ id: row.id, name: row.name, token, scopes: row.scopes, expiresAt: row.expiresAt }, 201);
	})

	.delete("/:id", async (c) => {
		const row = await c
			.get("db")
			.update(apiKeys)
			.set({ revokedAt: new Date() })
			.where(and(eq(apiKeys.id, c.req.param("id")), eq(apiKeys.userId, c.get("user").id)))
			.returning({ id: apiKeys.id })
			.get();

		if (!row) notFound("API key");
		audit(c, { action: "api_key.revoke", metadata: { id: row.id } });

		return c.json({ ok: true });
	});
