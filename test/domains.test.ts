import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { hashPassword } from "@/worker/auth/password";
import { createSession, SESSION_COOKIE } from "@/worker/auth/session";
import { api } from "@/worker/api";

const testUsers: string[] = [];

afterEach(async () => {
	const db = getDb(env.DB);
	for (const userId of testUsers.splice(0)) {
		await db.delete(users).where(eq(users.id, userId));
	}
});

async function createAdminSession() {
	const db = getDb(env.DB);
	const user = await db
		.insert(users)
		.values({
			email: `domains-${crypto.randomUUID()}@example.test`,
			name: "Domain tester",
			passwordHash: await hashPassword("test password"),
			role: "admin",
		})
		.returning()
		.get();
	testUsers.push(user.id);

	return createSession(db, user.id);
}

describe("domain provisioning", () => {
	it("lets an admin add an active .test domain through the local mock", async () => {
		const session = await createAdminSession();
		const response = await api.fetch(
			new Request("https://pogmail.test/api/domains", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					cookie: `${SESSION_COOKIE}=${session.token}`,
				},
				body: JSON.stringify({ hostname: "acme.test" }),
			}),
			{ ...env, DEV_MOCK_CLOUDFLARE: "true" } as Env,
		);

		expect(response.status).toBe(201);
		expect(await response.json()).toMatchObject({
			hostname: "acme.test",
			status: "active",
			routingEnabled: true,
			routingStatus: "mock",
			sendingEnabled: true,
		});
	});
});
