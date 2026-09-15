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
	for (const userId of testUsers.splice(0)) {
		await db.delete(users).where(eq(users.id, userId));
	}
});

async function seed() {
	const db = getDb(env.DB);
	const user = await db
		.insert(users)
		.values({
			email: `reader-${crypto.randomUUID()}@example.test`,
			name: "Mobile reader",
			passwordHash: await hashPassword("test password"),
		})
		.returning()
		.get();
	testUsers.push(user.id);
	const mailbox = await db
		.insert(mailboxes)
		.values({ userId: user.id, localPart: "reader", externalAddress: `${user.id}@example.test` })
		.returning()
		.get();
	const message = await db
		.insert(messages)
		.values({
			mailboxId: mailbox.id,
			threadId: crypto.randomUUID(),
			direction: "inbound",
			status: "received",
			fromAddress: "sender@example.test",
			fromName: "Sender",
			toAddresses: [{ address: user.email, name: user.name }],
			subject: "Safe mobile reader",
			bodyText: "Hello from the plain-text body.",
			bodyHtml: '<p onclick="steal()">Hello</p><script>steal()</script>',
			receivedAt: new Date(),
		})
		.returning()
		.get();
	await db.insert(messageAttachments).values({
		messageId: message.id,
		filename: "invoice.pdf",
		contentType: "application/pdf",
		sizeBytes: 2048,
		r2Key: `attachments/${crypto.randomUUID()}`,
	});
	const session = await createMobileSession(db, user.id, { deviceName: "Pixel 10" });
	return { message, accessToken: session.accessToken };
}

function messageRequest(accessToken: string, id: string) {
	return new Request(`https://pogmail.test/api/mobile/messages/${id}`, {
		headers: { authorization: `Bearer ${accessToken}` },
	});
}

describe("mobile message reader", () => {
	it("returns one accessible body with sanitised HTML and attachment metadata", async () => {
		const { message, accessToken } = await seed();

		const response = await api.fetch(messageRequest(accessToken, message.id), env);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			id: message.id,
			bodyText: "Hello from the plain-text body.",
			bodyHtml: "<p>Hello</p>",
			attachments: [
				{ filename: "invoice.pdf", contentType: "application/pdf", sizeBytes: 2048, disposition: "attachment" },
			],
		});
	});

	it("does not reveal another mailbox's message", async () => {
		const { message } = await seed();
		const db = getDb(env.DB);
		const otherUser = await db
			.insert(users)
			.values({
				email: `other-${crypto.randomUUID()}@example.test`,
				name: "Other reader",
				passwordHash: await hashPassword("test password"),
			})
			.returning()
			.get();
		testUsers.push(otherUser.id);
		const otherSession = await createMobileSession(db, otherUser.id, { deviceName: "Pixel 10" });

		const response = await api.fetch(messageRequest(otherSession.accessToken, message.id), env);
		expect(response.status).toBe(404);
	});
});
