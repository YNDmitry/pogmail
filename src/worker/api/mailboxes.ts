import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
	domains,
	MAILBOX_PERMISSIONS,
	MAILBOX_TYPES,
	mailboxAccess,
	mailboxAliases,
	mailboxes,
	users,
} from "@/db/schema";
import { audit } from "../audit";
import { provisionMailboxRule, removeMailboxRule } from "../domains/provision";
import { getPermission, hasAtLeast, listAccessibleMailboxes } from "../mailboxes/access";
import { requireMailboxManager } from "../middleware/auth";
import type { AppBindings } from "../middleware/context";
import { deleteObject, publicKeyFor, putUpload } from "../storage";
import { forbidden, notFound, parseBody } from "./_util";

const createInput = z.object({
	domainId: z.string().min(1),
	localPart: z
		.string()
		.min(1)
		.max(64)
		.regex(/^[a-z0-9._%+-]+$/i, "Use letters, digits and . _ % + - only"),
	displayName: z.string().max(120).nullable().optional(),
	type: z.enum(MAILBOX_TYPES).default("personal"),
	/** Assign to another user; defaults to the caller. */
	userId: z.string().optional(),
});

const updateInput = z.object({
	displayName: z.string().max(120).nullable().optional(),
	signature: z.string().max(5000).nullable().optional(),
	type: z.enum(MAILBOX_TYPES).optional(),
	useAllDomains: z.boolean().optional(),
	disabled: z.boolean().optional(),
	autoReplyEnabled: z.boolean().optional(),
	autoReplySubject: z.string().max(300).optional(),
	autoReplyBody: z.string().max(10000).optional(),
});

const accessInput = z.object({
	userId: z.string().min(1),
	permission: z.enum(MAILBOX_PERMISSIONS),
});

const aliasInput = z.object({
	domainId: z.string().min(1),
	localPart: z.string().min(1).max(64).regex(/^[a-z0-9._%+-]+$/i),
});

export const mailboxRoutes = new Hono<AppBindings>()
	.get("/", async (c) => {
		return c.json({ items: await listAccessibleMailboxes(c.get("db"), c.get("user")) });
	})

	.post("/", requireMailboxManager, async (c) => {
		const input = await parseBody(c, createInput);
		const localPart = input.localPart.toLowerCase();

		const domain = await c.get("db").select().from(domains).where(eq(domains.id, input.domainId)).get();
		if (!domain) notFound("Domain");
		if (domain.status !== "active") {
			throw new HTTPException(409, { message: "Verify the domain before adding mailboxes to it" });
		}

		const taken = await c
			.get("db")
			.select({ id: mailboxes.id })
			.from(mailboxes)
			.where(and(eq(mailboxes.domainId, domain.id), eq(mailboxes.localPart, localPart)))
			.get();
		if (taken) throw new HTTPException(409, { message: "That address already exists" });

		const address = `${localPart}@${domain.hostname}`;
		// The Cloudflare rule is what actually makes mail arrive; without it the row
		// would be a mailbox that silently never receives anything.
		const ruleTag = await provisionMailboxRule(c.env, domain.zoneId, address);

		const mailbox = await c
			.get("db")
			.insert(mailboxes)
			.values({
				domainId: domain.id,
				userId: input.userId ?? c.get("user").id,
				localPart,
				displayName: input.displayName ?? null,
				type: input.type,
				cloudflareRuleId: ruleTag,
			})
			.returning()
			.get();

		audit(c, { action: "mailbox.create", mailboxId: mailbox.id, metadata: { address } });
		return c.json({ ...mailbox, address }, 201);
	})

	.get("/:id", async (c) => {
		const mailbox = await loadReadable(c, c.req.param("id"));

		const [domain, aliases, sharing] = await Promise.all([
			c.get("db").select().from(domains).where(eq(domains.id, mailbox.domainId)).get(),
			c.get("db").select().from(mailboxAliases).where(eq(mailboxAliases.mailboxId, mailbox.id)).all(),
			c
				.get("db")
				.select({
					id: mailboxAccess.id,
					userId: mailboxAccess.userId,
					permission: mailboxAccess.permission,
					email: users.email,
					name: users.name,
				})
				.from(mailboxAccess)
				.innerJoin(users, eq(users.id, mailboxAccess.userId))
				.where(eq(mailboxAccess.mailboxId, mailbox.id))
				.all(),
		]);

		return c.json({
			...mailbox,
			address: domain ? `${mailbox.localPart}@${domain.hostname}` : mailbox.localPart,
			avatarUrl: mailbox.avatarKey ? publicKeyFor(mailbox.avatarKey) : null,
			aliases,
			sharing,
		});
	})

	.patch("/:id", async (c) => {
		const input = await parseBody(c, updateInput);
		const mailbox = await loadWritable(c, c.req.param("id"));

		const row = await c
			.get("db")
			.update(mailboxes)
			.set(input)
			.where(eq(mailboxes.id, mailbox.id))
			.returning()
			.get();

		audit(c, { action: "mailbox.update", mailboxId: mailbox.id });
		return c.json(row);
	})

	.delete("/:id", requireMailboxManager, async (c) => {
		const mailbox = await c
			.get("db")
			.select()
			.from(mailboxes)
			.where(eq(mailboxes.id, c.req.param("id")))
			.get();
		if (!mailbox) notFound("Mailbox");

		const domain = await c.get("db").select().from(domains).where(eq(domains.id, mailbox.domainId)).get();
		if (domain && mailbox.cloudflareRuleId) {
			await removeMailboxRule(c.env, domain.zoneId, mailbox.cloudflareRuleId);
		}

		await c.get("db").delete(mailboxes).where(eq(mailboxes.id, mailbox.id));
		audit(c, { action: "mailbox.delete", metadata: { localPart: mailbox.localPart } });

		return c.json({ ok: true });
	})

	.get("/:id/aliases", async (c) => {
		const mailbox = await loadReadable(c, c.req.param("id"));
		const rows = await c
			.get("db")
			.select()
			.from(mailboxAliases)
			.where(eq(mailboxAliases.mailboxId, mailbox.id))
			.orderBy(desc(mailboxAliases.createdAt))
			.all();

		return c.json({ items: rows });
	})

	.post("/:id/aliases", requireMailboxManager, async (c) => {
		const input = await parseBody(c, aliasInput);
		const mailbox = await loadWritable(c, c.req.param("id"));

		const domain = await c.get("db").select().from(domains).where(eq(domains.id, input.domainId)).get();
		if (!domain) notFound("Domain");

		const localPart = input.localPart.toLowerCase();
		const address = `${localPart}@${domain.hostname}`;
		await provisionMailboxRule(c.env, domain.zoneId, address);

		const row = await c
			.get("db")
			.insert(mailboxAliases)
			.values({ mailboxId: mailbox.id, domainId: domain.id, localPart })
			.returning()
			.get();

		audit(c, { action: "mailbox.alias_add", mailboxId: mailbox.id, metadata: { address } });
		return c.json({ ...row, address }, 201);
	})

	.delete("/:id/aliases/:aliasId", requireMailboxManager, async (c) => {
		const mailbox = await loadWritable(c, c.req.param("id"));

		const row = await c
			.get("db")
			.delete(mailboxAliases)
			.where(
				and(
					eq(mailboxAliases.id, c.req.param("aliasId")),
					eq(mailboxAliases.mailboxId, mailbox.id),
				),
			)
			.returning({ id: mailboxAliases.id })
			.get();

		if (!row) notFound("Alias");
		return c.json({ ok: true });
	})

	.put("/:id/access", async (c) => {
		const input = await parseBody(c, accessInput);
		const mailbox = await loadWritable(c, c.req.param("id"));

		if (input.userId === mailbox.userId) {
			throw new HTTPException(409, { message: "The owner already has full access" });
		}

		const row = await c
			.get("db")
			.insert(mailboxAccess)
			.values({
				mailboxId: mailbox.id,
				userId: input.userId,
				permission: input.permission,
				createdByUserId: c.get("user").id,
			})
			.onConflictDoUpdate({
				target: [mailboxAccess.mailboxId, mailboxAccess.userId],
				set: { permission: input.permission },
			})
			.returning()
			.get();

		audit(c, {
			action: "mailbox.share",
			mailboxId: mailbox.id,
			targetUserId: input.userId,
			metadata: { permission: input.permission },
		});

		return c.json(row);
	})

	.delete("/:id/access/:userId", async (c) => {
		const mailbox = await loadWritable(c, c.req.param("id"));

		await c
			.get("db")
			.delete(mailboxAccess)
			.where(
				and(
					eq(mailboxAccess.mailboxId, mailbox.id),
					eq(mailboxAccess.userId, c.req.param("userId")),
				),
			);

		audit(c, { action: "mailbox.unshare", mailboxId: mailbox.id, targetUserId: c.req.param("userId") });
		return c.json({ ok: true });
	})

	.put("/:id/avatar", async (c) => {
		const mailbox = await loadWritable(c, c.req.param("id"));

		const key = await putUpload(c.env, `avatars/mailboxes/${mailbox.id}`, c.req.raw, {
			accept: ["image/png", "image/jpeg", "image/webp"],
			maxBytes: 2 * 1024 * 1024,
		});

		await c.get("db").update(mailboxes).set({ avatarKey: key }).where(eq(mailboxes.id, mailbox.id));
		if (mailbox.avatarKey) await deleteObject(c.env, mailbox.avatarKey);

		return c.json({ avatarKey: key, url: publicKeyFor(key) });
	});

type MailboxRow = typeof mailboxes.$inferSelect;

async function loadReadable(c: Context<AppBindings>, id: string): Promise<MailboxRow> {
	return load(c, id, "read_only");
}

async function loadWritable(c: Context<AppBindings>, id: string): Promise<MailboxRow> {
	return load(c, id, "full_access");
}

async function load(
	c: Context<AppBindings>,
	id: string,
	required: "read_only" | "full_access",
): Promise<MailboxRow> {
	const mailbox = await c.get("db").select().from(mailboxes).where(eq(mailboxes.id, id)).get();
	if (!mailbox) notFound("Mailbox");

	const permission = await getPermission(c.get("db"), c.get("user"), mailbox.id);
	// A mailbox the caller cannot see must be indistinguishable from a missing one.
	if (!hasAtLeast(permission, "read_only")) notFound("Mailbox");
	if (required === "full_access" && !hasAtLeast(permission, "full_access")) {
		forbidden("You do not have full access to this mailbox");
	}

	return mailbox;
}
