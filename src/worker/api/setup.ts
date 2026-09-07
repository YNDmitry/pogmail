import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { appSettings, backupSettings, SINGLETON_ID, users } from "@/db/schema";
import { setupInput } from "@/shared/contract/auth";
import { hashPassword } from "../auth/password";
import { createSession, sessionCookie } from "../auth/session";
import type { AppBindings } from "../middleware/context";
import { instanceIsEmpty } from "./auth";
import { parseBody } from "./_util";

/**
 * First-run bootstrap. Creates the initial admin and the singleton settings rows, and
 * nothing else — schema comes from the ordinary migrations, so unlike Mailflare there
 * is no second inline copy of the DDL to keep in sync.
 */
export const setupRoutes = new Hono<AppBindings>()
	.get("/status", async (c) => {
		const settings = await c.get("db").select().from(appSettings).get();
		return c.json({
			needsSetup: await instanceIsEmpty(c.get("db")),
			allowRegistration: settings?.allowRegistration ?? false,
			appName: settings?.appName ?? "Pogmail",
		});
	})

	.post("/", async (c) => {
		if (!(await instanceIsEmpty(c.get("db")))) {
			throw new HTTPException(409, { message: "This instance is already set up" });
		}

		const input = await parseBody(c, setupInput);

		const user = await c
			.get("db")
			.insert(users)
			.values({
				email: input.email.toLowerCase(),
				name: input.name,
				passwordHash: await hashPassword(input.password),
				role: "admin",
				canManageMailboxes: true,
			})
			.returning()
			.get();

		await c
			.get("db")
			.insert(appSettings)
			.values({ id: SINGLETON_ID, appName: "Pogmail" })
			.onConflictDoNothing();
		await c.get("db").insert(backupSettings).values({ id: SINGLETON_ID }).onConflictDoNothing();

		const session = await createSession(c.get("db"), user.id);
		c.header("set-cookie", sessionCookie(session.token, session.expiresAt));

		return c.json({ id: user.id, email: user.email, name: user.name, role: user.role }, 201);
	})
;
