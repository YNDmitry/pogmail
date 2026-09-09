import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { BACKUP_TABLES, backupPartKey, isBackupTable, readBackupManifest, readTableManifest } from "./format";

export type RestoreParams = { backupId: string; r2Key: string; actorUserId: string };

/**
 * Restore runs away from the request path and consumes one R2 part at a time. A
 * backup intentionally merges rows by id; it never deletes data created later.
 */
export class DatabaseRestoreWorkflow extends WorkflowEntrypoint<Env, RestoreParams> {
	override async run(event: WorkflowEvent<RestoreParams>, step: WorkflowStep): Promise<void> {
		const { actorUserId, backupId, r2Key } = event.payload;
		const manifest = await step.do("manifest", () => readBackupManifest(this.env, r2Key));
		let restored = 0;

		if (manifest) {
			for (const table of BACKUP_TABLES) {
				const entry = manifest.tables.find((item) => item.table === table);
				if (!entry) continue;
				const tableManifest = await step.do(`manifest:${table}`, () => readTableManifest(this.env, entry.manifestKey));
				for (let index = 0; index < tableManifest.partCount; index++) {
					restored += await step.do(`restore:${table}:${index}`, () =>
						this.restorePart(backupPartKey(tableManifest.prefix, index), table),
					);
				}
			}
		} else {
			// Backups made before v2 are one NDJSON object, already written table-by-table.
			restored = await step.do("restore:legacy", () => this.restorePart(r2Key));
		}

		await step.do("audit", async () => {
			await this.env.DB.prepare(
				"INSERT INTO audit_logs (actor_user_id, action, metadata) VALUES (?, ?, ?)",
			)
				.bind(actorUserId, "backup.restore", JSON.stringify({ id: backupId, restored }))
				.run();
		});
	}

	private async restorePart(key: string, expectedTable?: string): Promise<number> {
		const object = await this.env.MAIL_BUCKET.get(key);
		if (!object?.body) throw new Error(`Backup part ${key} is missing`);

		let currentTable = expectedTable;
		let batch: Record<string, unknown>[] = [];
		let restored = 0;

		const flush = async () => {
			if (!currentTable || !batch.length) return;
			await this.env.DB.batch(batch.map((row) => insertRow(this.env.DB, currentTable!, row)));
			restored += batch.length;
			batch = [];
		};

		for await (const line of ndjsonLines(object.body)) {
			const entry = parseBackupEntry(line, expectedTable);
			if (currentTable && entry.table !== currentTable) await flush();
			currentTable = entry.table;
			batch.push(entry.row);
			if (batch.length === 50) await flush();
		}
		await flush();
		return restored;
	}
}

function insertRow(db: D1Database, table: string, row: Record<string, unknown>): D1PreparedStatement {
	const columns = Object.keys(row);
	if (!columns.length) throw new Error(`Backup row for ${table} has no columns`);
	const placeholders = columns.map(() => "?").join(", ");
	return db
		.prepare(`INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`)
		.bind(...columns.map((column) => row[column] ?? null));
}

function parseBackupEntry(line: string, expectedTable: string | undefined): { table: string; row: Record<string, unknown> } {
	const value = JSON.parse(line) as unknown;
	if (
		typeof value !== "object" ||
		value === null ||
		!("table" in value) ||
		!("row" in value) ||
		typeof value.table !== "string" ||
		!isBackupTable(value.table) ||
		typeof value.row !== "object" ||
		value.row === null
	) {
		throw new Error("Backup contains an invalid row");
	}
	if (expectedTable && value.table !== expectedTable) throw new Error(`Backup part contains ${value.table}, expected ${expectedTable}`);
	return { table: value.table, row: value.row as Record<string, unknown> };
}

async function* ndjsonLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let pending = "";

	try {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			pending += decoder.decode(chunk.value, { stream: true });

			for (;;) {
				const newline = pending.indexOf("\n");
				if (newline === -1) break;
				const line = pending.slice(0, newline);
				pending = pending.slice(newline + 1);
				if (line) yield line;
			}
		}
		pending += decoder.decode();
		if (pending) yield pending;
	} finally {
		reader.releaseLock();
	}
}
