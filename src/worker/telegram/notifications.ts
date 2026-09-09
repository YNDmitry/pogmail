import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db";
import { mailboxAccess, mailboxes, users } from "@/db/schema";

type NewMailNotification = {
	from: string;
	subject: string | null;
};

/**
 * Delivers a compact notification only after inbound mail is safely stored.
 * Notification failures are intentionally isolated from the inbound queue: SMTP
 * delivery must never depend on a third-party chat API being available.
 */
export async function notifyTelegramNewMail(
	env: Pick<Env, "TELEGRAM_BOT_TOKEN">,
	db: Database,
	mailboxId: string,
	mail: NewMailNotification,
): Promise<void> {
	if (!env.TELEGRAM_BOT_TOKEN) return;

	const mailbox = await db
		.select({ ownerId: mailboxes.userId })
		.from(mailboxes)
		.where(eq(mailboxes.id, mailboxId))
		.get();
	if (!mailbox) return;

	const shared = await db
		.select({ userId: mailboxAccess.userId })
		.from(mailboxAccess)
		.where(eq(mailboxAccess.mailboxId, mailboxId))
		.all();
	const recipientIds = [...new Set([mailbox.ownerId, ...shared.map((entry) => entry.userId)])];

	const recipients = await db
		.select({ chatId: users.telegramChatId })
		.from(users)
		.where(
			and(
				inArray(users.id, recipientIds),
				eq(users.disabled, false),
			),
		)
		.all();

	const text = formatNewMailNotification(mail);
	const chatIds = [...new Set(recipients.flatMap((recipient) => (recipient.chatId ? [recipient.chatId] : [])))];
	await Promise.all(
		chatIds.map((chatId) => sendTelegramMessage(env.TELEGRAM_BOT_TOKEN!, chatId, text)),
	);
}

export function formatNewMailNotification(mail: NewMailNotification): string {
	// Telegram limits sendMessage text to 4,096 characters. Keep enough room for
	// the labels even if an untrusted sender supplies unusually long headers.
	const from = truncate(singleLine(mail.from), 500);
	const subject = truncate(singleLine(mail.subject) || "(no subject)", 3_500);
	return ["✉️ New email", `From: ${from}`, `Subject: ${subject}`].join("\n").slice(0, 4_096);
}

async function sendTelegramMessage(token: string, chatId: string, text: string): Promise<void> {
	const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ chat_id: chatId, text }),
	});
	if (!response.ok) throw new Error(`Telegram notification failed with HTTP ${response.status}`);

	const payload = (await response.json()) as { ok?: boolean };
	if (!payload.ok) throw new Error("Telegram notification was rejected");
}

function truncate(value: string, limit: number): string {
	return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function singleLine(value: string | null | undefined): string {
	return value?.replace(/\s+/g, " ").trim() ?? "";
}
