import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { domains, mailboxes, messageAttachments, messages, outboundJobs } from "@/db/schema";
import { audit } from "../audit";
import { canSendFrom, getPermission, hasAtLeast } from "../mailboxes/access";
import type { AppBindings } from "../middleware/context";
import { forbidden, notFound, parseBody } from "./_util";
import { deleteObject, putUpload } from "../storage";
import type { OutboundSendMessage } from "../email/types";

/*
 * Cloudflare rejects an outbound message over 25 MB, and base64 inflates the
 * bytes by a third on the way into the MIME envelope, so the ceiling here is the
 * one that keeps an accepted upload sendable rather than the one R2 allows.
 */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024;

const address = z.object({ address: z.email(), name: z.string().max(120).optional() });

const composeInput = z.object({
	mailboxId: z.string().min(1),
	to: z.array(address).min(1).max(100),
	cc: z.array(address).max(100).default([]),
	bcc: z.array(address).max(100).default([]),
	subject: z.string().max(300).default(""),
	bodyText: z.string().max(500_000).default(""),
	bodyHtml: z.string().max(1_000_000).nullable().optional(),
	/** Set when replying, so the thread stays intact for the recipient's client. */
	inReplyTo: z.string().max(300).nullable().optional(),
	threadId: z.string().max(300).nullable().optional(),
	/** Epoch ms; the message waits in the queue until then. */
	scheduledFor: z.number().int().nullable().optional(),
});

export const sendRoutes = new Hono<AppBindings>()
	/** Saves or updates a draft without sending it. */
	.post("/drafts", async (c) => {
		const input = await parseBody(c, composeInput.partial({ to: true }));
		const mailbox = await sendableMailbox(c, input.mailboxId ?? "");

		const row = await c
			.get("db")
			.insert(messages)
			.values({
				mailboxId: mailbox.id,
				authorUserId: c.get("user").id,
				direction: "outbound",
				status: "draft",
				threadId: input.threadId ?? crypto.randomUUID(),
				inReplyTo: input.inReplyTo ?? null,
				subject: input.subject ?? null,
				fromAddress: mailbox.address,
				fromName: mailbox.displayName,
				toAddresses: input.to ?? [],
				ccAddresses: input.cc ?? [],
				bccAddresses: input.bcc ?? [],
				bodyText: input.bodyText ?? null,
				bodyHtml: input.bodyHtml ?? null,
				snippet: (input.bodyText ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
				receivedAt: new Date(),
			})
			.returning()
			.get();

		return c.json(row, 201);
	})

	.put("/drafts/:id", async (c) => {
		const input = await parseBody(c, composeInput.partial({ to: true, mailboxId: true }));

		const draft = await c
			.get("db")
			.select()
			.from(messages)
			.where(and(eq(messages.id, c.req.param("id")), eq(messages.status, "draft")))
			.get();
		if (!draft) notFound("Draft");

		const permission = await getPermission(c.get("db"), c.get("user"), draft.mailboxId);
		if (!hasAtLeast(permission, "full_access")) forbidden("You cannot edit drafts in this mailbox");

		/*
		 * Changing From moves the draft to another mailbox, so the caller has to be
		 * allowed to send from the destination too — otherwise this would be a way
		 * to put someone else's address in the From header.
		 */
		const movedTo =
			input.mailboxId && input.mailboxId !== draft.mailboxId
				? await sendableMailbox(c, input.mailboxId)
				: null;

		const row = await c
			.get("db")
			.update(messages)
			.set({
				...(movedTo
					? {
							mailboxId: movedTo.id,
							fromAddress: movedTo.address,
							fromName: movedTo.displayName,
						}
					: {}),
				subject: input.subject ?? draft.subject,
				toAddresses: input.to ?? draft.toAddresses,
				ccAddresses: input.cc ?? draft.ccAddresses,
				bccAddresses: input.bcc ?? draft.bccAddresses,
				bodyText: input.bodyText ?? draft.bodyText,
				bodyHtml: input.bodyHtml ?? draft.bodyHtml,
				snippet: (input.bodyText ?? draft.bodyText ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
			})
			.where(eq(messages.id, draft.id))
			.returning()
			.get();

		return c.json(row);
	})

	/** Composes and queues a message. Sending itself happens on the outbound queue. */
	.post("/", async (c) => {
		const input = await parseBody(c, composeInput);
		const mailbox = await sendableMailbox(c, input.mailboxId);

		const message = await c
			.get("db")
			.insert(messages)
			.values({
				mailboxId: mailbox.id,
				authorUserId: c.get("user").id,
				direction: "outbound",
				status: "sent",
				threadId: input.threadId ?? crypto.randomUUID(),
				inReplyTo: input.inReplyTo ?? null,
				subject: input.subject || null,
				fromAddress: mailbox.address,
				fromName: mailbox.displayName,
				toAddresses: input.to,
				ccAddresses: input.cc,
				bccAddresses: input.bcc,
				bodyText: input.bodyText || null,
				bodyHtml: input.bodyHtml ?? null,
				snippet: input.bodyText.replace(/\s+/g, " ").trim().slice(0, 200),
				read: true,
				receivedAt: new Date(),
			})
			.returning()
			.get();

		const job = await c
			.get("db")
			.insert(outboundJobs)
			.values({
				messageId: message.id,
				scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
			})
			.returning()
			.get();

		const payload: OutboundSendMessage = { kind: "outbound", jobId: job.id };
		// A scheduled send waits in the queue rather than in a table someone has to poll.
		const delaySeconds = input.scheduledFor
			? Math.max(0, Math.round((input.scheduledFor - Date.now()) / 1000))
			: undefined;
		await c.env.OUTBOUND_QUEUE.send(payload, delaySeconds ? { delaySeconds } : undefined);

		audit(c, { action: "message.send", mailboxId: mailbox.id, messageId: message.id });
		return c.json({ ...message, jobId: job.id }, 202);
	})

	/**
	 * Attaches a file to a draft.
	 *
	 * The body is the file itself rather than a multipart form: a Worker holds the
	 * whole upload in memory either way, and the raw stream skips a parse of
	 * something we already know the shape of. The name comes from `x-filename`
	 * because a raw body carries none.
	 */
	.post("/drafts/:id/attachments", async (c) => {
		const draft = await editableDraft(c, c.req.param("id"));

		const filename = decodeURIComponent(c.req.header("x-filename") ?? "").trim();
		if (!filename) throw new HTTPException(400, { message: "Missing x-filename" });

		const used = await attachedBytes(c, draft.id);
		const declared = Number(c.req.header("content-length") ?? "0");
		if (used + declared > MAX_TOTAL_ATTACHMENT_BYTES) {
			throw new HTTPException(413, {
				message: `Attachments may total ${MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024} MB`,
			});
		}

		const contentType = c.req.header("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
		const key = await putUpload(c.env, "attachments", c.req.raw, {
			accept: "any",
			maxBytes: MAX_ATTACHMENT_BYTES,
		});

		const object = await c.env.MAIL_BUCKET.head(key);

		const row = await c
			.get("db")
			.insert(messageAttachments)
			.values({
				messageId: draft.id,
				filename: filename.slice(0, 200),
				contentType,
				sizeBytes: object?.size ?? declared,
				disposition: "attachment",
				r2Key: key,
			})
			.returning()
			.get();

		await c.get("db").update(messages).set({ hasAttachments: true }).where(eq(messages.id, draft.id));

		return c.json(
			{
				id: row.id,
				filename: row.filename,
				contentType: row.contentType,
				sizeBytes: row.sizeBytes,
				disposition: row.disposition,
				contentId: row.contentId,
			},
			201,
		);
	})

	.delete("/drafts/:id/attachments/:attachmentId", async (c) => {
		const draft = await editableDraft(c, c.req.param("id"));

		const attachment = await c
			.get("db")
			.select()
			.from(messageAttachments)
			.where(
				and(
					eq(messageAttachments.id, c.req.param("attachmentId")),
					eq(messageAttachments.messageId, draft.id),
				),
			)
			.get();
		if (!attachment) notFound("Attachment");

		await c.get("db").delete(messageAttachments).where(eq(messageAttachments.id, attachment.id));
		// The row is the record; a bucket object nothing points at is only cost.
		await deleteObject(c.env, attachment.r2Key);

		const remaining = await attachedBytes(c, draft.id);
		if (remaining === 0) {
			await c.get("db").update(messages).set({ hasAttachments: false }).where(eq(messages.id, draft.id));
		}

		return c.json({ ok: true });
	})

	/** Sends an existing draft. */
	.post("/drafts/:id/send", async (c) => {
		const draft = await c
			.get("db")
			.select()
			.from(messages)
			.where(and(eq(messages.id, c.req.param("id")), eq(messages.status, "draft")))
			.get();
		if (!draft) notFound("Draft");

		const permission = await getPermission(c.get("db"), c.get("user"), draft.mailboxId);
		if (!canSendFrom(permission)) forbidden("You cannot send from this mailbox");
		if (draft.toAddresses.length === 0) {
			throw new HTTPException(422, { message: "Add at least one recipient before sending" });
		}

		await c.get("db").update(messages).set({ status: "sent", read: true }).where(eq(messages.id, draft.id));

		const job = await c
			.get("db")
			.insert(outboundJobs)
			.values({ messageId: draft.id })
			.returning()
			.get();

		const payload: OutboundSendMessage = { kind: "outbound", jobId: job.id };
		await c.env.OUTBOUND_QUEUE.send(payload);

		audit(c, { action: "message.send", mailboxId: draft.mailboxId, messageId: draft.id });
		return c.json({ id: draft.id, jobId: job.id }, 202);
	});

/** A draft the caller may edit, or the request stops here. */
async function editableDraft(c: Context<AppBindings>, id: string) {
	const draft = await c
		.get("db")
		.select()
		.from(messages)
		.where(and(eq(messages.id, id), eq(messages.status, "draft")))
		.get();
	if (!draft) notFound("Draft");

	const permission = await getPermission(c.get("db"), c.get("user"), draft.mailboxId);
	if (!hasAtLeast(permission, "full_access")) forbidden("You cannot edit drafts in this mailbox");
	return draft;
}

/** What the draft is already carrying, so the next upload can be refused early. */
async function attachedBytes(c: Context<AppBindings>, messageId: string): Promise<number> {
	const rows = await c
		.get("db")
		.select({ sizeBytes: messageAttachments.sizeBytes })
		.from(messageAttachments)
		.where(eq(messageAttachments.messageId, messageId))
		.all();

	return rows.reduce((total, row) => total + row.sizeBytes, 0);
}

/**
 * Resolves the mailbox to send from and checks the caller may put its address in the
 * From header — `read_only` sharing explicitly must not allow that. Exported
 * because a calendar invitation is sent from a mailbox on exactly the same terms.
 */
export async function sendableMailbox(
	c: Context<AppBindings>,
	mailboxId: string,
): Promise<{ id: string; address: string; displayName: string | null }> {
	const row = await c
		.get("db")
		.select({
			id: mailboxes.id,
			localPart: mailboxes.localPart,
			displayName: mailboxes.displayName,
			disabled: mailboxes.disabled,
			hostname: domains.hostname,
			sendingEnabled: domains.sendingEnabled,
		})
		.from(mailboxes)
		.innerJoin(domains, eq(domains.id, mailboxes.domainId))
		.where(eq(mailboxes.id, mailboxId))
		.get();

	if (!row) notFound("Mailbox");

	const permission = await getPermission(c.get("db"), c.get("user"), row.id);
	if (!canSendFrom(permission)) forbidden("You cannot send from this mailbox");
	if (row.disabled) throw new HTTPException(409, { message: "That mailbox is disabled" });

	return {
		id: row.id,
		address: `${row.localPart}@${row.hostname}`,
		displayName: row.displayName,
	};
}
