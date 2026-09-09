import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { backupPartKey, deleteBackupObjects, readBackupManifest, serveBackup } from "@/worker/backups/format";

const rootKey = `backups/test-${crypto.randomUUID()}/manifest.json`;
const prefix = rootKey.replace(/\/manifest\.json$/, "/tables/users");
const tableManifestKey = `${prefix}/manifest.json`;

afterEach(async () => {
	await deleteBackupObjects(env, rootKey).catch(() => undefined);
});

describe("version 2 backup manifests", () => {
	it("recognises a pre-manifest NDJSON backup", async () => {
		await env.MAIL_BUCKET.put(rootKey, '{"table":"users","row":{"id":"legacy"}}\n');

		expect(await readBackupManifest(env, rootKey)).toBeNull();
	});

	it("streams every R2 part as one downloadable NDJSON file", async () => {
		await env.MAIL_BUCKET.put(
			rootKey,
			JSON.stringify({ version: 2, tables: [{ table: "users", manifestKey: tableManifestKey }] }),
		);
		await env.MAIL_BUCKET.put(
			tableManifestKey,
			JSON.stringify({ version: 2, table: "users", prefix, partCount: 2, count: 2, sizeBytes: 42 }),
		);
		await env.MAIL_BUCKET.put(backupPartKey(prefix, 0), '{"table":"users","row":{"id":"one"}}\n');
		await env.MAIL_BUCKET.put(backupPartKey(prefix, 1), '{"table":"users","row":{"id":"two"}}\n');

		const response = await serveBackup(env, rootKey, "backup.ndjson");

		expect(response.headers.get("content-type")).toBe("application/x-ndjson");
		expect(new TextDecoder().decode(await response.arrayBuffer())).toBe(
			'{"table":"users","row":{"id":"one"}}\n{"table":"users","row":{"id":"two"}}\n',
		);
	});

	it("deletes the root manifest, table manifests and all parts", async () => {
		await env.MAIL_BUCKET.put(
			rootKey,
			JSON.stringify({ version: 2, tables: [{ table: "users", manifestKey: tableManifestKey }] }),
		);
		await env.MAIL_BUCKET.put(
			tableManifestKey,
			JSON.stringify({ version: 2, table: "users", prefix, partCount: 1, count: 1, sizeBytes: 21 }),
		);
		const partKey = backupPartKey(prefix, 0);
		await env.MAIL_BUCKET.put(partKey, '{"table":"users"}\n');

		await deleteBackupObjects(env, rootKey);

		expect(await env.MAIL_BUCKET.get(rootKey)).toBeNull();
		expect(await env.MAIL_BUCKET.get(tableManifestKey)).toBeNull();
		expect(await env.MAIL_BUCKET.get(partKey)).toBeNull();
	});
});
