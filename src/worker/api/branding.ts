import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { appSettings, SINGLETON_ID } from "@/db/schema";
import { brandingInput } from "@/shared/contract/settings";
import { audit } from "../audit";
import { requireAdmin } from "../middleware/auth";
import type { AppBindings } from "../middleware/context";
import { deleteObject, publicKeyFor, putUpload } from "../storage";
import { parseBody } from "./_util";

/**
 * Branding is free here. Mailflare gates it behind a paid licence; an open-source
 * instance has nobody to sell a licence to, so the gate is simply gone.
 */
export const brandingRoutes = new Hono<AppBindings>()
	.get("/", async (c) => {
		const row = await c.get("db").select().from(appSettings).get();
		return c.json({
			appName: row?.appName ?? c.env.APP_NAME,
			iconUrl: row?.iconKey ? publicKeyFor(row.iconKey) : null,
			accentColor: row?.accentColor ?? null,
			allowRegistration: row?.allowRegistration ?? false,
		});
	})

	.put("/", requireAdmin, async (c) => {
		const input = await parseBody(c, brandingInput);

		const row = await c
			.get("db")
			.insert(appSettings)
			.values({ id: SINGLETON_ID, ...input })
			.onConflictDoUpdate({ target: appSettings.id, set: input })
			.returning()
			.get();

		audit(c, { action: "branding.update", metadata: { appName: row.appName } });
		return c.json({
			appName: row.appName,
			iconUrl: row.iconKey ? publicKeyFor(row.iconKey) : null,
			accentColor: row.accentColor,
			allowRegistration: row.allowRegistration,
		});
	})

	.put("/icon", requireAdmin, async (c) => {
		const before = await c.get("db").select({ iconKey: appSettings.iconKey }).from(appSettings).get();

		const key = await putUpload(c.env, "branding/icon", c.req.raw, {
			accept: ["image/png", "image/svg+xml", "image/webp", "image/x-icon"],
			maxBytes: 512 * 1024,
		});

		await c
			.get("db")
			.insert(appSettings)
			.values({ id: SINGLETON_ID, iconKey: key })
			.onConflictDoUpdate({ target: appSettings.id, set: { iconKey: key } });

		if (before?.iconKey) await deleteObject(c.env, before.iconKey);
		audit(c, { action: "branding.icon" });

		return c.json({ iconUrl: publicKeyFor(key) });
	})

	.delete("/icon", requireAdmin, async (c) => {
		const before = await c.get("db").select({ iconKey: appSettings.iconKey }).from(appSettings).get();

		await c.get("db").update(appSettings).set({ iconKey: null }).where(eq(appSettings.id, SINGLETON_ID));
		if (before?.iconKey) await deleteObject(c.env, before.iconKey);

		return c.json({ ok: true });
	});
