import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { domains, folders, mailboxes, messages, users } from "@/db/schema";
import { api } from "@/worker/api";
import { createSession, SESSION_COOKIE } from "@/worker/auth/session";

const createdUsers: string[] = [];

afterEach(async () => {
	const db = getDb(env.DB);
	for (const id of createdUsers.splice(0)) await db.delete(users).where(eq(users.id, id));
});

async function seed() {
	const db = getDb(env.DB);
	const user = await db
		.insert(users)
		.values({ email: `folders-${crypto.randomUUID()}@example.test`, name: "Folders", passwordHash: "x" })
		.returning()
		.get();
	createdUsers.push(user.id);
	const domain = await db
		.insert(domains)
		.values({ hostname: `${crypto.randomUUID()}.test`, zoneId: "mock", userId: user.id, status: "active" })
		.returning()
		.get();
	const mailbox = await db
		.insert(mailboxes)
		.values({ domainId: domain.id, userId: user.id, localPart: "hello" })
		.returning()
		.get();
	const otherMailbox = await db
		.insert(mailboxes)
		.values({ domainId: domain.id, userId: user.id, localPart: "other" })
		.returning()
		.get();
	const folder = await db
		.insert(folders)
		.values({ mailboxId: mailbox.id, name: "Receipts", position: 0 })
		.returning()
		.get();
	const otherFolder = await db
		.insert(folders)
		.values({ mailboxId: otherMailbox.id, name: "Other", position: 0 })
		.returning()
		.get();

	const common = {
		mailboxId: mailbox.id,
		direction: "inbound" as const,
		status: "received" as const,
		threadId: crypto.randomUUID(),
		fromAddress: "sender@example.test",
		toAddresses: [{ address: "hello@example.test" }],
		receivedAt: new Date(),
	};
	const inboxMessage = await db.insert(messages).values(common).returning().get();
	const filedMessage = await db.insert(messages).values({ ...common, threadId: crypto.randomUUID(), folderId: folder.id }).returning().get();
	const session = await createSession(db, user.id);

	return { inboxMessage, filedMessage, folder, otherFolder, cookie: `${SESSION_COOKIE}=${session.token}` };
}

describe("custom folders", () => {
	it("keeps filed mail out of Inbox and exposes per-folder unread counts", async () => {
		const { filedMessage, folder, cookie } = await seed();

		const inbox = await api.fetch(new Request("https://pogmail.test/api/messages?status=received&inbox=true", { headers: { cookie } }), env);
		expect(inbox.status).toBe(200);
		expect((await inbox.json() as { items: Array<{ id: string }> }).items.map((message) => message.id)).not.toContain(filedMessage.id);

		const filed = await api.fetch(new Request(`https://pogmail.test/api/messages?folderId=${folder.id}`, { headers: { cookie } }), env);
		expect(filed.status).toBe(200);
		expect((await filed.json() as { items: Array<{ id: string }> }).items.map((message) => message.id)).toEqual([filedMessage.id]);

		const counts = await api.fetch(new Request("https://pogmail.test/api/messages/counts", { headers: { cookie } }), env);
		expect(counts.status).toBe(200);
		expect(await counts.json()).toMatchObject({ byStatus: { received: 1 }, byFolder: { [folder.id]: 1 } });
	});

	it("rejects moving mail into another mailbox's folder", async () => {
		const { inboxMessage, otherFolder, cookie } = await seed();
		const response = await api.fetch(new Request(`https://pogmail.test/api/messages/${inboxMessage.id}`, {
			method: "PATCH",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ folderId: otherFolder.id }),
		}), env);
		expect(response.status).toBe(403);
	});
});
