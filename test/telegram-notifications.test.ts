import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { domains, mailboxAccess, mailboxes, users } from "@/db/schema";
import { formatNewMailNotification, notifyTelegramNewMail } from "@/worker/telegram/notifications";

const createdUsers: string[] = [];

afterEach(async () => {
	vi.restoreAllMocks();
	const db = getDb(env.DB);
	for (const id of createdUsers.splice(0)) await db.delete(users).where(eq(users.id, id));
});

async function seed() {
	const db = getDb(env.DB);
	const owner = await db
		.insert(users)
		.values({
			email: `owner-${crypto.randomUUID()}@example.test`,
			name: "Owner",
			passwordHash: "x",
			telegramChatId: "12345",
		})
		.returning()
		.get();
	const sharedUser = await db
		.insert(users)
		.values({
			email: `shared-${crypto.randomUUID()}@example.test`,
			name: "Shared",
			passwordHash: "x",
			telegramChatId: "@mail_alerts",
		})
		.returning()
		.get();
	createdUsers.push(owner.id, sharedUser.id);

	const domain = await db
		.insert(domains)
		.values({ hostname: `${crypto.randomUUID()}.test`, zoneId: "mock", userId: owner.id, status: "active" })
		.returning()
		.get();
	const mailbox = await db
		.insert(mailboxes)
		.values({ domainId: domain.id, userId: owner.id, localPart: "hello" })
		.returning()
		.get();
	await db.insert(mailboxAccess).values({ mailboxId: mailbox.id, userId: sharedUser.id });

	return { db, mailbox };
}

describe("Telegram new-mail notifications", () => {
	it("alerts the owner and people with mailbox access", async () => {
		const { db, mailbox } = await seed();
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })));

		await notifyTelegramNewMail({ TELEGRAM_BOT_TOKEN: "123:token" }, db, mailbox.id, {
			from: "sender@example.test",
			subject: "Status update",
		});

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.telegram.org/bot123%3Atoken/sendMessage",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({
					chat_id: "12345",
					text: "✉️ New email\nFrom: sender@example.test\nSubject: Status update",
				}),
			}),
		);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.telegram.org/bot123%3Atoken/sendMessage",
			expect.objectContaining({ body: expect.stringContaining('"chat_id":"@mail_alerts"') }),
		);
	});

	it("does nothing until the Worker has a bot token", async () => {
		const { db, mailbox } = await seed();
		const fetchMock = vi.spyOn(globalThis, "fetch");

		await notifyTelegramNewMail({}, db, mailbox.id, { from: "sender@example.test", subject: null });

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("keeps untrusted headers within Telegram's message limit", () => {
		const text = formatNewMailNotification({ from: "sender@example.test", subject: "x".repeat(10_000) });
		expect(text.length).toBeLessThanOrEqual(4_096);
		expect(text).toContain("Subject: xxx");
	});
});
