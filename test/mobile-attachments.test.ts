import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { mailboxes, messageAttachments, messages, users } from "@/db/schema";
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
		email: `mobile-file-${crypto.randomUUID()}@example.test`,
		name: "Mobile attachment reader",
		passwordHash: await hashPassword("test password"),
	}).returning().get();
	testUsers.push(user.id);
	const mailbox = await db.insert(mailboxes).values({
		userId: user.id,
		localPart: "files",
		externalAddress: `${user.id}@example.test`,
	}).returning().get();
	const message = await db.insert(messages).values({
		mailboxId: mailbox.id,
		threadId: crypto.randomUUID(),
		direction: "inbound",
		status: "received",
		fromAddress: "sender@example.test",
		toAddresses: [{ address: user.email }],
		receivedAt: new Date(),
	}).returning().get();
	const r2Key = `attachments/${crypto.randomUUID()}`;
	await env.MAIL_BUCKET.put(r2Key, "downloaded from R2", { httpMetadata: { contentType: "text/plain" } });
	const attachment = await db.insert(messageAttachments).values({
		messageId: message.id,
		filename: "notes.txt",
		contentType: "text/plain",
		sizeBytes: 18,
		r2Key,
	}).returning().get();
	const session = await createMobileSession(db, user.id, { deviceName: "Pixel 10" });
	return { db, user, message, attachment, accessToken: session.accessToken };
}

function attachmentRequest(accessToken: string, messageId: string, attachmentId: string) {
	return new Request(`https://pogmail.test/api/mobile/messages/${messageId}/attachments/${attachmentId}`, {
		headers: { authorization: `Bearer ${accessToken}` },
	});
}

describe("mobile attachment downloads", () => {
	it("streams an accessible R2 object with a download filename", async () => {
		const { message, attachment, accessToken } = await seed();
		const response = await api.fetch(attachmentRequest(accessToken, message.id, attachment.id), env);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("text/plain");
		expect(response.headers.get("content-disposition")).toBe('attachment; filename="notes.txt"');
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(await response.text()).toBe("downloaded from R2");
	});

	it("does not disclose a file from another user's mailbox", async () => {
		const { db, message, attachment } = await seed();
		const otherUser = await db.insert(users).values({
			email: `mobile-other-${crypto.randomUUID()}@example.test`,
			name: "Other mobile reader",
			passwordHash: await hashPassword("test password"),
		}).returning().get();
		testUsers.push(otherUser.id);
		const otherSession = await createMobileSession(db, otherUser.id, { deviceName: "Pixel 10" });

		const response = await api.fetch(attachmentRequest(otherSession.accessToken, message.id, attachment.id), env);
		expect(response.status).toBe(404);
	});
});
