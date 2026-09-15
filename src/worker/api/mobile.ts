import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq, isNull } from "drizzle-orm";
import { mobileDeviceSessions, users } from "@/db/schema";
import { mobileLoginInput, mobileRefreshInput } from "@/shared/contract/mobile";
import { audit } from "../audit";
import { createMobileSession, destroyMobileSession, rotateMobileRefreshToken } from "../auth/mobile-session";
import { verifyPassword } from "../auth/password";
import { requireMobileAuth } from "../middleware/auth";
import type { AppBindings } from "../middleware/context";
import { parseBody } from "./_util";

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
