import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { domains, mailboxes, messages, outboundJobs, users } from "@/db/schema";
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
	const user = await db
		.insert(users)
		.values({
			email: `mobile-send-${crypto.randomUUID()}@example.test`,
			name: "Mobile sender",
			passwordHash: await hashPassword("test password"),
		})
		.returning()
		.get();
	testUsers.push(user.id);
	const domain = await db
		.insert(domains)
		.values({ hostname: `${crypto.randomUUID()}.test`, zoneId: "mock", userId: user.id, status: "active", sendingEnabled: true })
		.returning()
		.get();
	const mailbox = await db
		.insert(mailboxes)
		.values({ domainId: domain.id, userId: user.id, localPart: "hello", displayName: "Mobile sender" })
		.returning()
		.get();
	const original = await db
		.insert(messages)
		.values({
			mailboxId: mailbox.id,
			threadId: "<root@example.test>",
			messageId: "<parent@example.test>",
			direction: "inbound",
			status: "received",
			fromAddress: "friend@example.test",
			toAddresses: [{ address: `${mailbox.localPart}@${domain.hostname}` }],
			subject: "Question",
			receivedAt: new Date(),
		})
		.returning()
		.get();
	const session = await createMobileSession(db, user.id, { deviceName: "Pixel 10" });
	return { db, mailbox, original, accessToken: session.accessToken };
}

function request(path: string, accessToken: string, body?: unknown) {
	return new Request(`https://pogmail.test/api/mobile${path}`, {
		method: body === undefined ? "GET" : "POST",
		headers: { authorization: `Bearer ${accessToken}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

describe("mobile compose", () => {
	it("lists senders and queues a threaded reply through the ordinary delivery pipeline", async () => {
		const { db, mailbox, original, accessToken } = await seed();

		const senders = await api.fetch(request("/senders", accessToken), env);
		expect(senders.status).toBe(200);
		expect(await senders.json()).toMatchObject({
			items: [expect.objectContaining({ id: mailbox.id, address: expect.stringMatching(/^hello@/) })],
		});

		const response = await api.fetch(request("/send", accessToken, {
			mailboxId: mailbox.id,
			to: [{ address: "friend@example.test" }],
			subject: "Re: Question",
			bodyText: "Yes, that works.",
			replyToMessageId: original.id,
		}), env);
		expect(response.status).toBe(202);
		const result = await response.json() as { id: string; jobId: string };
		const sent = await db.select().from(messages).where(eq(messages.id, result.id)).get();
		expect(sent).toMatchObject({
			mailboxId: mailbox.id,
			direction: "outbound",
			status: "sent",
			toAddresses: [{ address: "friend@example.test" }],
			inReplyTo: "<parent@example.test>",
			threadId: "<root@example.test>",
		});
		expect(await db.select().from(outboundJobs).where(eq(outboundJobs.id, result.jobId)).get())
			.toMatchObject({ messageId: result.id, status: "queued" });
	});

	it("does not allow a reply to move into a different sender mailbox", async () => {
		const { db, mailbox, original, accessToken } = await seed();
		const otherMailbox = await db
			.insert(mailboxes)
			.values({ userId: mailbox.userId, localPart: "other", externalAddress: "other@example.test", source: "external" })
			.returning()
			.get();

		const response = await api.fetch(request("/send", accessToken, {
			mailboxId: otherMailbox.id,
			to: [{ address: "friend@example.test" }],
			bodyText: "This should fail.",
			replyToMessageId: original.id,
		}), env);
		expect(response.status).toBe(422);
	});
});
