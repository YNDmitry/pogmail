import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { autoReplyDeliveries, domains, mailboxes, users } from "@/db/schema";
import { queueAutoReply } from "@/worker/email/auto-reply";

const db = () => getDb(env.DB);

async function seed(autoReplyEnabled = true) {
	const user = await db()
		.insert(users)
		.values({ email: "owner@test", name: "Owner", passwordHash: "x" })
		.returning()
		.get();

	const domain = await db()
		.insert(domains)
		.values({ hostname: "acme.test", zoneId: "z", userId: user.id, status: "active" })
		.returning()
		.get();

	return db()
		.insert(mailboxes)
		.values({
			domainId: domain.id,
			userId: user.id,
			localPart: "hello",
			autoReplyEnabled,
			autoReplyBody: "Away until Monday.",
		})
		.returning()
		.get();
}

const request = (mailboxId: string, headers: Record<string, string> = {}) => ({
	mailboxId,
	recipient: "sender@elsewhere.test",
	subject: "Question",
	headers: new Headers(headers),
});

/**
 * `env.EMAIL.send` is not wired up under test, so a real send throws and is
 * swallowed. What matters here is whether a delivery was *recorded* — that row is
 * the loop guard, and it is only written on the path that actually tried to send.
 */
async function replied(mailboxId: string): Promise<boolean> {
	const row = await db()
		.select()
		.from(autoReplyDeliveries)
		.where(eq(autoReplyDeliveries.mailboxId, mailboxId))
		.get();
	return Boolean(row);
}

describe("auto-reply loop guards", () => {
	beforeEach(async () => {
		await db().delete(autoReplyDeliveries);
		await db().delete(mailboxes);
		await db().delete(domains);
		await db().delete(users);
	});

	it("does nothing when auto-reply is off", async () => {
		const mailbox = await seed(false);
		await queueAutoReply(env, request(mailbox.id));
		expect(await replied(mailbox.id)).toBe(false);
	});

	it("ignores mail that marks itself automated", async () => {
		const mailbox = await seed();
		await queueAutoReply(env, request(mailbox.id, { "auto-submitted": "auto-replied" }));
		expect(await replied(mailbox.id)).toBe(false);
	});

	it("ignores mailing list traffic", async () => {
		const mailbox = await seed();
		await queueAutoReply(env, request(mailbox.id, { "list-id": "<dev.example.com>" }));
		expect(await replied(mailbox.id)).toBe(false);
	});

	it("ignores bounces, which have an empty envelope sender", async () => {
		const mailbox = await seed();
		await queueAutoReply(env, request(mailbox.id, { "return-path": "<>" }));
		expect(await replied(mailbox.id)).toBe(false);
	});

	it("never replies to the mailbox's own address", async () => {
		const mailbox = await seed();
		await queueAutoReply(env, {
			mailboxId: mailbox.id,
			recipient: "hello@acme.test",
			subject: "Loop",
			headers: new Headers(),
		});
		expect(await replied(mailbox.id)).toBe(false);
	});

	it("replies at most once per correspondent inside the window", async () => {
		const mailbox = await seed();
		await db()
			.insert(autoReplyDeliveries)
			.values({ mailboxId: mailbox.id, recipient: "sender@elsewhere.test", sentAt: new Date() });

		const before = await db()
			.select()
			.from(autoReplyDeliveries)
			.where(eq(autoReplyDeliveries.mailboxId, mailbox.id))
			.get();

		await queueAutoReply(env, request(mailbox.id));

		const after = await db()
			.select()
			.from(autoReplyDeliveries)
			.where(eq(autoReplyDeliveries.mailboxId, mailbox.id))
			.get();

		// Untouched: the guard returned before doing anything.
		expect(after?.sentAt.getTime()).toBe(before?.sentAt.getTime());
	});
});
