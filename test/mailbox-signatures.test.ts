import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, expect, it } from "vitest";
import { getDb } from "@/db";
import { domains, mailboxSignatures, mailboxes, users } from "@/db/schema";
import { api } from "@/worker/api";
import { createSession, SESSION_COOKIE } from "@/worker/auth/session";
import { readMigrations } from "@/worker/db/migrate";
import { appendSignatureHtml } from "@/worker/email/send";

const ids: string[] = [];
const request = (path: string, method: string, cookie: string, body?: unknown) => api.fetch(new Request(path, {
	method, headers: { cookie, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
}), env);
afterEach(async () => {
	const db = getDb(env.DB);
	for (const id of ids.splice(0)) await db.delete(users).where(eq(users.id, id));
});

it("appends formatted signature HTML rather than printing markup as text", () => {
	expect(appendSignatureHtml("<p>Hello</p>", "Hello", "<p><strong>Best, Alex</strong></p>", "Best, Alex"))
		.toBe("<p>Hello</p><hr><p><strong>Best, Alex</strong></p>");
});

it("migrates old mailbox HTML signatures without losing their formatting", async () => {
	const db = getDb(env.DB);
	const user = await db.insert(users).values({ email: `${crypto.randomUUID()}@example.test`, name: "Owner", passwordHash: "unused" }).returning().get();
	ids.push(user.id);
	const domain = await db.insert(domains).values({ hostname: `${crypto.randomUUID()}.test`, zoneId: "test", userId: user.id, status: "active" }).returning().get();
	const mailbox = await db.insert(mailboxes).values({ userId: user.id, domainId: domain.id, localPart: "mail", signature: "Best, Alex", signatureHtml: "<p><strong>Best, Alex</strong></p>" }).returning().get();
	const migration = readMigrations().find((entry) => entry.name === "0031_mailbox_signatures.sql");
	const backfill = migration?.statements.at(-1);
	expect(backfill).toBeDefined();
	await env.DB.prepare(backfill!).run();
	await env.DB.prepare(backfill!).run();
	expect(await db.select().from(mailboxSignatures).where(eq(mailboxSignatures.mailboxId, mailbox.id)).all())
		.toEqual([expect.objectContaining({ name: "Signature", bodyText: "Best, Alex", bodyHtml: "<p><strong>Best, Alex</strong></p>", isDefault: true })]);
});

it("keeps named HTML signatures, switches the default, and scopes edits to the mailbox", async () => {
	const db = getDb(env.DB);
	async function owner() {
		const user = await db.insert(users).values({ email: `${crypto.randomUUID()}@example.test`, name: "Owner", passwordHash: "unused" }).returning().get();
		ids.push(user.id);
		const domain = await db.insert(domains).values({ hostname: `${crypto.randomUUID()}.test`, zoneId: "test", userId: user.id, status: "active" }).returning().get();
		const mailbox = await db.insert(mailboxes).values({ userId: user.id, domainId: domain.id, localPart: "mail" }).returning().get();
		const session = await createSession(db, user.id);
		return { mailbox, cookie: `${SESSION_COOKIE}=${session.token}` };
	}
	const first = await owner();
	const other = await owner();
	const url = `https://pogmail.test/api/mailboxes/${first.mailbox.id}/signatures`;
	const business = await request(url, "POST", first.cookie, { name: "Work", bodyText: "Best, Alex", bodyHtml: "<p><strong>Best, Alex</strong></p>" });
	expect(business.status).toBe(201);
	const work = await business.json() as { id: string; isDefault: boolean };
	expect(work.isDefault).toBe(true);
	const personal = await request(url, "POST", first.cookie, { name: "Personal", bodyText: "Cheers", bodyHtml: "<p><em>Cheers</em></p>" });
	expect(personal.status).toBe(201);
	const home = await personal.json() as { id: string; isDefault: boolean };
	expect(home.isDefault).toBe(false);
	const denied = await request(`${url}/default`, "PUT", other.cookie, { signatureId: home.id });
	expect(denied.status).toBe(404);
	const crossMailbox = await request(`${url}/default`, "PUT", first.cookie, { signatureId: other.mailbox.id });
	expect(crossMailbox.status).toBe(404);
	expect((await request(`${url}/default`, "PUT", first.cookie, { signatureId: home.id })).status).toBe(200);
	const selected = await db.select().from(mailboxSignatures).where(eq(mailboxSignatures.mailboxId, first.mailbox.id)).all();
	expect(selected).toEqual(expect.arrayContaining([
		expect.objectContaining({ id: work.id, isDefault: false, bodyHtml: "<p><strong>Best, Alex</strong></p>" }),
		expect.objectContaining({ id: home.id, isDefault: true, bodyHtml: "<p><em>Cheers</em></p>" }),
	]));
	expect((await request(`${url}/${home.id}`, "PATCH", first.cookie, { name: "Personal", bodyText: "Thanks", bodyHtml: "<p>Thanks</p>" })).status).toBe(200);
	expect((await request(`${url}/${work.id}`, "DELETE", other.cookie)).status).toBe(404);
	expect((await request(`${url}/default`, "PUT", first.cookie, { signatureId: null })).status).toBe(200);
	const list = await request(url, "GET", first.cookie);
	const { items } = await list.json() as { items: { isDefault: boolean }[] };
	expect(items.every((item) => !item.isDefault)).toBe(true);
	const third = await request(url, "POST", first.cookie, { name: "Other", bodyText: "Bye", bodyHtml: "<p>Bye</p>" });
	expect((await third.json() as { isDefault: boolean }).isDefault).toBe(false);
});
