import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { domains, emailDeliveryEvents, mailboxes, messages, outboundDeliveries, outboundJobs, users } from "@/db/schema";
import { parseEmailSendingLifecycleEvent, recordEmailSendingLifecycleEvent } from "@/worker/email/lifecycle";
import { hashPassword } from "@/worker/auth/password";

const createdUsers: string[] = [];

afterEach(async () => {
	const db = getDb(env.DB);
	for (const id of createdUsers.splice(0)) await db.delete(users).where(eq(users.id, id));
});

describe("Email Sending lifecycle events", () => {
	it("records each matched Cloudflare event once, even when Queues replays it", async () => {
		const db = getDb(env.DB);
		const user = await db.insert(users).values({
			email: `lifecycle-${crypto.randomUUID()}@example.test`,
			name: "Lifecycle",
			passwordHash: await hashPassword("test password"),
		}).returning().get();
		createdUsers.push(user.id);
		const domain = await db.insert(domains).values({ hostname: `${crypto.randomUUID()}.test`, zoneId: "mock", userId: user.id, status: "active" }).returning().get();
		const mailbox = await db.insert(mailboxes).values({ domainId: domain.id, userId: user.id, localPart: "hello" }).returning().get();
		const messageId = `<${crypto.randomUUID()}@example.test>`;
		const message = await db.insert(messages).values({
			mailboxId: mailbox.id,
			authorUserId: user.id,
			direction: "outbound",
			status: "sent",
			threadId: crypto.randomUUID(),
			messageId,
			fromAddress: "hello@example.test",
			toAddresses: [{ address: "recipient@example.test" }],
			receivedAt: new Date(),
		}).returning().get();
		const job = await db.insert(outboundJobs).values({ messageId: message.id, status: "sent" }).returning().get();
		const delivery = await db.insert(outboundDeliveries).values({ outboundJobId: job.id, recipient: "Recipient@example.test", status: "sent" }).returning().get();
		const event = parseEmailSendingLifecycleEvent({
			type: "cf.email.sending.message.delivered",
			source: { type: "email.sending", zoneId: "mock", domain: "example.test" },
			payload: {
				eventId: crypto.randomUUID(),
				messageId: messageId.slice(1, -1),
				recipient: "recipient@example.test",
				terminal: true,
				delivery: { status: "delivered", smtpResponse: "250 Accepted" },
			},
			metadata: { eventTimestamp: "2026-09-09T00:00:00.000Z" },
		});
		expect(event).not.toBeNull();
		if (!event) return;

		expect(await recordEmailSendingLifecycleEvent(db, event)).toMatchObject({ result: "recorded", mailboxId: mailbox.id, messageId: message.id });
		expect(await recordEmailSendingLifecycleEvent(db, event)).toEqual({ result: "duplicate" });
		expect(await db.select().from(emailDeliveryEvents).where(eq(emailDeliveryEvents.outboundDeliveryId, delivery.id)).all())
			.toEqual([expect.objectContaining({ type: "delivered", deliveryStatus: "delivered", detail: "250 Accepted" })]);
	});

	it("drops an event that does not belong to a local delivery", async () => {
		const event = parseEmailSendingLifecycleEvent({
			type: "cf.email.sending.message.complained",
			source: { type: "email.sending", zoneId: "zone-id", domain: "example.test" },
			payload: { eventId: crypto.randomUUID(), messageId: "missing", recipient: "nobody@example.test", terminal: true, delivery: { status: "complained" } },
			metadata: { eventTimestamp: "2026-09-09T00:00:00.000Z" },
		});
		expect(event).not.toBeNull();
		if (!event) return;
		expect(await recordEmailSendingLifecycleEvent(getDb(env.DB), event)).toEqual({ result: "unmatched" });
	});
});
