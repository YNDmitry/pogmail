import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { folders, messages, mobileDeviceSessions, mobileSyncEvents, passkeyChallenges, passkeys, users } from "@/db/schema";
import { mobileLoginInput, mobilePasskeyVerifyInput, mobileRefreshInput } from "@/shared/contract/mobile";
import { z } from "zod";
import { audit } from "../audit";
import { createMobileSession, destroyMobileSession, rotateMobileRefreshToken } from "../auth/mobile-session";
import { verifyPassword } from "../auth/password";
import { randomChallenge, toBase64Url, verifyAuthentication, verifyClientData } from "../auth/passkey";
import { requireMobileAuth } from "../middleware/auth";
import type { AppBindings } from "../middleware/context";
import { listAccessibleMailboxes } from "../mailboxes/access";
import { parseBody, parseQuery } from "./_util";

const syncQuery = z.object({
	/** Last successfully applied mobile sync event. Zero starts a complete first sync. */
	cursor: z.coerce.number().int().min(0).default(0),
	limit: z.coerce.number().int().min(1).max(200).default(100),
});
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SHA256_FINGERPRINT = /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/;

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

	.post("/auth/passkeys/options", async (c) => {
		const ip = c.req.header("cf-connecting-ip") ?? "unknown";
		const { success } = await c.env.AUTH_RATE_LIMIT.limit({ key: `mobile-passkey:${ip}` });
		if (!success) throw new HTTPException(429, { message: "Too many attempts, try again shortly" });

		const challenge = randomChallenge();
		const record = await c
			.get("db")
			.insert(passkeyChallenges)
			.values({ challenge, purpose: "authentication", expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) })
			.returning({ id: passkeyChallenges.id })
			.get();
		const url = new URL(c.req.url);
		return c.json({
			challengeId: record.id,
			publicKey: {
				challenge,
				rpId: url.hostname,
				timeout: CHALLENGE_TTL_MS,
				userVerification: "required",
			},
		});
	})

	.post("/auth/passkeys/verify", async (c) => {
		const input = await parseBody(c, mobilePasskeyVerifyInput);
		const origins = androidPasskeyOrigins(c.env);
		if (origins.length === 0) throw new HTTPException(503, { message: "Android passkeys are not configured" });

		const challengeRow = await c.get("db").select().from(passkeyChallenges).where(eq(passkeyChallenges.id, input.challengeId)).get();
		if (challengeRow) await c.get("db").delete(passkeyChallenges).where(eq(passkeyChallenges.id, challengeRow.id));
		if (!challengeRow || challengeRow.purpose !== "authentication" || challengeRow.expiresAt <= new Date()) {
			throw new HTTPException(400, { message: "This passkey request has expired; try again" });
		}

		if (input.credential.id !== input.credential.rawId) throw new HTTPException(400, { message: "Invalid passkey credential" });
		const clientData = await verifyClientData(input.credential.response.clientDataJSON, "webauthn.get", challengeRow.challenge, origins);
		const passkey = await c.get("db").select().from(passkeys).where(eq(passkeys.credentialId, input.credential.rawId)).get();
		if (!passkey) throw new HTTPException(401, { message: "This passkey is not registered" });
		const rpId = new URL(c.req.url).hostname;
		const signCount = await verifyAuthentication(
			input.credential.response.authenticatorData,
			clientData,
			input.credential.response.signature,
			passkey.publicKey,
			rpId,
		);
		if (passkey.signCount !== 0 && signCount !== 0 && signCount <= passkey.signCount) {
			throw new HTTPException(401, { message: "This passkey may have been copied; use your password instead" });
		}

		const user = await c.get("db").select().from(users).where(eq(users.id, passkey.userId)).get();
		if (!user || user.disabled) throw new HTTPException(401, { message: "This account is unavailable" });
		await c.get("db").update(passkeys).set({ signCount: Math.max(passkey.signCount, signCount), lastUsedAt: new Date() }).where(eq(passkeys.id, passkey.id));
		const tokens = await createMobileSession(c.get("db"), user.id, {
			deviceName: input.deviceName,
			appVersion: input.appVersion,
			ip: c.req.header("cf-connecting-ip"),
		});
		c.set("user", toUser(user));
		audit(c, { action: "mobile.passkey_login", metadata: { passkeyId: passkey.id, deviceName: input.deviceName } });
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

/** Android supplies this origin from the signing certificate; it is not a URL. */
function androidPasskeyOrigins(env: Env): string[] {
	return env.ANDROID_APP_SHA256_CERT_FINGERPRINTS.split(",")
		.map((fingerprint) => fingerprint.trim().toUpperCase())
		.filter((fingerprint) => SHA256_FINGERPRINT.test(fingerprint))
		.map((fingerprint) => Uint8Array.from(fingerprint.split(":"), (part) => Number.parseInt(part, 16)))
		.map((fingerprint) => `android:apk-key-hash:${toBase64Url(fingerprint)}`);
}
