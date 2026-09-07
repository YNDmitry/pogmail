/**
 * Applying migrations from inside the Worker.
 *
 * The alternative was a GitHub Action holding a Cloudflare API token, which every
 * installation would have to be given by hand — a second credential, in a second
 * place, to do something the Worker is already connected to the database to do.
 * The SQL is bundled at build time, so a deployment always carries exactly the
 * migrations its code expects.
 *
 * Bookkeeping matches wrangler's: the same `d1_migrations` table, keyed by the same
 * file names, so `wrangler d1 migrations apply` and this agree about what has run
 * and neither repeats the other's work.
 */
const files = import.meta.glob<string>("../../../drizzle/migrations/*.sql", {
	query: "?raw",
	import: "default",
	eager: true,
});

/** Wrangler's table, created exactly as wrangler creates it. */
const BOOKKEEPING = `CREATE TABLE IF NOT EXISTS d1_migrations (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT UNIQUE,
	applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

export type Migration = { name: string; statements: string[] };

/**
 * Drizzle separates statements with `--> statement-breakpoint`; the hand-written
 * FTS migration follows the same convention, which is what makes splitting safe
 * around a `CREATE TRIGGER ... BEGIN ... END` that contains its own semicolons.
 */
export function readMigrations(): Migration[] {
	return Object.entries(files)
		.map(([path, sql]) => ({
			name: path.split("/").pop() ?? path,
			statements: sql
				.split("--> statement-breakpoint")
				.map((statement) => statement.trim())
				.filter((statement) => statement.length > 0),
		}))
		.toSorted((a, b) => a.name.localeCompare(b.name));
}

async function appliedNames(env: Env): Promise<Set<string>> {
	await env.DB.prepare(BOOKKEEPING).run();
	const { results } = await env.DB.prepare("SELECT name FROM d1_migrations").all<{ name: string }>();
	return new Set(results.map((row) => row.name));
}

export async function pendingMigrations(env: Env): Promise<Migration[]> {
	const applied = await appliedNames(env);
	return readMigrations().filter((migration) => !applied.has(migration.name));
}

/**
 * Runs what has not run yet, in order, recording each file only once every one of
 * its statements has succeeded. D1 has no cross-statement transaction here, so a
 * migration that fails halfway stays unrecorded and is retried — write them so a
 * second attempt is harmless (`IF NOT EXISTS`), the way the existing ones are.
 */
export async function applyPendingMigrations(env: Env): Promise<string[]> {
	const pending = await pendingMigrations(env);
	const applied: string[] = [];

	for (const migration of pending) {
		for (const statement of migration.statements) {
			await env.DB.prepare(statement).run();
		}

		await env.DB.prepare("INSERT INTO d1_migrations (name) VALUES (?)").bind(migration.name).run();
		applied.push(migration.name);
	}

	return applied;
}

/** True before the first migration has ever run: the schema is not there at all. */
export async function schemaIsMissing(env: Env): Promise<boolean> {
	const row = await env.DB.prepare(
		"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'",
	).first<{ name: string }>();

	return row === null;
}
