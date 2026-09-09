import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { eq, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { backupSettings, backups } from "@/db/schema";
import { BACKUP_TABLES, backupPartKey, deleteBackupObjects, type BackupTableManifest } from "./format";

export type BackupParams = { backupId: string };

/**
 * Tables are read in small R2-backed parts. This keeps every Workflow step result tiny,
 * and lets a retry overwrite only its deterministic part rather than restart the export.
 */
/* A bounded part avoids both a Workflow's 1 MiB step-result limit and a full-table heap spike. */
const ROWS_PER_PART = 50;

export class DatabaseBackupWorkflow extends WorkflowEntrypoint<Env, BackupParams> {
	override async run(event: WorkflowEvent<BackupParams>, step: WorkflowStep): Promise<void> {
		const db = getDb(this.env.DB);
		const { backupId } = event.payload;

		const backup = await step.do("start", async () => {
			const filename = `pogmail-${new Date().toISOString().replaceAll(":", "-")}.ndjson`;
			const prefix = `backups/${backupId}`;
			const r2Key = `${prefix}/manifest.json`;

			await db
				.update(backups)
				.set({ status: "running", startedAt: new Date(), filename, r2Key })
				.where(eq(backups.id, backupId));

			return { prefix, r2Key };
		});

		const counts: Record<string, number> = {};
		const manifests: { table: (typeof BACKUP_TABLES)[number]; manifestKey: string }[] = [];
		let totalSizeBytes = 0;

		for (const table of BACKUP_TABLES) {
			let cursor = 0;
			let partCount = 0;
			let count = 0;
			let sizeBytes = 0;
			const prefix = `${backup.prefix}/tables/${table}`;

			for (;;) {
				const part = await step.do(`dump:${table}:${partCount}`, async () => {
					const page = await this.env.DB.prepare(
						`SELECT rowid AS backup_row_id, * FROM ${table} WHERE rowid > ? ORDER BY rowid LIMIT ?`,
					)
						.bind(cursor, ROWS_PER_PART)
						.all<Record<string, unknown>>();

					if (!page.results.length) return { count: 0, cursor, sizeBytes: 0 };

					const rows = page.results.map((result) => {
						const { backup_row_id, ...row } = result;
						return row;
					});
					const body = rows.map((row) => JSON.stringify({ table, row })).join("\n") + "\n";
					const bytes = new TextEncoder().encode(body).byteLength;
					await this.env.MAIL_BUCKET.put(backupPartKey(prefix, partCount), body, {
						httpMetadata: { contentType: "application/x-ndjson" },
					});

					return { count: rows.length, cursor: Number(backupRowId(page.results.at(-1))), sizeBytes: bytes };
				});

				if (!part.count) break;
				cursor = part.cursor;
				count += part.count;
				sizeBytes += part.sizeBytes;
				partCount++;
			}

			const tableManifest: BackupTableManifest = {
				version: 2,
				table,
				prefix,
				partCount,
				count,
				sizeBytes,
			};
			const manifestKey = `${prefix}/manifest.json`;
			await step.do(`manifest:${table}`, async () => {
				await this.env.MAIL_BUCKET.put(manifestKey, JSON.stringify(tableManifest), {
					httpMetadata: { contentType: "application/json" },
				});
			});

			counts[table] = count;
			totalSizeBytes += sizeBytes;
			manifests.push({ table, manifestKey });
		}

		await step.do("finish", async () => {
			await this.env.MAIL_BUCKET.put(backup.r2Key, JSON.stringify({ version: 2, tables: manifests }), {
				httpMetadata: { contentType: "application/json" },
			});

			await db
				.update(backups)
				.set({
					status: "completed",
					completedAt: new Date(),
					sizeBytes: totalSizeBytes,
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
				if (old.r2Key) await deleteBackupObjects(this.env, old.r2Key);
				await db.delete(backups).where(eq(backups.id, old.id));
			}
		});
	}
}

function backupRowId(row: Record<string, unknown> | undefined): number {
	const value = row?.backup_row_id;
	if (typeof value !== "number" || !Number.isSafeInteger(value)) {
		throw new Error("D1 returned an invalid backup row cursor");
	}
	return value;
}
