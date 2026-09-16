import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { folders, mailboxAccess, mailboxes, messages, users } from "@/db/schema";
import { api } from "@/worker/api";
import { createMobileSession } from "@/worker/auth/mobile-session";
import { hashPassword } from "@/worker/auth/password";

const testUsers: string[] = [];

afterEach(async () => {
	const db = getDb(env.DB);
	for (const userId of testUsers.splice(0)) await db.delete(users).where(eq(users.id, userId));
});

async function seed() {
	const db = getDb(env.DB);
	const user = await db.insert(users).values({
		email: `mobile-action-${crypto.randomUUID()}@example.test`,
		name: "Mobile action tester",
		passwordHash: await hashPassword("test password"),
	}).returning().get();
	testUsers.push(user.id);
	const mailbox = await db.insert(mailboxes).values({
		userId: user.id,
		localPart: "actions",
		externalAddress: `${user.id}@example.test`,
	}).returning().get();
	const message = await db.insert(messages).values({
		mailboxId: mailbox.id,
		threadId: crypto.randomUUID(),
		direction: "inbound",
		status: "received",
		fromAddress: "sender@example.test",
		toAddresses: [{ address: user.email }],
		read: false,
		starred: false,
		receivedAt: new Date(),
	}).returning().get();
	const session = await createMobileSession(db, user.id, { deviceName: "Pixel 10" });
	return { db, message, accessToken: session.accessToken };
}

function patchRequest(accessToken: string, messageId: string, body: unknown) {
	return new Request(`https://pogmail.test/api/mobile/messages/${messageId}`, {
		method: "PATCH",
		headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("mobile message actions", () => {
	it("marks accessible mail read and starred", async () => {
		const { db, message, accessToken } = await seed();
		const response = await api.fetch(patchRequest(accessToken, message.id, { read: true, starred: true }), env);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ id: message.id, read: true, starred: true });
		expect(await db.select().from(messages).where(eq(messages.id, message.id)).get())
			.toMatchObject({ read: true, starred: true });
	});

	it("does not alter another user's message", async () => {
		const { db, message } = await seed();
		const otherUser = await db.insert(users).values({
			email: `mobile-action-other-${crypto.randomUUID()}@example.test`,
			name: "Other action tester",
			passwordHash: await hashPassword("test password"),
		}).returning().get();
		testUsers.push(otherUser.id);
		const otherSession = await createMobileSession(db, otherUser.id, { deviceName: "Pixel 10" });

		const response = await api.fetch(patchRequest(otherSession.accessToken, message.id, { starred: true }), env);
		expect(response.status).toBe(404);
	});

	it("moves mail, snoozes it and enforces the target folder's mailbox", async () => {
		const { db, message, accessToken } = await seed();
		const mailbox = await db.select().from(mailboxes).where(eq(mailboxes.id, message.mailboxId)).get();
		if (!mailbox) throw new Error("seed mailbox missing");
		const folder = await db.insert(folders).values({ mailboxId: mailbox.id, name: "Receipts" }).returning().get();

		const filed = await api.fetch(patchRequest(accessToken, message.id, { folderId: folder.id }), env);
		expect(filed.status).toBe(200);
		expect(await filed.json()).toMatchObject({ id: message.id, status: "received", folderId: folder.id });

		const tomorrow = Date.now() + 24 * 60 * 60 * 1000;
		const snoozed = await api.fetch(patchRequest(accessToken, message.id, { snoozedUntil: tomorrow }), env);
		expect(snoozed.status).toBe(200);
		expect(await db.select().from(messages).where(eq(messages.id, message.id)).get())
			.toMatchObject({ folderId: folder.id, snoozedUntil: new Date(tomorrow) });

		const otherMailbox = await db.insert(mailboxes).values({
			userId: mailbox.userId,
			localPart: "other-actions",
			externalAddress: `${crypto.randomUUID()}@example.test`,
		}).returning().get();
		const wrongFolder = await db.insert(folders).values({ mailboxId: otherMailbox.id, name: "Other" }).returning().get();
		const invalid = await api.fetch(patchRequest(accessToken, message.id, { folderId: wrongFolder.id }), env);
		expect(invalid.status).toBe(422);
	});

	it("does not let a read-only collaborator modify shared mail", async () => {
		const { db, message } = await seed();
		const reader = await db.insert(users).values({
			email: `mobile-reader-${crypto.randomUUID()}@example.test`,
			name: "Read-only tester",
			passwordHash: await hashPassword("test password"),
		}).returning().get();
		testUsers.push(reader.id);
		await db.insert(mailboxAccess).values({ mailboxId: message.mailboxId, userId: reader.id, permission: "read_only" });
		const readerSession = await createMobileSession(db, reader.id, { deviceName: "Pixel 10" });

		const response = await api.fetch(patchRequest(readerSession.accessToken, message.id, { starred: true }), env);
		expect(response.status).toBe(403);
	});
});
