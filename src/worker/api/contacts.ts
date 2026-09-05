import { Hono } from "hono";
import { and, desc, eq, like, or } from "drizzle-orm";
import { z } from "zod";
import { contacts } from "@/db/schema";
import { audit } from "../audit";
import type { AppBindings } from "../middleware/context";
import { notFound, parseBody, parseQuery } from "./_util";

const listQuery = z.object({
	search: z.string().trim().max(120).optional(),
	blocked: z.enum(["true", "false"]).optional(),
	limit: z.coerce.number().int().min(1).max(200).default(100),
});

const upsertInput = z.object({
	email: z.email(),
	displayName: z.string().max(120).nullable().optional(),
	blocked: z.boolean().optional(),
});

export const contactRoutes = new Hono<AppBindings>()
	.get("/", async (c) => {
		const query = await parseQuery(c, listQuery);
		const term = query.search ? `%${query.search}%` : null;

		const rows = await c
			.get("db")
			.select()
			.from(contacts)
			.where(
				and(
					eq(contacts.userId, c.get("user").id),
					query.blocked ? eq(contacts.blocked, query.blocked === "true") : undefined,
					term ? or(like(contacts.email, term), like(contacts.displayName, term)) : undefined,
				),
			)
			.orderBy(desc(contacts.lastSeenAt), desc(contacts.messageCount))
			.limit(query.limit)
			.all();

		return c.json({ items: rows });
	})

	.post("/", async (c) => {
		const input = await parseBody(c, upsertInput);

		const row = await c
			.get("db")
			.insert(contacts)
			.values({
				userId: c.get("user").id,
				email: input.email.toLowerCase(),
				displayName: input.displayName ?? null,
				blocked: input.blocked ?? false,
				source: "manual",
			})
			.onConflictDoUpdate({
				target: [contacts.userId, contacts.email],
				set: {
					displayName: input.displayName ?? null,
					...(input.blocked !== undefined ? { blocked: input.blocked } : {}),
				},
			})
			.returning()
			.get();

		return c.json(row, 201);
	})

	.patch("/:id", async (c) => {
		const input = await parseBody(c, upsertInput.partial().omit({ email: true }));

		const row = await c
			.get("db")
			.update(contacts)
			.set(input)
			.where(and(eq(contacts.id, c.req.param("id")), eq(contacts.userId, c.get("user").id)))
			.returning()
			.get();

		if (!row) notFound("Contact");
		if (input.blocked !== undefined) {
			audit(c, { action: input.blocked ? "contact.block" : "contact.unblock", metadata: { email: row.email } });
		}

		return c.json(row);
	})

	.delete("/:id", async (c) => {
		const row = await c
			.get("db")
			.delete(contacts)
			.where(and(eq(contacts.id, c.req.param("id")), eq(contacts.userId, c.get("user").id)))
			.returning({ id: contacts.id })
			.get();

		if (!row) notFound("Contact");
		return c.json({ ok: true });
	});

/** Blocked addresses for one user, used by the inbound reject phase. */
export async function blockedAddresses(
	db: AppBindings["Variables"]["db"],
	userId: string,
): Promise<Set<string>> {
	const rows = await db
		.select({ email: contacts.email })
		.from(contacts)
		.where(and(eq(contacts.userId, userId), eq(contacts.blocked, true)))
		.all();

	return new Set(rows.map((row) => row.email.toLowerCase()));
}
