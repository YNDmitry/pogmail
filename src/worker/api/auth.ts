import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getCookie } from "hono/cookie";
import { eq, sql } from "drizzle-orm";
import { appSettings, users } from "@/db/schema";
import { loginInput, registerInput } from "@/shared/contract/auth";
import { audit } from "../audit";
import { hashPassword, verifyPassword } from "../auth/password";
import {
	clearedSessionCookie,
	createSession,
	destroySession,
	sessionCookie,
	SESSION_COOKIE,
} from "../auth/session";
import { requireAuth } from "../middleware/auth";
import type { AppBindings } from "../middleware/context";
import { parseBody } from "./_util";

export const authRoutes = new Hono<AppBindings>()
	.post("/login", async (c) => {
		const input = await parseBody(c, loginInput);

		// Rate limit on the address so one attacker cannot lock out the whole instance.
		const { success } = await c.env.AUTH_RATE_LIMIT.limit({ key: input.email.toLowerCase() });
		if (!success) throw new HTTPException(429, { message: "Too many attempts, try again shortly" });

		const user = await c.get("db").select().from(users).where(eq(users.email, input.email.toLowerCase())).get();

		// Same message and roughly the same work either way: no user enumeration.
		const ok = user ? await verifyPassword(input.password, user.passwordHash) : false;
		if (!user || !ok || user.disabled) throw new HTTPException(401, { message: "Invalid email or password" });

		const session = await createSession(c.get("db"), user.id, {
			userAgent: c.req.header("user-agent"),
			ip: c.req.header("cf-connecting-ip"),
		});

		c.header("set-cookie", sessionCookie(session.token, session.expiresAt));
		c.set("user", {
			id: user.id,
			email: user.email,
			name: user.name,
			role: user.role,
			avatarKey: user.avatarKey,
			mailLayout: user.mailLayout,
			canManageMailboxes: user.canManageMailboxes,
		});
		audit(c, { action: "auth.login" });

		return c.json(c.get("user"));
	})

	.post("/register", async (c) => {
		const settings = await c.get("db").select().from(appSettings).get();
		if (!settings?.allowRegistration) {
			throw new HTTPException(403, { message: "Registration is disabled on this instance" });
		}

		const input = await parseBody(c, registerInput);
		const email = input.email.toLowerCase();

		const taken = await c.get("db").select({ id: users.id }).from(users).where(eq(users.email, email)).get();
		if (taken) throw new HTTPException(409, { message: "That email is already registered" });

		const user = await c
			.get("db")
			.insert(users)
			.values({ email, name: input.name, passwordHash: await hashPassword(input.password), role: "user" })
			.returning()
			.get();

		const session = await createSession(c.get("db"), user.id, {
			userAgent: c.req.header("user-agent"),
			ip: c.req.header("cf-connecting-ip"),
		});
		c.header("set-cookie", sessionCookie(session.token, session.expiresAt));

		return c.json(
			{
				id: user.id,
				email: user.email,
				name: user.name,
				role: user.role,
				avatarKey: user.avatarKey,
				canManageMailboxes: user.canManageMailboxes,
			},
			201,
		);
	})

	.post("/logout", async (c) => {
		await destroySession(c.get("db"), getCookie(c, SESSION_COOKIE));
		c.header("set-cookie", clearedSessionCookie);
		return c.json({ ok: true });
	})

	.get("/me", requireAuth, (c) => c.json(c.get("user")));

/** True when the instance has no users yet; drives the first-run wizard. */
export async function instanceIsEmpty(db: AppBindings["Variables"]["db"]): Promise<boolean> {
	const row = await db.select({ count: sql<number>`COUNT(*)` }).from(users).get();
	return (row?.count ?? 0) === 0;
}
