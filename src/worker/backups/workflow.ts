import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { eq, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { backupSettings, backups } from "@/db/schema";

export type BackupParams = { backupId: string };

/**
 * Tables are dumped one at a time, each as its own workflow step, so a failure retries
 * only the table that failed rather than the whole export. D1 has no native dump over
 * the binding API, so this reads rows and writes newline-delimited JSON to R2.
 */
const TABLES = [
	"users",
	"sessions",
	"api_keys",
	"audit_logs",
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
	"app_settings",
	"backup_settings",
] as const;

const PAGE_SIZE = 500;

export class DatabaseBackupWorkflow extends WorkflowEntrypoint<Env, BackupParams> {
	override async run(event: WorkflowEvent<BackupParams>, step: WorkflowStep): Promise<void> {
		const db = getDb(this.env.DB);
		const { backupId } = event.payload;

		const key = await step.do("start", async () => {
			const filename = `pogmail-${new Date().toISOString().replaceAll(":", "-")}.ndjson`;
			const r2Key = `backups/${backupId}/${filename}`;

			await db
				.update(backups)
				.set({ status: "running", startedAt: new Date(), filename, r2Key })
				.where(eq(backups.id, backupId));

			return r2Key;
		});

		const counts: Record<string, number> = {};
		const parts: string[] = [];

		for (const table of TABLES) {
			const chunk = await step.do(`dump:${table}`, async () => {
				const lines: string[] = [];
				let offset = 0;

				// Paged, because a single unbounded SELECT on `messages` will not fit
				// in a Worker's memory on any instance that has been running a while.
				for (;;) {
					const page = await this.env.DB.prepare(
						`SELECT * FROM ${table} LIMIT ? OFFSET ?`,
					)
						.bind(PAGE_SIZE, offset)
						.all();

					for (const row of page.results) lines.push(JSON.stringify({ table, row }));
					if (page.results.length < PAGE_SIZE) break;
					offset += PAGE_SIZE;
				}

				return { count: lines.length, body: lines.join("\n") };
			});

			counts[table] = chunk.count;
			if (chunk.body) parts.push(chunk.body);
		}

		await step.do("finish", async () => {
			const body = `${parts.join("\n")}\n`;
			await this.env.MAIL_BUCKET.put(key, body, {
				httpMetadata: { contentType: "application/x-ndjson" },
			});

			await db
				.update(backups)
				.set({
					status: "completed",
					completedAt: new Date(),
					sizeBytes: new TextEncoder().encode(body).byteLength,
					tableCounts: counts,
				})
				.where(eq(backups.id, backupId));
		});

		await step.do("prune", async () => {
			const settings = await db.select().from(backupSettings).get();
			if (!settings?.retentionEnabled) return;

			const cutoff = new Date(Date.now() - settings.retentionDays * 86_400_000);
			const stale = await db.select().from(backups).where(lt(backups.createdAt, cutoff)).all();

			for (const old of stale) {
				if (old.r2Key) await this.env.MAIL_BUCKET.delete(old.r2Key);
				await db.delete(backups).where(eq(backups.id, old.id));
			}
		});
	}
}
