import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { appSettings, mailboxes, users } from "@/db/schema";
import type { AppBindings } from "../middleware/context";
import { serveObject } from "../storage";
import { forbidden } from "./_util";

/**
 * Serves avatars and branding images. Attachments deliberately do **not** go through
 * here: they are per-message and authorized by mailbox access in the messages router.
 *
 * Only keys that some row actually references are servable, so this cannot be turned
 * into a read primitive for arbitrary bucket contents such as raw MIME or backups.
 */
export const fileRoutes = new Hono<AppBindings>().get("/:key{.+}", async (c) => {
	const key = decodeURIComponent(c.req.param("key"));

	const referenced =
		(await c.get("db").select({ id: users.id }).from(users).where(eq(users.avatarKey, key)).get()) ??
		(await c
			.get("db")
			.select({ id: mailboxes.id })
			.from(mailboxes)
			.where(eq(mailboxes.avatarKey, key))
			.get()) ??
		(await c
			.get("db")
			.select({ id: appSettings.id })
			.from(appSettings)
			.where(eq(appSettings.iconKey, key))
			.get());

	if (!referenced) forbidden("That file is not available");
	return serveObject(c.env, key);
});
