import { HTTPException } from "hono/http-exception";

/**
 * Tables deliberately exclude `backups`: a dump is its own artifact, and restoring
 * its catalogue would make stale R2 references look live again. The remaining list
 * is in parent-before-child order, so its NDJSON can also be restored as a stream.
 */
export const BACKUP_TABLES = [
	"users",
	"app_settings",
	"update_settings",
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
	"outbound_deliveries",
	"email_templates",
	"template_attachments",
	"calendar_events",
	"routing_rules",
	"webhooks",
	"webhook_deliveries",
	"audit_logs",
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];

export type BackupManifest = {
	version: 2;
	tables: { table: BackupTable; manifestKey: string }[];
};

export type BackupTableManifest = {
	version: 2;
	table: BackupTable;
	prefix: string;
	partCount: number;
	count: number;
	sizeBytes: number;
};

export function isBackupTable(value: string): value is BackupTable {
	return (BACKUP_TABLES as readonly string[]).includes(value);
}

export function backupPartKey(prefix: string, index: number): string {
	return `${prefix}/${index}.ndjson`;
}

export async function readBackupManifest(env: Env, key: string): Promise<BackupManifest | null> {
	try {
		const value = await readJson(env, key);
		return isBackupManifest(value) ? value : null;
	} catch (error) {
		// v1 backups are NDJSON rather than a JSON manifest.
		if (error instanceof SyntaxError) return null;
		throw error;
	}
}

export async function readTableManifest(env: Env, key: string): Promise<BackupTableManifest> {
	const value = await readJson(env, key);
	if (!isTableManifest(value)) throw new Error(`Backup table manifest at ${key} is invalid`);
	return value;
}

/** Deletes every generated object, while preserving compatibility with v1 dumps. */
export async function deleteBackupObjects(env: Env, rootKey: string): Promise<void> {
	const manifest = await readBackupManifest(env, rootKey);
	if (!manifest) {
		await env.MAIL_BUCKET.delete(rootKey);
		return;
	}

	for (const entry of manifest.tables) {
		const table = await readTableManifest(env, entry.manifestKey);
		for (let index = 0; index < table.partCount; index++) {
			await env.MAIL_BUCKET.delete(backupPartKey(table.prefix, index));
		}
		await env.MAIL_BUCKET.delete(entry.manifestKey);
	}
	await env.MAIL_BUCKET.delete(rootKey);
}

/** Streams a v2 dump as the same NDJSON file that administrators download. */
export async function serveBackup(env: Env, rootKey: string, filename: string): Promise<Response> {
	const manifest = await readBackupManifest(env, rootKey);
	if (!manifest) {
		throw new HTTPException(409, { message: "This legacy backup must be downloaded directly" });
	}

	const iterator = backupChunks(env, manifest);
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const next = await iterator.next();
				if (next.done) controller.close();
				else controller.enqueue(next.value);
			} catch (error) {
				controller.error(error);
			}
		},
		async cancel() {
			await iterator.return?.(undefined);
		},
	});

	const headers = new Headers({
		"cache-control": "private, max-age=31536000, immutable",
		"content-type": "application/x-ndjson",
		"content-disposition": `attachment; filename="${filename.replaceAll('"', "")}"`,
	});
	return new Response(body, { headers });
}

async function* backupChunks(env: Env, manifest: BackupManifest): AsyncGenerator<Uint8Array> {
	for (const entry of manifest.tables) {
		const table = await readTableManifest(env, entry.manifestKey);
		for (let index = 0; index < table.partCount; index++) {
			const object = await env.MAIL_BUCKET.get(backupPartKey(table.prefix, index));
			if (!object?.body) throw new Error(`Backup part ${table.table}/${index} is missing`);

			const reader = object.body.getReader();
			try {
				for (;;) {
					const chunk = await reader.read();
					if (chunk.done) break;
					yield chunk.value;
				}
			} finally {
				reader.releaseLock();
			}
		}
	}
}

async function readJson(env: Env, key: string): Promise<unknown> {
	const object = await env.MAIL_BUCKET.get(key);
	if (!object) throw new Error(`Backup metadata at ${key} is missing`);
	return JSON.parse(await object.text()) as unknown;
}

function isBackupManifest(value: unknown): value is BackupManifest {
	if (!isRecord(value) || value.version !== 2 || !Array.isArray(value.tables)) return false;
	return value.tables.every(
		(entry) =>
			isRecord(entry) && typeof entry.manifestKey === "string" && typeof entry.table === "string" && isBackupTable(entry.table),
	);
}

function isTableManifest(value: unknown): value is BackupTableManifest {
	return (
		isRecord(value) &&
		value.version === 2 &&
		typeof value.table === "string" &&
		isBackupTable(value.table) &&
		typeof value.prefix === "string" &&
		typeof value.partCount === "number" &&
		typeof value.count === "number" &&
		typeof value.sizeBytes === "number"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
