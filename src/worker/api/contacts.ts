import { Hono, type Context } from "hono";
import { and, count, desc, eq, inArray, like, or } from "drizzle-orm";
import { z } from "zod";
import { audienceMembers, audiences, contacts } from "@/db/schema";
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
const audienceInput = z.object({
	name: z.string().trim().min(1).max(80),
	description: z.string().trim().max(300).default(""),
	contactIds: z.array(z.string().min(1)).min(1).max(500),
});
const memberInput = z.object({ contactIds: z.array(z.string().min(1)).min(1).max(500) });
const tagInput = z.object({ contactIds: z.array(z.string().min(1)).min(1).max(500), tag: z.string().trim().min(1).max(40) });
const importInput = z.object({
	contacts: z.array(z.object({
		email: z.string().trim().toLowerCase().pipe(z.email()),
		displayName: z.string().trim().max(120).nullable().optional(),
	})).min(1).max(500),
});

export const contactRoutes = new Hono<AppBindings>()
	.post("/import", async (c) => {
		const input = await parseBody(c, importInput);
		const unique = [...new Map(input.contacts.map((contact) => [contact.email, contact])).values()];
		const inserted = await c.get("db").insert(contacts).values(unique.map((contact) => ({
			userId: c.get("user").id, email: contact.email, displayName: contact.displayName ?? null, source: "manual" as const,
		}))).onConflictDoNothing().returning({ id: contacts.id }).all();
		audit(c, { action: "contact.import", metadata: { imported: inserted.length, skippedExisting: unique.length - inserted.length } });
		return c.json({ imported: inserted.length, skippedExisting: unique.length - inserted.length });
	})
	.post("/tags", async (c) => {
		const input = await parseBody(c, tagInput);
		const owned = await c.get("db").select({ id: contacts.id, tags: contacts.tags }).from(contacts).where(and(
			eq(contacts.userId, c.get("user").id), inArray(contacts.id, input.contactIds),
		)).all();
		if (owned.length !== new Set(input.contactIds).size) notFound("Contact");
		for (const contact of owned) await c.get("db").update(contacts).set({ tags: [...new Set([...contact.tags, input.tag])] }).where(eq(contacts.id, contact.id));
		audit(c, { action: "contact.tag", metadata: { tag: input.tag, count: owned.length } });
		return c.json({ updated: owned.length });
	})
	.get("/audiences", async (c) => {
		const rows = await c.get("db").select({
			id: audiences.id,
			name: audiences.name,
			description: audiences.description,
			createdAt: audiences.createdAt,
			memberCount: count(audienceMembers.id),
		})
			.from(audiences)
			.leftJoin(audienceMembers, eq(audienceMembers.audienceId, audiences.id))
			.where(eq(audiences.userId, c.get("user").id))
			.groupBy(audiences.id)
			.orderBy(desc(audiences.createdAt)).all();
		return c.json({ items: rows });
	})
	.post("/audiences", async (c) => {
		const input = await parseBody(c, audienceInput);
		const owned = await c.get("db").select({ id: contacts.id }).from(contacts).where(and(
			eq(contacts.userId, c.get("user").id), inArray(contacts.id, input.contactIds),
		)).all();
		if (owned.length !== new Set(input.contactIds).size) notFound("Contact");
		const audience = await c.get("db").insert(audiences).values({
			userId: c.get("user").id, name: input.name, description: input.description,
		}).returning().get();
		await c.get("db").insert(audienceMembers).values(owned.map((contact) => ({ audienceId: audience.id, contactId: contact.id })));
		audit(c, { action: "audience.create", metadata: { audienceId: audience.id, members: owned.length } });
		return c.json({ ...audience, memberCount: owned.length }, 201);
	})
	.post("/audiences/:id/members", async (c) => {
		const input = await parseBody(c, memberInput);
		const audience = await ownedAudience(c, c.req.param("id"));
		const owned = await c.get("db").select({ id: contacts.id }).from(contacts).where(and(
			eq(contacts.userId, c.get("user").id), inArray(contacts.id, input.contactIds),
		)).all();
		if (owned.length !== new Set(input.contactIds).size) notFound("Contact");
		await c.get("db").insert(audienceMembers).values(owned.map((contact) => ({ audienceId: audience.id, contactId: contact.id }))).onConflictDoNothing();
		return c.json({ ok: true });
	})
	.delete("/audiences/:id", async (c) => {
		const audience = await ownedAudience(c, c.req.param("id"));
		await c.get("db").delete(audiences).where(eq(audiences.id, audience.id));
		audit(c, { action: "audience.delete", metadata: { audienceId: audience.id } });
		return c.json({ ok: true });
	})
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

async function ownedAudience(c: Context<AppBindings>, id: string) {
	const audience = await c.get("db").select().from(audiences).where(and(
		eq(audiences.id, id), eq(audiences.userId, c.get("user").id),
	)).get();
	if (!audience) notFound("Audience");
	return audience;
}

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
