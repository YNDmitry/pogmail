import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import {
	changePasswordInput,
	forwardingInput,
	telegramNotificationsInput,
	updateProfileInput,
} from "@/shared/contract/settings";
import { audit } from "../audit";
import { hashPassword, verifyPassword } from "../auth/password";
import { destroyAllSessions } from "../auth/session";
import type { AppBindings } from "../middleware/context";
import { parseBody } from "./_util";
import { deleteObject, putUpload, publicKeyFor } from "../storage";

export const settingsRoutes = new Hono<AppBindings>()
	.patch("/profile", async (c) => {
		const input = await parseBody(c, updateProfileInput);

		const updated = await c
			.get("db")
			.update(users)
			.set({
				...(input.name !== undefined ? { name: input.name } : {}),
				...(input.resetEmail !== undefined ? { resetEmail: input.resetEmail } : {}),
				...(input.mailLayout !== undefined ? { mailLayout: input.mailLayout } : {}),
			})
			.where(eq(users.id, c.get("user").id))
			.returning()
			.get();

		audit(c, { action: "profile.update" });
		return c.json({
			id: updated.id,
			name: updated.name,
			resetEmail: updated.resetEmail,
			mailLayout: updated.mailLayout,
		});
	})

	.put("/password", async (c) => {
		const input = await parseBody(c, changePasswordInput);

		const user = await c.get("db").select().from(users).where(eq(users.id, c.get("user").id)).get();
		if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
			throw new HTTPException(403, { message: "Current password is incorrect" });
		}

		await c
			.get("db")
			.update(users)
			.set({ passwordHash: await hashPassword(input.newPassword) })
			.where(eq(users.id, user.id));

		// Every other device loses its session; the caller re-authenticates too.
		await destroyAllSessions(c.get("db"), user.id);
		audit(c, { action: "profile.password_change" });

		return c.json({ ok: true });
	})

	.put("/forwarding", async (c) => {
		const input = await parseBody(c, forwardingInput);

		await c
			.get("db")
			.update(users)
			.set({ forwardingEmail: input.forwardingEmail })
			.where(eq(users.id, c.get("user").id));

		audit(c, { action: "profile.forwarding", metadata: { enabled: input.forwardingEmail !== null } });
		return c.json({ forwardingEmail: input.forwardingEmail });
	})

	.put("/telegram", async (c) => {
		const input = await parseBody(c, telegramNotificationsInput);

		await c
			.get("db")
			.update(users)
			.set({ telegramChatId: input.telegramChatId })
			.where(eq(users.id, c.get("user").id));

		audit(c, { action: "profile.telegram", metadata: { enabled: input.telegramChatId !== null } });
		return c.json({ telegramChatId: input.telegramChatId });
	})

	.put("/avatar", async (c) => {
		const user = c.get("user");

		// Read the old key before overwriting: `returning()` hands back the new row.
		const before = await c
			.get("db")
			.select({ avatarKey: users.avatarKey })
			.from(users)
			.where(eq(users.id, user.id))
			.get();

		const key = await putUpload(c.env, `avatars/users/${user.id}`, c.req.raw, {
			accept: ["image/png", "image/jpeg", "image/webp", "image/gif"],
			maxBytes: 2 * 1024 * 1024,
		});

		await c.get("db").update(users).set({ avatarKey: key }).where(eq(users.id, user.id));
		if (before?.avatarKey) await deleteObject(c.env, before.avatarKey);

		return c.json({ avatarKey: key, url: publicKeyFor(key) });
	})

	.delete("/avatar", async (c) => {
		const before = await c
			.get("db")
			.select({ avatarKey: users.avatarKey })
			.from(users)
			.where(eq(users.id, c.get("user").id))
			.get();

		await c.get("db").update(users).set({ avatarKey: null }).where(eq(users.id, c.get("user").id));
		if (before?.avatarKey) await deleteObject(c.env, before.avatarKey);

		return c.json({ ok: true });
	});
