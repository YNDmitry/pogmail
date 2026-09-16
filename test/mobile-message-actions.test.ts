import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { mailboxes, messages, users } from "@/db/schema";
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
});
