import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { autoReplyDeliveries, domains, mailboxes } from "@/db/schema";

/** Headers that mark mail as automated. Replying to any of them causes loops. */
const LOOP_HEADERS = ["auto-submitted", "x-auto-response-suppress", "list-id", "list-unsubscribe", "precedence"];

/** Same correspondent gets at most one auto-reply per this window. */
const REPLY_INTERVAL_MS = 4 * 24 * 60 * 60 * 1000;

export type AutoReplyRequest = {
	mailboxId: string;
	recipient: string;
	subject: string | null;
	headers: Headers;
};

/**
 * Out-of-office reply. Three independent guards, because two mailboxes with
 * auto-reply on will otherwise mail each other until the account is suspended:
 * automated-mail headers, a per-correspondent record, and never replying to self.
 */
export async function queueAutoReply(env: Env, request: AutoReplyRequest): Promise<void> {
	if (isAutomated(request.headers)) return;

	const db = getDb(env.DB);

	const mailbox = await db
		.select({
			id: mailboxes.id,
			localPart: mailboxes.localPart,
			displayName: mailboxes.displayName,
			enabled: mailboxes.autoReplyEnabled,
			subject: mailboxes.autoReplySubject,
			body: mailboxes.autoReplyBody,
			hostname: domains.hostname,
		})
		.from(mailboxes)
		.innerJoin(domains, eq(domains.id, mailboxes.domainId))
		.where(eq(mailboxes.id, request.mailboxId))
		.get();

	if (!mailbox?.enabled) return;

	const address = `${mailbox.localPart}@${mailbox.hostname}`;
	if (request.recipient === address.toLowerCase()) return;

	const previous = await db
		.select({ sentAt: autoReplyDeliveries.sentAt })
		.from(autoReplyDeliveries)
		.where(
			and(
				eq(autoReplyDeliveries.mailboxId, mailbox.id),
				eq(autoReplyDeliveries.recipient, request.recipient),
			),
		)
		.get();

	if (previous && Date.now() - previous.sentAt.getTime() < REPLY_INTERVAL_MS) return;

	const mime = createMimeMessage();
	mime.setSender({ addr: address, name: mailbox.displayName ?? undefined });
	mime.setRecipient(request.recipient);
	mime.setSubject(mailbox.subject || `Re: ${request.subject ?? ""}`.trim());
	mime.addMessage({ contentType: "text/plain", data: mailbox.body });
	// Marks our own reply as automated so the other side's guard fires too.
	mime.setHeader("Auto-Submitted", "auto-replied");
	mime.setHeader("X-Auto-Response-Suppress", "All");

	try {
		await env.EMAIL.send(new EmailMessage(address, request.recipient, mime.asRaw()));
	} catch (error) {
		// A rejected auto-reply must not fail the delivery that triggered it.
		console.error("auto-reply send failed", request.recipient, error);
		return;
	}

	await db
		.insert(autoReplyDeliveries)
		.values({ mailboxId: mailbox.id, recipient: request.recipient, sentAt: new Date() })
		.onConflictDoUpdate({
			target: [autoReplyDeliveries.mailboxId, autoReplyDeliveries.recipient],
			set: { sentAt: new Date() },
		});
}

function isAutomated(headers: Headers): boolean {
	if (LOOP_HEADERS.some((header) => headers.has(header))) return true;
	// Bounces come from an empty envelope sender; replying to one is pointless.
	return (headers.get("return-path") ?? "").trim() === "<>";
}
