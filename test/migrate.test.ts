import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { pendingMigrations, readMigrations, schemaIsMissing } from "@/worker/db/migrate";

/**
 * The Worker applies its own migrations, so the bundled SQL has to survive being
 * split back into statements — the FTS migration writes a trigger whose body holds
 * semicolons, which is exactly what naive splitting would tear in half.
 */
describe("bundled migrations", () => {
	it("carries every migration file, in order", () => {
		const names = readMigrations().map((migration) => migration.name);

		expect(names[0]).toBe("0000_init.sql");
		expect(names).toEqual([...names].toSorted());
		expect(names.every((name) => /^\d{4}_[\w-]+\.sql$/.test(name))).toBe(true);
	});

	it("splits on drizzle's breakpoints, keeping trigger bodies whole", () => {
		const fts = readMigrations().find((migration) => migration.name === "0001_message_search.sql");
		const trigger = fts?.statements.find((statement) => statement.includes("CREATE TRIGGER"));

		expect(fts?.statements.length).toBeGreaterThan(1);
		expect(trigger).toContain("END");
		expect(fts?.statements.every((statement) => statement.length > 0)).toBe(true);
	});

	it("sees a schema that is already there", async () => {
		expect(await schemaIsMissing(env)).toBe(false);
	});

	it("re-applies nothing once every file is recorded", async () => {
		for (const migration of readMigrations()) {
			await env.DB.prepare("INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)")
				.bind(migration.name)
				.run();
		}

		expect(await pendingMigrations(env)).toEqual([]);
	});
});
