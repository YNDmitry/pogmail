import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { folders, mailboxes, messages, users } from "@/db/schema";
import { createMobileSession } from "@/worker/auth/mobile-session";
import { hashPassword } from "@/worker/auth/password";
import { api } from "@/worker/api";

const testUsers: string[] = [];

afterEach(async () => {
	const db = getDb(env.DB);
	for (const userId of testUsers.splice(0)) {
		await db.delete(users).where(eq(users.id, userId));
	}
});

async function seed() {
	const db = getDb(env.DB);
	const user = await db
		.insert(users)
		.values({
			email: `sync-${crypto.randomUUID()}@example.test`,
			name: "Mobile sync tester",
			passwordHash: await hashPassword("test password"),
		})
		.returning()
		.get();
	testUsers.push(user.id);
	const mailbox = await db
		.insert(mailboxes)
		.values({ userId: user.id, localPart: "inbox", externalAddress: `${user.id}@example.test` })
		.returning()
		.get();
	const folder = await db
		.insert(folders)
		.values({ mailboxId: mailbox.id, name: "Receipts", position: 1 })
		.returning()
		.get();
	const message = await db
		.insert(messages)
		.values({
			mailboxId: mailbox.id,
			threadId: crypto.randomUUID(),
			direction: "inbound",
			status: "received",
			folderId: folder.id,
			fromAddress: "sender@example.test",
			toAddresses: [{ address: user.email }],
			subject: "Your receipt",
			snippet: "Thank you for your purchase",
			receivedAt: new Date(),
		})
		.returning()
		.get();
	const session = await createMobileSession(db, user.id, { deviceName: "Pixel 10" });
	return { db, mailbox, folder, message, accessToken: session.accessToken };
}

function syncRequest(accessToken: string, cursor = 0) {
	return new Request(`https://pogmail.test/api/mobile/sync?cursor=${cursor}`, {
		headers: { authorization: `Bearer ${accessToken}` },
	});
}

describe("mobile incremental sync", () => {
	it("returns initial summaries and a message tombstone after deletion", async () => {
		const { db, mailbox, folder, message, accessToken } = await seed();

		const initial = await api.fetch(syncRequest(accessToken), env);
		expect(initial.status).toBe(200);
		const first = (await initial.json()) as {
			cursor: number;
			mailboxes: Array<{ id: string }>;
			folders: Array<{ id: string }>;
			messages: Array<{ id: string; subject: string }>;
		};
		expect(first.cursor).toBeGreaterThan(0);
		expect(first.mailboxes).toEqual(expect.arrayContaining([expect.objectContaining({ id: mailbox.id })]));
		expect(first.folders).toEqual(expect.arrayContaining([expect.objectContaining({ id: folder.id })]));
		expect(first.messages).toEqual(expect.arrayContaining([expect.objectContaining({ id: message.id, subject: "Your receipt" })]));

		await db.delete(messages).where(eq(messages.id, message.id));
		const afterDelete = await api.fetch(syncRequest(accessToken, first.cursor), env);
		expect(afterDelete.status).toBe(200);
		expect(await afterDelete.json()).toMatchObject({
			tombstones: expect.arrayContaining([
				expect.objectContaining({ resourceType: "message", resourceId: message.id, mailboxId: mailbox.id }),
			]),
		});
	});
});
