import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { domains, mailboxes, messages, users } from "@/db/schema";
import { api } from "@/worker/api";
import { hashPassword } from "@/worker/auth/password";
import { createSession, SESSION_COOKIE } from "@/worker/auth/session";

const createdUsers: string[] = [];

afterEach(async () => {
	const db = getDb(env.DB);
	for (const id of createdUsers.splice(0)) await db.delete(users).where(eq(users.id, id));
});

async function request(path: string, session: string) {
	return api.fetch(
		new Request(`https://pogmail.test/api${path}`, { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${session}` } }),
		{ ...env, DEV_MOCK_CLOUDFLARE: "true" } as Env,
	);
}

describe("local demo seed", () => {
	it("creates a local domain, mailbox, and sample inbox once", async () => {
		const db = getDb(env.DB);
		const user = await db.insert(users).values({
			email: `demo-${crypto.randomUUID()}@example.test`, name: "Demo", passwordHash: await hashPassword("test password"),
		}).returning().get();
		createdUsers.push(user.id);
		const session = await createSession(db, user.id);

		expect((await request("/demo/seed", session.token)).status).toBe(200);
		expect((await request("/demo/seed", session.token)).status).toBe(200);

		const domain = await db.select().from(domains).where(eq(domains.userId, user.id)).get();
		const mailbox = await db.select().from(mailboxes).where(eq(mailboxes.userId, user.id)).get();
		const sample = mailbox ? await db.select().from(messages).where(eq(messages.mailboxId, mailbox.id)).all() : [];
		expect(domain).toMatchObject({ hostname: "acme.test", status: "active", routingStatus: "mock" });
		expect(mailbox?.localPart).toBe("hello");
		expect(sample).toHaveLength(2);
	});

	it("adds the screenshot showcase without duplicating it", async () => {
		const db = getDb(env.DB);
		const user = await db.insert(users).values({
			email: `showcase-${crypto.randomUUID()}@example.test`, name: "Showcase", passwordHash: await hashPassword("test password"),
		}).returning().get();
		createdUsers.push(user.id);
		const session = await createSession(db, user.id);

		const first = await api.fetch(
			new Request("https://pogmail.test/api/demo/seed", {
				method: "POST",
				headers: { cookie: `${SESSION_COOKIE}=${session.token}`, "content-type": "application/json" },
				body: JSON.stringify({ showcase: true }),
			}),
			{ ...env, DEV_MOCK_CLOUDFLARE: "true" } as Env,
		);
		expect(first.status).toBe(200);
		const second = await api.fetch(
			new Request("https://pogmail.test/api/demo/seed", {
				method: "POST",
				headers: { cookie: `${SESSION_COOKIE}=${session.token}`, "content-type": "application/json" },
				body: JSON.stringify({ showcase: true }),
			}),
			{ ...env, DEV_MOCK_CLOUDFLARE: "true" } as Env,
		);
		expect(second.status).toBe(200);
		const mailbox = await db.select().from(mailboxes).where(eq(mailboxes.userId, user.id)).get();
		const sample = mailbox ? await db.select().from(messages).where(eq(messages.mailboxId, mailbox.id)).all() : [];
		expect(sample).toHaveLength(8);
	});
});
