import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { audienceMembers, audiences, contacts, domains, emailCampaigns, mailboxes, messageAttachments, messages, outboundJobs } from "@/db/schema";
import { audit } from "../audit";
import { canSendFrom, getPermission, hasAtLeast } from "../mailboxes/access";
import type { AppBindings } from "../middleware/context";
import { forbidden, notFound, parseBody } from "./_util";
import { deleteObject, putUpload, serveObject } from "../storage";
import type { OutboundSendMessage } from "../email/types";
import { nextScheduledDelay } from "../email/schedule";

/*
 * Cloudflare rejects an outbound message over 25 MB, and base64 inflates the
 * bytes by a third on the way into the MIME envelope, so the ceiling here is the
 * one that keeps an accepted upload sendable rather than the one R2 allows.
 */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024;

const address = z.object({ address: z.email(), name: z.string().max(120).optional() });

function validateRecipientLimit(
	input: { to?: { address: string }[]; cc?: { address: string }[]; bcc?: { address: string }[] },
	ctx: z.RefinementCtx,
): void {
	const recipients = new Set(
		[...(input.to ?? []), ...(input.cc ?? []), ...(input.bcc ?? [])].map((entry) => entry.address.toLowerCase()),
	);
	if (recipients.size > 50) {
		ctx.addIssue({ code: "custom", message: "A message may have at most 50 unique recipients" });
	}
}

const composeShape = z.object({
	mailboxId: z.string().min(1),
	to: z.array(address).min(1).max(50),
	cc: z.array(address).max(50).default([]),
	bcc: z.array(address).max(50).default([]),
	subject: z.string().max(300).default(""),
	bodyText: z.string().max(500_000).default(""),
	bodyHtml: z.string().max(1_000_000).nullable().optional(),
	/** Set when replying, so the thread stays intact for the recipient's client. */
	inReplyTo: z.string().max(300).nullable().optional(),
	threadId: z.string().max(300).nullable().optional(),
	/** Epoch ms; the message waits in the queue until then. */
	scheduledFor: z.number().int().nullable().optional(),
});

const composeInput = composeShape.superRefine(validateRecipientLimit);

/*
 * A campaign intentionally makes one message per contact. Apart from keeping
 * recipients private from one another, that lets the existing delivery ledger
 * tell the sender exactly which address accepted or rejected its own mail.
 * Queues absorb the delivery rate, but capping a request keeps one click from
 * monopolising a Worker invocation.
 */
const campaignInput = z.object({
	mailboxId: z.string().min(1),
	contactIds: z.array(z.string().min(1)).max(500).default([]),
	audienceId: z.string().min(1).optional(),
	subject: z.string().min(1).max(300),
	bodyText: z.string().min(1).max(500_000),
	bodyHtml: z.string().max(1_000_000).nullable().optional(),
	/** Epoch ms; each recipient waits in Queues until this campaign begins. */
	scheduledFor: z.number().int().nullable().optional(),
}).superRefine((input, ctx) => {
	if (input.contactIds.length === 0 && !input.audienceId) {
		ctx.addIssue({ code: "custom", message: "Choose contacts or an audience" });
	}
	if (new Set(input.contactIds).size !== input.contactIds.length) {
		ctx.addIssue({ code: "custom", message: "Choose each contact only once" });
	}
	/* Template images use private URLs until they are copied into a draft as CID parts. */
	if (input.bodyHtml?.includes("/api/templates/")) {
		ctx.addIssue({
			code: "custom",
			message: "Campaigns cannot use template images yet. Remove the image or send from a draft.",
		});
	}
	if (input.scheduledFor && input.scheduledFor <= Date.now()) {
		ctx.addIssue({ code: "custom", message: "Choose a future send time" });
	}
});

const campaignTestInput = z.object({
	mailboxId: z.string().min(1),
	to: z.array(address).min(1).max(5),
	subject: z.string().min(1).max(300),
	bodyText: z.string().min(1).max(500_000),
	bodyHtml: z.string().max(1_000_000).nullable().optional(),
});

// A draft is an unfinished envelope: body, attachment, or a CID image may be
// saved before the recipient is known. The actual send endpoint keeps the
// stricter `composeInput` and will still refuse an empty `To` list.
const draftInput = composeShape
	.partial({ to: true, mailboxId: true })
	.extend({ to: z.array(address).max(50).optional() })
	.superRefine(validateRecipientLimit);

export const sendRoutes = new Hono<AppBindings>()
	/** Saves or updates a draft without sending it. */
	.post("/drafts", async (c) => {
		const input = await parseBody(c, draftInput);
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
		const input = await parseBody(c, draftInput);

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

		await removeUnusedInlineAttachments(c, row.id, row.bodyHtml);

		return c.json(row);
	})

	/** Composes and queues a message. Sending itself happens on the outbound queue. */
	.post("/", async (c) => {
		const input = await parseBody(c, composeInput);
		const mailbox = await sendableMailbox(c, input.mailboxId, { requireSending: true });

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
			? nextScheduledDelay(new Date(input.scheduledFor))
			: undefined;
		await c.env.OUTBOUND_QUEUE.send(payload, delaySeconds ? { delaySeconds } : undefined);

		audit(c, { action: "message.send", mailboxId: mailbox.id, messageId: message.id });
		return c.json({ ...message, jobId: job.id }, 202);
	})

	/** Recent campaigns, with delivery progress calculated from their individual jobs. */
	.get("/campaigns", async (c) => {
		const campaigns = await c.get("db").select().from(emailCampaigns)
			.where(eq(emailCampaigns.userId, c.get("user").id))
			.orderBy(desc(emailCampaigns.createdAt)).limit(50).all();
		if (campaigns.length === 0) return c.json({ items: [] });

		const deliveryCounts = await c.get("db")
			.select({ campaignId: messages.campaignId, status: outboundJobs.status, total: count() })
			.from(messages)
			.innerJoin(outboundJobs, eq(outboundJobs.messageId, messages.id))
			.where(inArray(messages.campaignId, campaigns.map((campaign) => campaign.id)))
			.groupBy(messages.campaignId, outboundJobs.status)
			.all();
		const byCampaign = new Map<string, { queued: number; sending: number; sent: number; failed: number }>();
		for (const row of deliveryCounts) {
			if (!row.campaignId) continue;
			const current = byCampaign.get(row.campaignId) ?? { queued: 0, sending: 0, sent: 0, failed: 0 };
			current[row.status] = row.total;
			byCampaign.set(row.campaignId, current);
		}

		return c.json({
			items: campaigns.map((campaign) => {
				const delivery = byCampaign.get(campaign.id) ?? { queued: 0, sending: 0, sent: 0, failed: 0 };
				const state = campaign.status === "cancelled"
					? "cancelled"
					: delivery.sending > 0
						? "sending"
						: delivery.queued > 0
							? "queued"
							: "completed";
				return { ...campaign, state, ...delivery };
			}),
		});
	})

	/** Queues a private, individually addressed copy for every selected contact. */
	.post("/campaigns", async (c) => {
		const input = await parseBody(c, campaignInput);
		const mailbox = await sendableMailbox(c, input.mailboxId, { requireSending: true });
		const requested = new Set(input.contactIds);
		const recipients = input.audienceId
			? await audienceRecipients(c, input.audienceId)
			: await c.get("db").select({
				id: contacts.id, email: contacts.email, displayName: contacts.displayName, blocked: contacts.blocked,
				unsubscribedAt: contacts.unsubscribedAt, unsubscribeToken: contacts.unsubscribeToken,
			}).from(contacts).where(and(eq(contacts.userId, c.get("user").id), inArray(contacts.id, input.contactIds))).all();
		const sendable = recipients.filter((contact) => !contact.blocked && !contact.unsubscribedAt);
		if (sendable.length === 0) {
			throw new HTTPException(422, { message: "Choose at least one subscribed contact that is not blocked" });
		}
		const campaign = await c.get("db").insert(emailCampaigns).values({
			userId: c.get("user").id,
			mailboxId: mailbox.id,
			subject: input.subject,
			recipientCount: sendable.length,
			scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
		}).returning().get();

		const queued: Array<{ messageId: string; jobId: string }> = [];
		for (const recipient of sendable) {
			const unsubscribeToken = recipient.unsubscribeToken ?? crypto.randomUUID();
			if (!recipient.unsubscribeToken) {
				await c.get("db").update(contacts).set({ unsubscribeToken }).where(eq(contacts.id, recipient.id));
			}
			const unsubscribeUrl = new URL(`/api/public/unsubscribe?token=${unsubscribeToken}`, c.req.url).toString();
			const body = personalisedCampaignBody(input.bodyText, input.bodyHtml ?? null, recipient, unsubscribeUrl);
			const message = await c
				.get("db")
				.insert(messages)
				.values({
					mailboxId: mailbox.id,
					campaignId: campaign.id,
					authorUserId: c.get("user").id,
					direction: "outbound",
					status: "sent",
					threadId: crypto.randomUUID(),
					subject: input.subject,
					fromAddress: mailbox.address,
					fromName: mailbox.displayName,
					toAddresses: [{ address: recipient.email, ...(recipient.displayName ? { name: recipient.displayName } : {}) }],
					ccAddresses: [],
					bccAddresses: [],
					bodyText: body.text,
					bodyHtml: body.html,
					snippet: body.text.replace(/\s+/g, " ").trim().slice(0, 200),
					read: true,
					receivedAt: new Date(),
				})
				.returning()
				.get();
			const job = await c.get("db").insert(outboundJobs).values({
				messageId: message.id,
				scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
			}).returning().get();
			queued.push({ messageId: message.id, jobId: job.id });
		}

		// Queue batches accept at most 100 messages. Separate batches avoid a burst
		// of HTTP calls while preserving normal at-least-once delivery semantics.
		const delaySeconds = input.scheduledFor ? nextScheduledDelay(new Date(input.scheduledFor)) : undefined;
		for (const batch of chunks(queued, 100)) {
			await c.env.OUTBOUND_QUEUE.sendBatch(batch.map(({ jobId }) => ({
				body: { kind: "outbound", jobId } satisfies OutboundSendMessage,
				...(delaySeconds ? { delaySeconds } : {}),
			})));
		}

		const returned = new Set(recipients.map((recipient) => recipient.id));
		const skippedBlocked = recipients.filter((recipient) => recipient.blocked).length;
		const skippedUnsubscribed = recipients.filter((recipient) => recipient.unsubscribedAt).length;
		const skippedMissing = [...requested].filter((id) => !returned.has(id)).length;
		audit(c, {
			action: "campaign.send",
			mailboxId: mailbox.id,
			metadata: { campaignId: campaign.id, queued: queued.length, skippedBlocked, skippedUnsubscribed, skippedMissing },
		});
		return c.json({ id: campaign.id, queued: queued.length, skippedBlocked, skippedUnsubscribed, skippedMissing }, 202);
	})

	/** Sends up to five clearly marked copies without touching an audience or its opt-out state. */
	.post("/campaigns/test", async (c) => {
		const input = await parseBody(c, campaignTestInput);
		const mailbox = await sendableMailbox(c, input.mailboxId, { requireSending: true });
		const unique = [...new Map(input.to.map((recipient) => [recipient.address.toLowerCase(), recipient])).values()];
		const queued: Array<{ jobId: string }> = [];
		for (const recipient of unique) {
			const body = testCampaignBody(input.bodyText, input.bodyHtml ?? null, recipient);
			const message = await c.get("db").insert(messages).values({
				mailboxId: mailbox.id,
				authorUserId: c.get("user").id,
				direction: "outbound",
				status: "sent",
				threadId: crypto.randomUUID(),
				subject: `[Test] ${input.subject}`,
				fromAddress: mailbox.address,
				fromName: mailbox.displayName,
				toAddresses: [recipient], ccAddresses: [], bccAddresses: [],
				bodyText: body.text, bodyHtml: body.html,
				snippet: body.text.replace(/\s+/g, " ").trim().slice(0, 200),
				read: true, receivedAt: new Date(),
			}).returning().get();
			const job = await c.get("db").insert(outboundJobs).values({ messageId: message.id }).returning().get();
			queued.push({ jobId: job.id });
		}
		await c.env.OUTBOUND_QUEUE.sendBatch(queued.map(({ jobId }) => ({ body: { kind: "outbound", jobId } satisfies OutboundSendMessage })));
		audit(c, { action: "campaign.test_send", mailboxId: mailbox.id, metadata: { recipients: unique.length } });
		return c.json({ queued: unique.length }, 202);
	})

	/** Stops queue consumers before they send the remaining private copies. */
	.post("/campaigns/:id/cancel", async (c) => {
		const campaign = await c.get("db").select().from(emailCampaigns).where(and(
			eq(emailCampaigns.id, c.req.param("id")),
			eq(emailCampaigns.userId, c.get("user").id),
		)).get();
		if (!campaign) notFound("Campaign");
		if (campaign.status === "cancelled") return c.json({ ok: true });

		await c.get("db").update(emailCampaigns).set({ status: "cancelled" })
			.where(eq(emailCampaigns.id, campaign.id));
		const campaignMessages = await c.get("db").select({ id: messages.id }).from(messages)
			.where(eq(messages.campaignId, campaign.id)).all();
		if (campaignMessages.length > 0) {
			await c.get("db").update(outboundJobs).set({ status: "failed", lastError: "Campaign cancelled" })
				.where(and(inArray(outboundJobs.messageId, campaignMessages.map((message) => message.id)), eq(outboundJobs.status, "queued")));
		}
		audit(c, { action: "campaign.cancel", mailboxId: campaign.mailboxId, metadata: { campaignId: campaign.id } });
		return c.json({ ok: true });
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
		const inline = c.req.header("x-inline") === "true";

		const used = await attachedBytes(c, draft.id);
		const declared = Number(c.req.header("content-length") ?? "0");
		if (used + declared > MAX_TOTAL_ATTACHMENT_BYTES) {
			throw new HTTPException(413, {
				message: `Attachments may total ${MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024} MB`,
			});
		}

		const contentType = c.req.header("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
		if (inline && !contentType.startsWith("image/")) {
			throw new HTTPException(415, { message: "Inline attachments must be images" });
		}
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
				disposition: inline ? "inline" : "attachment",
				contentId: inline ? crypto.randomUUID() : null,
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

	/** A private, inline-safe preview URL for CID images while a draft is open. */
	.get("/drafts/:id/attachments/:attachmentId", async (c) => {
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
		return serveObject(c.env, attachment.r2Key);
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

function chunks<T>(items: T[], size: number): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
	return result;
}

async function audienceRecipients(c: Context<AppBindings>, audienceId: string) {
	const audience = await c.get("db").select({ id: audiences.id }).from(audiences).where(and(
		eq(audiences.id, audienceId), eq(audiences.userId, c.get("user").id),
	)).get();
	if (!audience) notFound("Audience");
	const recipients = await c.get("db").select({
		id: contacts.id, email: contacts.email, displayName: contacts.displayName, blocked: contacts.blocked,
		unsubscribedAt: contacts.unsubscribedAt, unsubscribeToken: contacts.unsubscribeToken,
	}).from(audienceMembers).innerJoin(contacts, eq(contacts.id, audienceMembers.contactId))
		.where(eq(audienceMembers.audienceId, audience.id)).limit(501).all();
	if (recipients.length > 500) {
		throw new HTTPException(422, { message: "An audience may have at most 500 contacts per campaign" });
	}
	return recipients;
}

function personalisedCampaignBody(
	bodyText: string,
	bodyHtml: string | null,
	recipient: { email: string; displayName: string | null },
	unsubscribeUrl: string,
) {
	const firstName = recipient.displayName?.trim().split(/\s+/)[0] || "there";
	const text = replaceTokens(bodyText, { firstName, email: recipient.email, unsubscribeUrl }) + `\n\nUnsubscribe: ${unsubscribeUrl}`;
	if (!bodyHtml) return { text, html: null };
	const html = replaceTokens(bodyHtml, {
		firstName: escapeHtml(firstName), email: escapeHtml(recipient.email), unsubscribeUrl: escapeHtml(unsubscribeUrl),
	}) + `<p style="margin-top:24px;font-size:12px;color:#666"><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe from these emails</a></p>`;
	return { text, html };
}

function testCampaignBody(bodyText: string, bodyHtml: string | null, recipient: { address: string; name?: string }) {
	const firstName = recipient.name?.trim().split(/\s+/)[0] || "there";
	const text = `[This is a test email]\n\n${replaceTokens(bodyText, { firstName, email: recipient.address, unsubscribeUrl: "" })}`;
	const html = bodyHtml
		? `<p style="margin:0 0 20px;padding:10px;background:#fff4e5;color:#7a4500;font-size:13px">This is a test email. It was not sent to your audience.</p>${replaceTokens(bodyHtml, { firstName: escapeHtml(firstName), email: escapeHtml(recipient.address), unsubscribeUrl: "" })}`
		: null;
	return { text, html };
}

function replaceTokens(value: string, variables: { firstName: string; email: string; unsubscribeUrl: string }) {
	return value
		.replaceAll("{{first_name}}", variables.firstName)
		.replaceAll("{{email}}", variables.email)
		.replaceAll("{{unsubscribe_url}}", variables.unsubscribeUrl);
}

function escapeHtml(value: string) {
	return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

/** Removes CID blobs when their image was removed from the rich-text document. */
async function removeUnusedInlineAttachments(
	c: Context<AppBindings>,
	messageId: string,
	bodyHtml: string | null,
) {
	const inline = await c
		.get("db")
		.select({ id: messageAttachments.id, contentId: messageAttachments.contentId, r2Key: messageAttachments.r2Key })
		.from(messageAttachments)
		.where(and(eq(messageAttachments.messageId, messageId), eq(messageAttachments.disposition, "inline")))
		.all();

	const unused = inline.filter((attachment) =>
		attachment.contentId ? !(bodyHtml ?? "").includes(`cid:${attachment.contentId}`) : true,
	);
	if (unused.length === 0) return;

	await c.get("db").delete(messageAttachments).where(inArray(messageAttachments.id, unused.map(({ id }) => id)));
	await Promise.all(unused.map((attachment) => deleteObject(c.env, attachment.r2Key)));

	if ((await attachedBytes(c, messageId)) === 0) {
		await c.get("db").update(messages).set({ hasAttachments: false }).where(eq(messages.id, messageId));
	}
}

/**
 * Resolves the mailbox to send from and checks the caller may put its address in the
 * From header — `read_only` sharing explicitly must not allow that. A caller that
 * is about to queue mail can also require the domain's Email Sending onboarding;
 * drafts deliberately do not, so work is never blocked by domain setup. Exported
 * because a calendar invitation is sent from a mailbox on exactly the same terms.
 */
export async function sendableMailbox(
	c: Context<AppBindings>,
	mailboxId: string,
	options: { requireSending?: boolean } = {},
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
	if (options.requireSending && !row.sendingEnabled) {
		throw new HTTPException(409, {
			message: "Email Sending is not ready for this domain. An administrator can finish setup from Domains → Verify.",
		});
	}

	return {
		id: row.id,
		address: `${row.localPart}@${row.hostname}`,
		displayName: row.displayName,
	};
}
