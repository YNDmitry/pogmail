import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, expect, it } from "vitest";
import { getDb } from "@/db";
import { domains, folders, mailboxAccess, mailboxes, messages, users } from "@/db/schema";
import { api } from "@/worker/api";
import { createSession, SESSION_COOKIE } from "@/worker/auth/session";

const created: string[] = [];
afterEach(async () => {
	for (const id of created.splice(0)) await getDb(env.DB).delete(users).where(eq(users.id, id));
});
async function seed() {
	const db = getDb(env.DB);
	const user = await db.insert(users).values({ email: `${crypto.randomUUID()}@example.test`, name: "Reader", passwordHash: "x" }).returning().get();
	created.push(user.id);
	const domain = await db.insert(domains).values({ hostname: `${crypto.randomUUID()}.test`, zoneId: "mock", userId: user.id, status: "active" }).returning().get();
	const mailbox = await db.insert(mailboxes).values({ domainId: domain.id, userId: user.id, localPart: "reader" }).returning().get();
	const session = await createSession(db, user.id);
	const cookie = `${SESSION_COOKIE}=${session.token}`;
	const common = {
		mailboxId: mailbox.id, direction: "inbound" as const, status: "received" as const,
		threadId: crypto.randomUUID(), fromAddress: "sender@example.test", fromName: "Sender",
		toAddresses: [{ address: "reader@example.test" }], receivedAt: new Date("2026-09-29T04:16:00Z"),
	};
	async function list(query: Record<string, string> = {}) {
		const response = await api.fetch(new Request(`https://pogmail.test/api/messages?${new URLSearchParams(query)}`, { headers: { cookie } }), env);
		expect(response.status).toBe(200);
		return response.json() as Promise<{ items: Array<{ id: string }>; nextCursor: number | null; nextCursorId: string | null }>;
	}
	return { db, common, cookie, list, userId: user.id };
}

it("loads every message once even when a page boundary shares the same timestamp", async () => {
	const { db, common, list } = await seed();
	await db.insert(messages).values(["page-a", "page-b", "page-c"].map((id) => ({ ...common, id })));
	const first = await list({ limit: "2" });
	expect(first.items.map((item) => item.id)).toEqual(["page-c", "page-b"]);
	const second = await list({ limit: "2", cursor: String(first.nextCursor), cursorId: first.nextCursorId! });
	expect(second.items.map((item) => item.id)).toEqual(["page-a"]);
	expect(second.nextCursor).toBeNull();
});

it("searches full bodies and combines sender, attachment and unread filters", async () => {
	const { db, common, list } = await seed();
	await db.insert(messages).values([
		{ ...common, id: "matching", subject: "Ordinary subject", snippet: "Short preview", bodyText: "Long message with a nebula invoice at the very end", hasAttachments: true, read: false },
		{ ...common, id: "read", bodyText: "nebula invoice", hasAttachments: true, read: true },
		{ ...common, id: "no-file", bodyText: "nebula invoice", hasAttachments: false, read: false },
		{ ...common, id: "other-sender", fromAddress: "other@example.test", bodyText: "nebula invoice", hasAttachments: true, read: false },
	]);
	expect((await list({ search: '"nebula invoice" from:sender@example.test has:attachment is:unread' })).items.map((item) => item.id)).toEqual(["matching"]);
	expect((await list({ search: "nebula is:read" })).items.map((item) => item.id)).toEqual(["read"]);
});

it("treats FTS punctuation as text, indexes edits and never searches another account's mail", async () => {
	const { db, common, list } = await seed();
	const other = await seed();
	await db.insert(messages).values({ ...common, id: "safe", bodyText: "A telescope appears after the preview" });
	await other.db.insert(messages).values({ ...other.common, id: "private", bodyText: "A private telescope" });
	expect((await list({ search: "telescope" })).items.map((item) => item.id)).toEqual(["safe"]);
	for (const search of ['"', "*", 'x OR telescope', "from:%", "telescope) OR (private"]) await list({ search });
	await db.update(messages).set({ bodyText: "replacement comet" }).where(eq(messages.id, "safe"));
	expect((await list({ search: "telescope" })).items).toEqual([]);
	expect((await list({ search: "comet" })).items.map((item) => item.id)).toEqual(["safe"]);
});

it("restores a filed message after a move but rejects an outdated undo", async () => {
	const { db, common, cookie } = await seed();
	const folder = await db.insert(folders).values({ mailboxId: common.mailboxId, name: "Receipts" }).returning().get();
	await db.insert(messages).values({ ...common, id: "moved", folderId: folder.id });
	const patch = (body: unknown) => api.fetch(new Request("https://pogmail.test/api/messages/moved", {
		method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body),
	}), env);
	expect((await patch({ status: "archived", folderId: null })).status).toBe(200);
	const restored = await patch({ status: "received", folderId: folder.id, expectedLocation: { status: "archived", folderId: null } });
	expect(restored.status).toBe(200);
	expect(await restored.json()).toMatchObject({ status: "received", folderId: folder.id });
	await patch({ status: "trash", folderId: null });
	expect((await patch({ status: "received", folderId: folder.id, expectedLocation: { status: "archived", folderId: null } })).status).toBe(409);
});

it("refuses a bulk move if any selected mailbox is read-only", async () => {
	const owner = await seed();
	const reader = await seed();
	await owner.db.insert(mailboxAccess).values({ mailboxId: owner.common.mailboxId, userId: reader.userId, permission: "read_only" });
	await owner.db.insert(messages).values({ ...owner.common, id: "read-only" });
	await reader.db.insert(messages).values({ ...reader.common, id: "writable" });
	const response = await api.fetch(new Request("https://pogmail.test/api/messages/bulk", {
		method: "PATCH", headers: { cookie: reader.cookie, "content-type": "application/json" },
		body: JSON.stringify({ ids: ["read-only", "writable"], status: "trash" }),
	}), env);
	expect(response.status).toBe(403);
	expect((await reader.list({ status: "received" })).items.map((item) => item.id)).toEqual(["writable", "read-only"]);
});

it("finds HTML-only bodies beyond the preview and supports quoted sender names", async () => {
	const { db, common, list } = await seed();
	await db.insert(messages).values({ ...common, id: "html", fromName: "Sender Person", snippet: "Short preview", bodyHtml: "<p>Content beyond the preview includes a distant galaxy.</p>" });
	expect((await list({ search: 'galaxy from:"sender person"' })).items.map((item) => item.id)).toEqual(["html"]);
});

it("reports malformed supported search filters as client errors", async () => {
	const { cookie } = await seed();
	for (const search of ["from:", "has:video", "is:admin"]) {
		const response = await api.fetch(new Request(`https://pogmail.test/api/messages?${new URLSearchParams({ search })}`, { headers: { cookie } }), env);
		expect(response.status).toBe(400);
	}
});
