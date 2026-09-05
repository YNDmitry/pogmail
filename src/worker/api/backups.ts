import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { BACKUP_SCHEDULES, backupSettings, backups, SINGLETON_ID } from "@/db/schema";
import { audit } from "../audit";
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

/** Parents before children, so foreign keys resolve as rows go back in. */
const RESTORE_ORDER = [
	"users",
	"app_settings",
	"backup_settings",
	"sessions",
	"api_keys",
	"domains",
	"domain_records",
	"mailboxes",
	"mailbox_aliases",
	"mailbox_access",
	"auto_reply_deliveries",
	"folders",
	"messages",
	"message_attachments",
	"contacts",
	"outbound_jobs",
	"email_templates",
	"calendar_events",
	"routing_rules",
	"webhooks",
	"webhook_deliveries",
	"audit_logs",
] as const;

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
		return serveObject(c.env, row.r2Key, row.filename ?? `${row.id}.ndjson`);
	})

	/**
	 * Replays a backup back into D1. Rows are written with INSERT OR REPLACE in
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

		const object = await c.env.MAIL_BUCKET.get(backup.r2Key);
		if (!object) throw new HTTPException(410, { message: "The backup file is no longer in storage" });

		const lines = (await object.text()).split("\n").filter(Boolean);

		// Group by table first: the dump is written table by table, but grouping
		// makes the ordering explicit rather than implied by the file.
		const byTable = new Map<string, Record<string, unknown>[]>();
		for (const line of lines) {
			const entry = JSON.parse(line) as { table: string; row: Record<string, unknown> };
			byTable.set(entry.table, [...(byTable.get(entry.table) ?? []), entry.row]);
		}

		let restored = 0;
		for (const table of RESTORE_ORDER) {
			const rows = byTable.get(table);
			if (!rows?.length) continue;

			for (let index = 0; index < rows.length; index += 50) {
				const chunk = rows.slice(index, index + 50);
				await c.env.DB.batch(
					chunk.map((row) => {
						const columns = Object.keys(row);
						const placeholders = columns.map(() => "?").join(", ");
						return c.env.DB.prepare(
							`INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
						).bind(...columns.map((column) => row[column] ?? null));
					}),
				);
				restored += chunk.length;
			}
		}

		audit(c, { action: "backup.restore", metadata: { id: backup.id, restored } });
		return c.json({ restored });
	})

	.delete("/:id", async (c) => {
		const row = await c.get("db").select().from(backups).where(eq(backups.id, c.req.param("id"))).get();
		if (!row) notFound("Backup");

		if (row.r2Key) await c.env.MAIL_BUCKET.delete(row.r2Key);
		await c.get("db").delete(backups).where(eq(backups.id, row.id));

		audit(c, { action: "backup.delete", metadata: { id: row.id } });
		return c.json({ ok: true });
	});
