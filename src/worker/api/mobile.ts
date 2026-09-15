import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { folders, messages, mobileDeviceSessions, mobileSyncEvents, users } from "@/db/schema";
import { mobileLoginInput, mobileRefreshInput } from "@/shared/contract/mobile";
import { z } from "zod";
import { audit } from "../audit";
import { createMobileSession, destroyMobileSession, rotateMobileRefreshToken } from "../auth/mobile-session";
import { verifyPassword } from "../auth/password";
import { requireMobileAuth } from "../middleware/auth";
import type { AppBindings } from "../middleware/context";
import { listAccessibleMailboxes } from "../mailboxes/access";
import { parseBody, parseQuery } from "./_util";

const syncQuery = z.object({
	/** Last successfully applied mobile sync event. Zero starts a complete first sync. */
	cursor: z.coerce.number().int().min(0).default(0),
	limit: z.coerce.number().int().min(1).max(200).default(100),
});

const mobileMessageColumns = {
	id: messages.id,
	mailboxId: messages.mailboxId,
	threadId: messages.threadId,
	direction: messages.direction,
	status: messages.status,
	folderId: messages.folderId,
	subject: messages.subject,
	fromAddress: messages.fromAddress,
	fromName: messages.fromName,
	toAddresses: messages.toAddresses,
	snippet: messages.snippet,
	read: messages.read,
	starred: messages.starred,
	snoozedUntil: messages.snoozedUntil,
	hasAttachments: messages.hasAttachments,
	sizeBytes: messages.sizeBytes,
	receivedAt: messages.receivedAt,
	updatedAt: messages.updatedAt,
} as const;

/** Android-only session issuance. These routes deliberately never set a cookie. */
export const mobileRoutes = new Hono<AppBindings>()
	.post("/auth/login", async (c) => {
		const input = await parseBody(c, mobileLoginInput);
		const email = input.email.toLowerCase();
		const { success } = await c.env.AUTH_RATE_LIMIT.limit({ key: `mobile:${email}` });
		if (!success) throw new HTTPException(429, { message: "Too many attempts, try again shortly" });

		const user = await c.get("db").select().from(users).where(eq(users.email, email)).get();
		const valid = user ? await verifyPassword(input.password, user.passwordHash) : false;
		if (!user || !valid || user.disabled) throw new HTTPException(401, { message: "Invalid email or password" });

		c.set("user", toUser(user));
		const tokens = await createMobileSession(c.get("db"), user.id, {
			deviceName: input.deviceName,
			appVersion: input.appVersion,
			ip: c.req.header("cf-connecting-ip"),
		});
		audit(c, { action: "mobile.login", metadata: { deviceName: input.deviceName, appVersion: input.appVersion } });

		return c.json({ user: c.get("user"), ...tokens }, 201);
	})

	.post("/auth/refresh", async (c) => {
		const input = await parseBody(c, mobileRefreshInput);
		const tokenHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.refreshToken));
		const key = `mobile-refresh:${toHex(tokenHash)}`;
		const { success } = await c.env.AUTH_RATE_LIMIT.limit({ key });
		if (!success) throw new HTTPException(429, { message: "Too many attempts, try again shortly" });

		const tokens = await rotateMobileRefreshToken(c.get("db"), input.refreshToken, {
			deviceName: input.deviceName,
			appVersion: input.appVersion,
			ip: c.req.header("cf-connecting-ip"),
		});
		if (!tokens) throw new HTTPException(401, { message: "Invalid or expired refresh token" });

		return c.json(tokens);
	})

	.post("/auth/logout", requireMobileAuth, async (c) => {
		const deviceSessionId = c.get("mobileSessionId");
		if (!deviceSessionId) throw new HTTPException(401, { message: "Not authenticated" });
		await destroyMobileSession(c.get("db"), deviceSessionId);
		audit(c, { action: "mobile.logout" });
		return c.json({ ok: true });
	})

	.get("/auth/me", requireMobileAuth, (c) => c.json(c.get("user")));

export const mobileDeviceRoutes = new Hono<AppBindings>()
	.use("*", requireMobileAuth)
	.get("/devices", async (c) => {
		const currentDeviceSessionId = c.get("mobileSessionId");
		const items = await c
			.get("db")
			.select({
				id: mobileDeviceSessions.id,
				deviceName: mobileDeviceSessions.deviceName,
				platform: mobileDeviceSessions.platform,
				appVersion: mobileDeviceSessions.appVersion,
				lastSeenAt: mobileDeviceSessions.lastSeenAt,
				createdAt: mobileDeviceSessions.createdAt,
			})
			.from(mobileDeviceSessions)
			.where(and(eq(mobileDeviceSessions.userId, c.get("user").id), isNull(mobileDeviceSessions.revokedAt)))
			.orderBy(desc(mobileDeviceSessions.lastSeenAt))
			.all();

		return c.json({ items: items.map((item) => ({ ...item, current: item.id === currentDeviceSessionId })) });
	})

	.delete("/devices/:id", async (c) => {
		const revoked = await c
			.get("db")
			.update(mobileDeviceSessions)
			.set({ revokedAt: new Date() })
			.where(
				and(
					eq(mobileDeviceSessions.id, c.req.param("id")),
					eq(mobileDeviceSessions.userId, c.get("user").id),
					isNull(mobileDeviceSessions.revokedAt),
				),
			)
			.returning({ id: mobileDeviceSessions.id })
			.get();
		if (!revoked) throw new HTTPException(404, { message: "Device session not found" });

		audit(c, { action: "mobile.device_revoke", metadata: { deviceSessionId: revoked.id } });
		return c.json({ ok: true });
	})

	/**
	 * A bounded, cursor-based delta. Mailbox and folder snapshots are small and
	 * authoritative; message tombstones let offline clients remove hard deletes.
	 */
	.get("/sync", async (c) => {
		const query = await parseQuery(c, syncQuery);
		const mailboxes = await listAccessibleMailboxes(c.get("db"), c.get("user"));
		const mailboxIds = mailboxes.map((mailbox) => mailbox.id);
		if (mailboxIds.length === 0) {
			return c.json({ cursor: query.cursor, hasMore: false, mailboxes: [], folders: [], messages: [], tombstones: [] });
		}

		const [events, currentFolders] = await Promise.all([
			c
				.get("db")
				.select()
				.from(mobileSyncEvents)
				.where(and(gt(mobileSyncEvents.sequence, query.cursor), inArray(mobileSyncEvents.mailboxId, mailboxIds)))
				.orderBy(asc(mobileSyncEvents.sequence))
				.limit(query.limit)
				.all(),
			c
				.get("db")
				.select({
					id: folders.id,
					mailboxId: folders.mailboxId,
					name: folders.name,
					color: folders.color,
					position: folders.position,
					updatedAt: folders.updatedAt,
				})
				.from(folders)
				.where(inArray(folders.mailboxId, mailboxIds))
				.orderBy(asc(folders.position), asc(folders.name))
				.all(),
		]);

		const messageIds = events
			.filter((event) => event.resourceType === "message" && event.operation === "upsert")
			.map((event) => event.resourceId);
		const currentMessages = messageIds.length === 0
			? []
			: await c
					.get("db")
					.select(mobileMessageColumns)
					.from(messages)
					.where(and(inArray(messages.id, messageIds), inArray(messages.mailboxId, mailboxIds)))
					.all();

		const last = events.at(-1);
		return c.json({
			cursor: last?.sequence ?? query.cursor,
			hasMore: events.length === query.limit,
			mailboxes,
			folders: currentFolders,
			messages: currentMessages,
			tombstones: events
				.filter((event) => event.operation === "delete")
				.map((event) => ({
					resourceType: event.resourceType,
					resourceId: event.resourceId,
					mailboxId: event.mailboxId,
					sequence: event.sequence,
				})),
		});
	});

function toUser(user: typeof users.$inferSelect) {
	return {
		id: user.id,
		email: user.email,
		name: user.name,
		role: user.role,
		avatarKey: user.avatarKey,
		mailLayout: user.mailLayout,
		telegramChatId: user.telegramChatId,
		canManageMailboxes: user.canManageMailboxes,
	};
}

function toHex(buffer: ArrayBuffer): string {
	return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
