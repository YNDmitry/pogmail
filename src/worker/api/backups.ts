import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { BACKUP_SCHEDULES, backupSettings, backups, SINGLETON_ID } from "@/db/schema";
import { audit } from "../audit";
import { deleteBackupObjects, readBackupManifest, serveBackup } from "../backups/format";
import { requireAdmin } from "../middleware/auth";
import type { AppBindings } from "../middleware/context";
import { serveObject } from "../storage";
import { notFound, parseBody } from "./_util";

const settingsInput = z.object({
	enabled: z.boolean(),
	scheduleType: z.enum(BACKUP_SCHEDULES),
	scheduleValue: z.number().int().min(0).max(28).nullable().optional(),
	retentionEnabled: z.boolean(),
	retentionDays: z.number().int().min(1).max(3650),
});

export const backupRoutes = new Hono<AppBindings>()
	.use("*", requireAdmin)

	.get("/", async (c) => {
		const [rows, settings] = await Promise.all([
			c.get("db").select().from(backups).orderBy(desc(backups.createdAt)).limit(50).all(),
			c.get("db").select().from(backupSettings).get(),
		]);

		return c.json({ items: rows, settings: settings ?? null });
	})

	.put("/settings", async (c) => {
		const input = await parseBody(c, settingsInput);

		const row = await c
			.get("db")
			.insert(backupSettings)
			.values({ id: SINGLETON_ID, ...input })
			.onConflictDoUpdate({ target: backupSettings.id, set: input })
			.returning()
			.get();

		audit(c, { action: "backup.settings", metadata: { enabled: row.enabled } });
		return c.json(row);
	})

	.post("/", async (c) => {
		const row = await c
			.get("db")
			.insert(backups)
			.values({ trigger: "manual", createdByUserId: c.get("user").id })
			.returning()
			.get();

		// The workflow owns the long-running export; this request just starts it.
		await c.env.BACKUP_WORKFLOW.create({ id: row.id, params: { backupId: row.id } });

		audit(c, { action: "backup.start", metadata: { id: row.id } });
		return c.json(row, 202);
	})

	.get("/:id", async (c) => {
		const row = await c.get("db").select().from(backups).where(eq(backups.id, c.req.param("id"))).get();
		if (!row) notFound("Backup");

		// Live workflow state beats the row, which only updates at step boundaries.
		const instance = await c.env.BACKUP_WORKFLOW.get(row.id).catch(() => null);
		const status = await instance?.status().catch(() => null);

		return c.json({ ...row, workflow: status });
	})

	.get("/:id/download", async (c) => {
		const row = await c.get("db").select().from(backups).where(eq(backups.id, c.req.param("id"))).get();
		if (!row) notFound("Backup");
		if (!row.r2Key || row.status !== "completed") {
			throw new HTTPException(409, { message: "That backup is not ready yet" });
		}

		audit(c, { action: "backup.download", metadata: { id: row.id } });
		const manifest = await readBackupManifest(c.env, row.r2Key);
		return manifest
			? serveBackup(c.env, row.r2Key, row.filename ?? `${row.id}.ndjson`)
			: serveObject(c.env, row.r2Key, row.filename ?? `${row.id}.ndjson`);
	})

	/**
	 * Starts a streamed restore Workflow. Rows are written with INSERT OR REPLACE in
	 * foreign-key order, so a restore overwrites by id rather than duplicating.
	 *
	 * This overwrites live data, so it needs the phrase typed out — an accidental
	 * click must not be able to roll the instance back.
	 */
	.post("/:id/restore", async (c) => {
		const input = await parseBody(c, z.object({ confirm: z.literal("restore") }));
		void input;

		const backup = await c.get("db").select().from(backups).where(eq(backups.id, c.req.param("id"))).get();
		if (!backup) notFound("Backup");
		if (!backup.r2Key || backup.status !== "completed") {
			throw new HTTPException(409, { message: "That backup did not complete, so it cannot be restored" });
		}

		const object = await c.env.MAIL_BUCKET.head(backup.r2Key);
		if (!object) throw new HTTPException(410, { message: "The backup file is no longer in storage" });

		const id = `restore-${backup.id}-${crypto.randomUUID()}`;
		await c.env.RESTORE_WORKFLOW.create({
			id,
			params: { backupId: backup.id, r2Key: backup.r2Key, actorUserId: c.get("user").id },
		});

		audit(c, { action: "backup.restore_start", metadata: { id: backup.id, workflowId: id } });
		return c.json({ workflowId: id }, 202);
	})

	.delete("/:id", async (c) => {
		const row = await c.get("db").select().from(backups).where(eq(backups.id, c.req.param("id"))).get();
		if (!row) notFound("Backup");

		if (row.r2Key) await deleteBackupObjects(c.env, row.r2Key);
		await c.get("db").delete(backups).where(eq(backups.id, row.id));

		audit(c, { action: "backup.delete", metadata: { id: row.id } });
		return c.json({ ok: true });
	});
