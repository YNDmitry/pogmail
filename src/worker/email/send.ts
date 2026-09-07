import { createMimeMessage } from "mimetext";
import { EmailMessage } from "cloudflare:email";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { messageAttachments, messages, outboundJobs } from "@/db/schema";
import type { OutboundSendMessage } from "./types";

/**
 * Sends a `draft`/`sent` row through the EMAIL binding. Cloudflare only accepts
 * recipients that are verified destination addresses on the account.
 */
export async function processOutboundJob(env: Env, job: OutboundSendMessage): Promise<void> {
	const db = getDb(env.DB);

	const row = await db
		.select({ job: outboundJobs, message: messages })
		.from(outboundJobs)
		.innerJoin(messages, eq(messages.id, outboundJobs.messageId))
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
		mime.setSubject(row.message.subject ?? "(no subject)");
		/*
		 * Plain first, HTML last. In `multipart/alternative` the *last* part is the
		 * one a client is meant to prefer, so the order here is what decides whether
		 * a formatted message arrives formatted.
		 */
		if (row.message.bodyText) mime.addMessage({ contentType: "text/plain", data: row.message.bodyText });
		if (row.message.bodyHtml) mime.addMessage({ contentType: "text/html", data: row.message.bodyHtml });
		if (row.message.inReplyTo) mime.setHeader("In-Reply-To", row.message.inReplyTo);

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
		await db.update(messages).set({ status: "sent" }).where(eq(messages.id, row.message.id));
	} catch (error) {
		await db
			.update(outboundJobs)
			.set({ status: "failed", lastError: String(error).slice(0, 500) })
			.where(eq(outboundJobs.id, job.jobId));
		throw error;
	}
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
