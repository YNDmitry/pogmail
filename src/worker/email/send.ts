import { createMimeMessage, Mailbox } from "mimetext";
import { EmailMessage } from "cloudflare:email";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import { emailCampaigns, mailboxes, messageAttachments, messages, outboundDeliveries, outboundJobs } from "@/db/schema";
import type { OutboundSendMessage } from "./types";
import { safeEmailHtml } from "./html-safety";
import { nextScheduledDelay } from "./schedule";

/** A crashed consumer can leave a recipient claimed; after this, another job recovers it. */
const DELIVERY_LEASE_MS = 5 * 60 * 1000;

/** The domain a Message-ID is minted under: it must be one the sender owns. */
function domainOf(address: string): string {
	return address.slice(address.lastIndexOf("@") + 1);
}

/**
 * Sends a `draft`/`sent` row through Cloudflare Email Sending. The sender domain
 * must be onboarded, while recipients are tracked independently for safe retries.
 */
export async function processOutboundJob(env: Env, job: OutboundSendMessage): Promise<void> {
	const db = getDb(env.DB);

	const row = await db
		.select({
			job: outboundJobs,
			message: messages,
			signatureText: mailboxes.signature,
			signatureHtml: mailboxes.signatureHtml,
			campaignStatus: emailCampaigns.status,
		})
		.from(outboundJobs)
		.innerJoin(messages, eq(messages.id, outboundJobs.messageId))
		.leftJoin(mailboxes, eq(mailboxes.id, messages.mailboxId))
		.leftJoin(emailCampaigns, eq(emailCampaigns.id, messages.campaignId))
		.where(eq(outboundJobs.id, job.jobId))
		.get();

	if (!row || row.job.status === "sent") return;
	// Cancellation is checked by the consumer as well as the API: a message may
	// already be sitting in Queues when its campaign is stopped.
	if (row.campaignStatus === "cancelled") {
		await db.update(outboundJobs).set({ status: "failed", lastError: "Campaign cancelled" })
			.where(eq(outboundJobs.id, job.jobId));
		return;
	}

	// A Queues delay cannot exceed 24 hours. A distant scheduled message advances
	// itself one bounded interval at a time, without polling or sending early.
	const delaySeconds = nextScheduledDelay(row.job.scheduledFor);
	if (delaySeconds !== undefined) {
		await env.OUTBOUND_QUEUE.send(job, { delaySeconds });
		return;
	}

	await db
		.update(outboundJobs)
		.set({ status: "sending", attempts: row.job.attempts + 1 })
		.where(eq(outboundJobs.id, job.jobId));

	try {
		const mime = createMimeMessage();
		mime.setSender({ addr: row.message.fromAddress, name: row.message.fromName ?? undefined });
		mime.setRecipients(row.message.toAddresses.map((entry) => entry.address));
		if (row.message.ccAddresses?.length) {
			mime.setCc(row.message.ccAddresses.map((entry) => entry.address));
		}
		mime.setSubject(row.message.subject ?? "(no subject)");
		// mimetext validates address headers by type, so Reply-To has to be a Mailbox.
		if (row.message.replyTo) mime.setHeader("Reply-To", new Mailbox(row.message.replyTo));

		/*
		 * Our own Message-ID rather than the one mimetext invents, because it has to
		 * be written back to the row: a reply arrives quoting it in `In-Reply-To`, and
		 * a thread that cannot be joined is also a thread a receiver reads as one-off
		 * mail from an unknown domain.
		 */
		const messageId = row.message.messageId ?? `<${crypto.randomUUID()}@${domainOf(row.message.fromAddress)}>`;
		mime.setHeader("Message-ID", messageId);
		// Persist this before Email Sending sees the first recipient. Lifecycle events
		// are asynchronous and may arrive even if a later recipient makes this queue
		// job retry, so waiting until every send completes would lose their correlation.
		if (!row.message.messageId) {
			await db.update(messages).set({ messageId }).where(eq(messages.id, row.message.id));
		}
		/*
		 * Plain first, HTML last. In `multipart/alternative` the *last* part is the
		 * one a client is meant to prefer, so the order here is what decides whether
		 * a formatted message arrives formatted.
		 */
		const bodyText = appendSignatureText(row.message.bodyText, row.signatureText);
		const bodyHtml = appendSignatureHtml(
			row.message.bodyHtml,
			row.message.bodyText,
			row.signatureHtml,
			row.signatureText,
		);
		if (bodyText) mime.addMessage({ contentType: "text/plain", data: bodyText });
		const safeHtml = safeEmailHtml(bodyHtml);
		if (safeHtml) mime.addMessage({ contentType: "text/html", data: safeHtml });
		if (row.message.inReplyTo) {
			mime.setHeader("In-Reply-To", row.message.inReplyTo);
			// `threadId` is the root, `inReplyTo` the parent; a client walks References
			// from the root, so send both and never the same id twice.
			const references = [row.message.threadId, row.message.inReplyTo].filter(
				(value, index, all) => value && all.indexOf(value) === index,
			);
			mime.setHeader("References", references.join(" "));
		}

		if (row.message.hasAttachments) {
			const files = await db
				.select()
				.from(messageAttachments)
				.where(eq(messageAttachments.messageId, row.message.id))
				.all();

			for (const file of files) {
				const object = await env.MAIL_BUCKET.get(file.r2Key);
				// A missing object must not silently send a message without its file.
				if (!object) throw new Error(`Attachment ${file.filename} is missing from storage`);

				mime.addAttachment({
					filename: file.filename,
					contentType: file.contentType,
					data: base64(await object.arrayBuffer()),
					inline: file.disposition === "inline",
					...(file.contentId ? { headers: { "Content-ID": `<${file.contentId}>` } } : {}),
				});
			}
		}

		const recipients = deliveryRecipients(row.message);
		await db
			.insert(outboundDeliveries)
			.values(recipients.map((recipient) => ({ outboundJobId: row.job.id, recipient })))
			.onConflictDoNothing();
		// Queues is at-least-once. Recover only expired claims; a live consumer keeps
		// its lease and no second consumer can send to the same recipient meanwhile.
		await db
			.update(outboundDeliveries)
			.set({ status: "failed", lastError: "Sending lease expired; retrying" })
			.where(
				and(
					eq(outboundDeliveries.outboundJobId, row.job.id),
					eq(outboundDeliveries.status, "sending"),
					lt(outboundDeliveries.updatedAt, new Date(Date.now() - DELIVERY_LEASE_MS)),
				),
			);

		const pending = await db
			.select()
			.from(outboundDeliveries)
			.where(
				and(
					eq(outboundDeliveries.outboundJobId, row.job.id),
					inArray(outboundDeliveries.status, ["pending", "failed"]),
				),
			)
			.all();

		for (const delivery of pending) {
			const claimed = await claimOutboundDelivery(db, delivery.id);
			if (!claimed) continue;

			try {
				await env.EMAIL.send(new EmailMessage(row.message.fromAddress, delivery.recipient, mime.asRaw()));
				await db
					.update(outboundDeliveries)
					.set({ status: "sent", sentAt: new Date(), lastError: null })
					.where(eq(outboundDeliveries.id, delivery.id));
			} catch (error) {
				const permanent = isPermanentEmailError(error);
				const message = emailErrorMessage(error);
				await db
					.update(outboundDeliveries)
					.set({ status: permanent ? "permanent" : "failed", lastError: message })
					.where(eq(outboundDeliveries.id, delivery.id));
				if (permanent) {
					continue;
				}
				throw error;
			}
		}

		const inFlight = await db
			.select({ updatedAt: outboundDeliveries.updatedAt })
			.from(outboundDeliveries)
			.where(and(eq(outboundDeliveries.outboundJobId, row.job.id), eq(outboundDeliveries.status, "sending")))
			.get();
		if (inFlight) {
			const leaseDelaySeconds = Math.max(1, Math.ceil((inFlight.updatedAt.getTime() + DELIVERY_LEASE_MS - Date.now()) / 1000));
			await env.OUTBOUND_QUEUE.send(job, { delaySeconds: leaseDelaySeconds });
			return;
		}

		const permanentFailure = await db
			.select({ lastError: outboundDeliveries.lastError })
			.from(outboundDeliveries)
			.where(and(eq(outboundDeliveries.outboundJobId, row.job.id), eq(outboundDeliveries.status, "permanent")))
			.get();
		if (permanentFailure) {
			await db
				.update(outboundJobs)
				.set({ status: "failed", lastError: permanentFailure.lastError ?? "A recipient was permanently rejected" })
				.where(eq(outboundJobs.id, job.jobId));
			return;
		}

		await db
			.update(outboundJobs)
			.set({ status: "sent", sentAt: new Date(), lastError: null })
			.where(eq(outboundJobs.id, job.jobId));
		await db
			.update(messages)
			.set({ status: "sent", messageId })
			.where(eq(messages.id, row.message.id));
	} catch (error) {
		await db
			.update(outboundJobs)
			.set({ status: "failed", lastError: String(error).slice(0, 500) })
			.where(eq(outboundJobs.id, job.jobId));
		throw error;
	}
}

/** Atomically acquires one recipient so concurrent queue deliveries cannot double-send it. */
export function claimOutboundDelivery(db: Database, deliveryId: string) {
	return db
		.update(outboundDeliveries)
		.set({ status: "sending", attempts: sql`${outboundDeliveries.attempts} + 1`, lastError: null })
		.where(and(eq(outboundDeliveries.id, deliveryId), inArray(outboundDeliveries.status, ["pending", "failed"])))
		.returning({ id: outboundDeliveries.id })
		.get();
}

/** Delivers To, CC and BCC once each; BCC stays out of the MIME headers. */
export function deliveryRecipients(
	message: Pick<typeof messages.$inferSelect, "toAddresses" | "ccAddresses" | "bccAddresses">,
): string[] {
	const seen = new Set<string>();
	const recipients: string[] = [];
	for (const address of [...message.toAddresses, ...(message.ccAddresses ?? []), ...(message.bccAddresses ?? [])]) {
		const normalized = address.address.toLowerCase();
		if (seen.has(normalized)) continue;
		seen.add(normalized);
		recipients.push(address.address);
	}
	return recipients;
}

type EmailSendingError = { code?: unknown; message?: unknown };

/** Errors Cloudflare documents as requiring a changed message or configuration. */
const PERMANENT_EMAIL_ERROR_CODES = new Set([
	"E_VALIDATION_ERROR",
	"E_FIELD_MISSING",
	"E_TOO_MANY_RECIPIENTS",
	"E_SENDER_NOT_VERIFIED",
	"E_RECIPIENT_NOT_ALLOWED",
	"E_RECIPIENT_SUPPRESSED",
	"E_SENDER_DOMAIN_NOT_AVAILABLE",
	"E_CONTENT_TOO_LARGE",
	"E_HEADER_NOT_ALLOWED",
	"E_HEADER_USE_API_FIELD",
	"E_HEADER_VALUE_INVALID",
	"E_HEADER_VALUE_TOO_LONG",
	"E_HEADER_NAME_INVALID",
	"E_HEADERS_TOO_LARGE",
	"E_HEADERS_TOO_MANY",
]);

export function isPermanentEmailError(error: unknown): boolean {
	return typeof error === "object" && error !== null &&
		typeof (error as EmailSendingError).code === "string" &&
		PERMANENT_EMAIL_ERROR_CODES.has((error as EmailSendingError).code as string);
}

function emailErrorMessage(error: unknown): string {
	return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function appendSignatureText(body: string | null, signature: string | null): string | null {
	if (!signature?.trim()) return body;
	return [body?.trim(), `-- \n${signature.trim()}`].filter(Boolean).join("\n\n");
}

function appendSignatureHtml(
	bodyHtml: string | null,
	bodyText: string | null,
	signatureHtml: string | null,
	signatureText: string | null,
): string | null {
	const signature = signatureHtml?.trim() || plainTextHtml(signatureText);
	if (!signature) return bodyHtml;
	const body = bodyHtml?.trim() || plainTextHtml(bodyText);
	return `${body ? `${body}<hr>` : ""}${signature}`;
}

function plainTextHtml(value: string | null): string {
	if (!value?.trim()) return "";
	return `<p>${escapeHtml(value.trim()).replaceAll("\n", "<br>")}</p>`;
}

function escapeHtml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * MIME carries bytes as base64, and `btoa` takes a string, so the buffer is walked
 * in chunks — spreading a multi-megabyte byte array into `String.fromCharCode`
 * blows the argument limit and throws before the mail is ever built.
 */
function base64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	const chunk = 0x8000;
	let binary = "";
	for (let index = 0; index < bytes.length; index += chunk) {
		binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
	}
	return btoa(binary);
}
