import { createMimeMessage, Mailbox } from "mimetext";
import { EmailMessage } from "cloudflare:email";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { mailboxes, messageAttachments, messages, outboundJobs } from "@/db/schema";
import type { OutboundSendMessage } from "./types";

/** The domain a Message-ID is minted under: it must be one the sender owns. */
function domainOf(address: string): string {
	return address.slice(address.lastIndexOf("@") + 1);
}

/**
 * Sends a `draft`/`sent` row through the EMAIL binding. Cloudflare only accepts
 * recipients that are verified destination addresses on the account.
 */
export async function processOutboundJob(env: Env, job: OutboundSendMessage): Promise<void> {
	const db = getDb(env.DB);

	const row = await db
		.select({
			job: outboundJobs,
			message: messages,
			signatureText: mailboxes.signature,
			signatureHtml: mailboxes.signatureHtml,
		})
		.from(outboundJobs)
		.innerJoin(messages, eq(messages.id, outboundJobs.messageId))
		.leftJoin(mailboxes, eq(mailboxes.id, messages.mailboxId))
		.where(eq(outboundJobs.id, job.jobId))
		.get();

	if (!row || row.job.status === "sent") return;

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
		if (bodyHtml) mime.addMessage({ contentType: "text/html", data: bodyHtml });
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

		for (const recipient of row.message.toAddresses) {
			await env.EMAIL.send(new EmailMessage(row.message.fromAddress, recipient.address, mime.asRaw()));
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
