import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { domains, mailboxAccess, mailboxes, messages, users } from "@/db/schema";
import { audit } from "../audit";
import { hashPassword } from "../auth/password";
import { destroyAllSessions } from "../auth/session";
import { requireAdmin } from "../middleware/auth";
import type { AppBindings } from "../middleware/context";
import { deleteObject, publicKeyFor, putUpload } from "../storage";
import { notFound, parseBody } from "./_util";

const createInput = z.object({
	email: z.email(),
	name: z.string().min(1).max(120),
	password: z.string().min(12, "Use at least 12 characters"),
	role: z.enum(["admin", "user"]).default("user"),
	canManageMailboxes: z.boolean().default(false),
});

const updateInput = z.object({
	name: z.string().min(1).max(120).optional(),
	role: z.enum(["admin", "user"]).optional(),
	canManageMailboxes: z.boolean().optional(),
	disabled: z.boolean().optional(),
	resetEmail: z.email().nullable().optional(),
	/** Admin-set password; forces the user to sign in again everywhere. */
	password: z.string().min(12).optional(),
});

/** Every route here is admin-only; the whole router is mounted behind `requireAdmin`. */
export const accountRoutes = new Hono<AppBindings>()
	.use("*", requireAdmin)

	.get("/", async (c) => {
		const rows = await c
			.get("db")
			.select({
				id: users.id,
				email: users.email,
				name: users.name,
				role: users.role,
				disabled: users.disabled,
				canManageMailboxes: users.canManageMailboxes,
				avatarKey: users.avatarKey,
				createdAt: users.createdAt,
				mailboxCount: count(mailboxes.id),
			})
			.from(users)
			.leftJoin(mailboxes, eq(mailboxes.userId, users.id))
			.groupBy(users.id)
			.orderBy(desc(users.createdAt))
			.all();

		return c.json({
			items: rows.map((row) => ({
				...row,
				avatarUrl: row.avatarKey ? publicKeyFor(row.avatarKey) : null,
			})),
		});
	})

	.post("/", async (c) => {
		const input = await parseBody(c, createInput);
		const email = input.email.toLowerCase();

		const taken = await c.get("db").select({ id: users.id }).from(users).where(eq(users.email, email)).get();
		if (taken) throw new HTTPException(409, { message: "That email is already registered" });

		const row = await c
			.get("db")
			.insert(users)
			.values({
				email,
				name: input.name,
				passwordHash: await hashPassword(input.password),
				role: input.role,
				canManageMailboxes: input.canManageMailboxes,
				createdByUserId: c.get("user").id,
			})
			.returning()
			.get();

		audit(c, { action: "account.create", targetUserId: row.id, metadata: { email, role: row.role } });
		return c.json({ id: row.id, email: row.email, name: row.name, role: row.role }, 201);
	})

	.get("/:id", async (c) => {
		const user = await c.get("db").select().from(users).where(eq(users.id, c.req.param("id"))).get();
		if (!user) notFound("Account");

		const [owned, shared, messageCount] = await Promise.all([
			c
				.get("db")
				.select({
					id: mailboxes.id,
					localPart: mailboxes.localPart,
					hostname: domains.hostname,
					disabled: mailboxes.disabled,
				})
				.from(mailboxes)
				.innerJoin(domains, eq(domains.id, mailboxes.domainId))
				.where(eq(mailboxes.userId, user.id))
				.all(),
			c
				.get("db")
				.select({
					id: mailboxes.id,
					localPart: mailboxes.localPart,
					hostname: domains.hostname,
					permission: mailboxAccess.permission,
				})
				.from(mailboxAccess)
				.innerJoin(mailboxes, eq(mailboxes.id, mailboxAccess.mailboxId))
				.innerJoin(domains, eq(domains.id, mailboxes.domainId))
				.where(eq(mailboxAccess.userId, user.id))
				.all(),
			c
				.get("db")
				.select({ total: count() })
				.from(messages)
				.innerJoin(mailboxes, eq(mailboxes.id, messages.mailboxId))
				.where(eq(mailboxes.userId, user.id))
				.get(),
		]);

		return c.json({
			id: user.id,
			email: user.email,
			name: user.name,
			role: user.role,
			disabled: user.disabled,
			canManageMailboxes: user.canManageMailboxes,
			resetEmail: user.resetEmail,
			forwardingEmail: user.forwardingEmail,
			avatarUrl: user.avatarKey ? publicKeyFor(user.avatarKey) : null,
			createdAt: user.createdAt,
			mailboxes: owned.map((row) => ({ ...row, address: `${row.localPart}@${row.hostname}` })),
			sharedMailboxes: shared.map((row) => ({ ...row, address: `${row.localPart}@${row.hostname}` })),
			messageCount: messageCount?.total ?? 0,
		});
	})

	.patch("/:id", async (c) => {
		const input = await parseBody(c, updateInput);
		const targetId = c.req.param("id");

		if (targetId === c.get("user").id && (input.role === "user" || input.disabled === true)) {
			// Locking yourself out of the only admin account leaves nobody who can undo it.
			throw new HTTPException(409, { message: "You cannot demote or disable your own account" });
		}

		if (input.role === "user" || input.disabled === true) await assertNotLastAdmin(c, targetId);

		const { password, ...rest } = input;
		const row = await c
			.get("db")
			.update(users)
			.set({ ...rest, ...(password ? { passwordHash: await hashPassword(password) } : {}) })
			.where(eq(users.id, targetId))
			.returning()
			.get();

		if (!row) notFound("Account");
		if (password || input.disabled === true) await destroyAllSessions(c.get("db"), row.id);

		audit(c, { action: "account.update", targetUserId: row.id, metadata: { ...rest, password: undefined } });
		return c.json({ id: row.id, email: row.email, name: row.name, role: row.role, disabled: row.disabled });
	})

	.delete("/:id", async (c) => {
		const targetId = c.req.param("id");
		if (targetId === c.get("user").id) {
			throw new HTTPException(409, { message: "You cannot delete your own account" });
		}
		await assertNotLastAdmin(c, targetId);

		const row = await c
			.get("db")
			.delete(users)
			.where(eq(users.id, targetId))
			.returning({ id: users.id, email: users.email, avatarKey: users.avatarKey })
			.get();

		if (!row) notFound("Account");
		if (row.avatarKey) await deleteObject(c.env, row.avatarKey);

		audit(c, { action: "account.delete", metadata: { email: row.email } });
		return c.json({ ok: true });
	})

	.put("/:id/avatar", async (c) => {
		const before = await c
			.get("db")
			.select({ avatarKey: users.avatarKey })
			.from(users)
			.where(eq(users.id, c.req.param("id")))
			.get();
		if (!before) notFound("Account");

		const key = await putUpload(c.env, `avatars/users/${c.req.param("id")}`, c.req.raw, {
			accept: ["image/png", "image/jpeg", "image/webp"],
			maxBytes: 2 * 1024 * 1024,
		});

		await c.get("db").update(users).set({ avatarKey: key }).where(eq(users.id, c.req.param("id")));
		if (before.avatarKey) await deleteObject(c.env, before.avatarKey);

		return c.json({ avatarKey: key, url: publicKeyFor(key) });
	});

/** Refuses a change that would leave the instance with no enabled admin. */
async function assertNotLastAdmin(c: Context<AppBindings>, targetId: string): Promise<void> {
	const remaining = await c
		.get("db")
		.select({ total: count() })
		.from(users)
		.where(and(eq(users.role, "admin"), eq(users.disabled, false)))
		.get();

	const target = await c
		.get("db")
		.select({ role: users.role, disabled: users.disabled })
		.from(users)
		.where(eq(users.id, targetId))
		.get();

	if (target?.role === "admin" && !target.disabled && (remaining?.total ?? 0) <= 1) {
		throw new HTTPException(409, { message: "This is the last active admin account" });
	}
}
