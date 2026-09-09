import PostalMime from "postal-mime";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import {
	contacts,
	mailboxes,
	messageAttachments,
	messages,
	routingRules,
	type MailAddress,
	type MessageStatus,
} from "@/db/schema";
import { matches } from "./routing";
import type { InboundQueueMessage } from "./types";
import { dispatchWebhooks } from "./webhooks";
import { queueAutoReply } from "./auto-reply";
import { notifyNewMessage } from "../realtime/notify";

/**
 * Queue consumer step. The `email` handler already decided *where* the mail goes and
 * wrote the raw MIME to R2; everything expensive happens here so a slow parse can
 * never stall the SMTP conversation.
 */
export async function processInboundMessage(env: Env, job: InboundQueueMessage): Promise<void> {
	const db = getDb(env.DB);

	const object = await env.MAIL_BUCKET.get(job.rawKey);
	if (!object) throw new Error(`Raw MIME missing at ${job.rawKey}`);

	const parsed = await PostalMime.parse(await object.arrayBuffer());

	const headers = new Headers();
	for (const header of parsed.headers) headers.append(header.key, header.value);

	const messageId = parsed.messageId ?? null;
	const inReplyTo = parsed.inReplyTo ?? null;
	// References beats In-Reply-To: it points at the thread root, not the parent.
	const threadId = firstReference(headers) ?? inReplyTo ?? messageId ?? crypto.randomUUID();

	const routed = await applyMailboxRules(db, job.mailboxId, {
		to: job.to,
		from: job.from,
		subject: parsed.subject ?? null,
		headers,
	});

	const fromAddress = (parsed.from?.address ?? job.from).toLowerCase();

	const inserted = await db
		.insert(messages)
		.values({
			mailboxId: job.mailboxId,
			direction: "inbound",
			messageId,
			inReplyTo,
			threadId,
			status: routed.status,
			folderId: routed.folderId,
			subject: parsed.subject ?? null,
			fromAddress,
			fromName: parsed.from?.name ?? null,
			toAddresses: toAddressList(parsed.to),
			ccAddresses: toAddressList(parsed.cc),
			replyTo: parsed.replyTo?.[0]?.address ?? null,
			snippet: (parsed.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
			bodyText: parsed.text ?? null,
			bodyHtml: parsed.html ?? null,
			rawKey: job.rawKey,
			sizeBytes: job.sizeBytes,
			hasAttachments: parsed.attachments.length > 0,
			receivedAt: new Date(job.receivedAt),
		})
		// A queue retry after a partial success must not create a duplicate.
		.onConflictDoNothing({ target: [messages.mailboxId, messages.messageId] })
		.returning({ id: messages.id })
		.get();

	if (!inserted) return;

	for (const attachment of parsed.attachments) {
		const key = `attachments/${inserted.id}/${crypto.randomUUID()}`;
		// postal-mime hands back a string for some parts and bytes for others.
		const content =
			typeof attachment.content === "string" ? new TextEncoder().encode(attachment.content) : attachment.content;
		await env.MAIL_BUCKET.put(key, content);

		await db.insert(messageAttachments).values({
			messageId: inserted.id,
			filename: attachment.filename ?? "attachment",
			contentType: attachment.mimeType,
			sizeBytes: content.byteLength,
			disposition: attachment.disposition === "inline" ? "inline" : "attachment",
			contentId: attachment.contentId ?? null,
			r2Key: key,
		});
	}

	const owner = await db
		.select({ userId: mailboxes.userId })
		.from(mailboxes)
		.where(eq(mailboxes.id, job.mailboxId))
		.get();

	if (owner) {
		await upsertContact(db, owner.userId, { email: fromAddress, name: parsed.from?.name });
	}

	await dispatchWebhooks(env, job.mailboxId, "message.received", {
		id: inserted.id,
		mailboxId: job.mailboxId,
		subject: parsed.subject ?? null,
		from: fromAddress,
		receivedAt: job.receivedAt,
	});

	// Auto-replies go out only for real inbox mail: never for spam, trash or a rule
	// that already diverted the message.
	if (routed.status === "received") {
		await queueAutoReply(env, {
			mailboxId: job.mailboxId,
			recipient: fromAddress,
			subject: parsed.subject ?? null,
			headers,
		});
	}

	await notifyNewMessage(env, job.mailboxId, inserted.id);
}

/** `mailbox`-scope rules run after delivery and only choose a folder or divert. */
async function applyMailboxRules(
	db: Database,
	mailboxId: string,
	mail: { to: string; from: string; subject: string | null; headers: Headers },
): Promise<{ status: MessageStatus; folderId: string | null }> {
	const rules = await db
		.select()
		.from(routingRules)
		.where(
			and(
				eq(routingRules.scope, "mailbox"),
				eq(routingRules.mailboxId, mailboxId),
				eq(routingRules.enabled, true),
			),
		)
		.orderBy(desc(routingRules.priority), asc(routingRules.createdAt))
		.all();

	let status: MessageStatus = "received";
	let folderId: string | null = null;

	for (const rule of rules) {
		if (!matches(rule.conditions, rule.matchAll, mail)) continue;

		if (rule.action === "spam") status = "spam";
		else if (rule.action === "trash") status = "trash";
		else if (rule.action === "move") folderId = rule.actionTarget;

		await db
			.update(routingRules)
			.set({ matchCount: sql`${routingRules.matchCount} + 1`, lastMatchedAt: new Date() })
			.where(eq(routingRules.id, rule.id));

		if (rule.stopProcessing) break;
	}

	return { status, folderId };
}

async function upsertContact(
	db: Database,
	userId: string,
	contact: { email: string; name?: string | undefined },
): Promise<void> {
	await db
		.insert(contacts)
		.values({
			userId,
			email: contact.email,
			displayName: contact.name ?? null,
			source: "inbound",
			messageCount: 1,
			lastSeenAt: new Date(),
		})
		.onConflictDoUpdate({
			target: [contacts.userId, contacts.email],
			set: {
				messageCount: sql`${contacts.messageCount} + 1`,
				lastSeenAt: new Date(),
				// Keep the first name we learned rather than letting every mail overwrite it.
				displayName: sql`COALESCE(${contacts.displayName}, ${contact.name ?? null})`,
			},
		});
}

function toAddressList(list: { address?: string; name?: string }[] | undefined): MailAddress[] {
	return (list ?? [])
		.filter((entry): entry is { address: string; name?: string } => Boolean(entry.address))
		.map((entry) => (entry.name ? { address: entry.address, name: entry.name } : { address: entry.address }));
}

function firstReference(headers: Headers): string | null {
	const references = headers.get("references");
	return references?.trim().split(/\s+/)[0] ?? null;
}
