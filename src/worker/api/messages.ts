import { Hono, type Context } from "hono";
import { and, count, desc, eq, inArray, isNotNull, like, lt, or } from "drizzle-orm";
import { z } from "zod";
import { emailDeliveryEvents, MESSAGE_STATUSES, messageAttachments, messages, outboundDeliveries, outboundJobs } from "@/db/schema";
import type { OutboundSendMessage } from "../email/types";
import { audit } from "../audit";
import {
	getPermission,
	hasAtLeast,
	listAccessibleMailboxIds,
	resolveMailboxScope,
} from "../mailboxes/access";
import type { AppBindings } from "../middleware/context";
import { serveObject } from "../storage";
import { forbidden, notFound, parseBody, parseQuery } from "./_util";

const listQuery = z.object({
	status: z.enum(MESSAGE_STATUSES).optional(),
	mailboxId: z.string().optional(),
	folderId: z.string().optional(),
	starred: z.enum(["true", "false"]).optional(),
	snoozed: z.enum(["true", "false"]).optional(),
	unread: z.enum(["true", "false"]).optional(),
	search: z.string().trim().max(200).optional(),
	/** Keyset cursor: `receivedAt` epoch ms of the last row on the previous page. */
	cursor: z.coerce.number().int().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
});

const patchInput = z.object({
	read: z.boolean().optional(),
	starred: z.boolean().optional(),
	status: z.enum(MESSAGE_STATUSES).optional(),
	folderId: z.string().nullable().optional(),
	/** Epoch ms; null clears the snooze. */
	snoozedUntil: z.number().int().nullable().optional(),
});

const bulkInput = patchInput.extend({ ids: z.array(z.string().min(1)).min(1).max(500) });

/** Columns the list view needs. Bodies are deliberately excluded — they are large. */
const summaryColumns = {
	id: messages.id,
	mailboxId: messages.mailboxId,
	threadId: messages.threadId,
	direction: messages.direction,
	status: messages.status,
	folderId: messages.folderId,
	subject: messages.subject,
	fromAddress: messages.fromAddress,
	fromName: messages.fromName,
	toAddresses: messages.toAddresses,
	snippet: messages.snippet,
	read: messages.read,
	starred: messages.starred,
	snoozedUntil: messages.snoozedUntil,
	hasAttachments: messages.hasAttachments,
	sizeBytes: messages.sizeBytes,
	receivedAt: messages.receivedAt,
} as const;

export const messageRoutes = new Hono<AppBindings>()
	.get("/", async (c) => {
		const query = await parseQuery(c, listQuery);
		const scope = await resolveMailboxScope(c.get("db"), c.get("user"), query.mailboxId);
		if (scope.length === 0) return c.json({ items: [], nextCursor: null });

		const term = query.search ? `%${query.search}%` : null;

		const rows = await c
			.get("db")
			.select(summaryColumns)
			.from(messages)
			.where(
				and(
					inArray(messages.mailboxId, scope),
					query.status ? eq(messages.status, query.status) : undefined,
					query.folderId ? eq(messages.folderId, query.folderId) : undefined,
					query.starred ? eq(messages.starred, query.starred === "true") : undefined,
					query.unread ? eq(messages.read, query.unread !== "true") : undefined,
					query.snoozed === "true" ? isNotNull(messages.snoozedUntil) : undefined,
					term
						? or(
								like(messages.subject, term),
								like(messages.fromAddress, term),
								like(messages.snippet, term),
							)
						: undefined,
					query.cursor ? lt(messages.receivedAt, new Date(query.cursor)) : undefined,
				),
			)
			.orderBy(desc(messages.receivedAt))
			.limit(query.limit)
			.all();

		const last = rows.at(-1);
		return c.json({
			items: rows,
			nextCursor: rows.length === query.limit && last ? last.receivedAt.getTime() : null,
		});
	})

	/** Unread counts per folder view, for the sidebar badges. */
	.get("/counts", async (c) => {
		const scope = await listAccessibleMailboxIds(c.get("db"), c.get("user"));
		if (scope.length === 0) return c.json({ byStatus: {}, byMailbox: {}, starred: 0 });

		const byStatus = await c
			.get("db")
			.select({ status: messages.status, unread: count() })
			.from(messages)
			.where(and(inArray(messages.mailboxId, scope), eq(messages.read, false)))
			.groupBy(messages.status)
			.all();

		const byMailbox = await c
			.get("db")
			.select({ mailboxId: messages.mailboxId, unread: count() })
			.from(messages)
			.where(
				and(
					inArray(messages.mailboxId, scope),
					eq(messages.read, false),
					eq(messages.status, "received"),
				),
			)
			.groupBy(messages.mailboxId)
			.all();

		const starred = await c
			.get("db")
			.select({ total: count() })
			.from(messages)
			.where(and(inArray(messages.mailboxId, scope), eq(messages.starred, true)))
			.get();

		return c.json({
			byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row.unread])),
			byMailbox: Object.fromEntries(byMailbox.map((row) => [row.mailboxId, row.unread])),
			starred: starred?.total ?? 0,
		});
	})

	.patch("/bulk", async (c) => {
		const input = await parseBody(c, bulkInput);
		const { ids, ...patch } = input;

		// Filter to messages the caller may actually write, then update in one statement.
		const scope = await listAccessibleMailboxIds(c.get("db"), c.get("user"));
		if (scope.length === 0) return c.json({ updated: 0 });

		const result = await c
			.get("db")
			.update(messages)
			.set(toUpdate(patch))
			.where(and(inArray(messages.id, ids), inArray(messages.mailboxId, scope)))
			.returning({ id: messages.id })
			.all();

		audit(c, { action: "message.bulk_update", metadata: { count: result.length, patch } });
		return c.json({ updated: result.length });
	})

	.get("/:id", async (c) => {
		const message = await readable(c, c.req.param("id"));

		const [attachments, delivery] = await Promise.all([
			c
				.get("db")
			.select({
				id: messageAttachments.id,
				filename: messageAttachments.filename,
				contentType: messageAttachments.contentType,
				sizeBytes: messageAttachments.sizeBytes,
				disposition: messageAttachments.disposition,
				contentId: messageAttachments.contentId,
			})
			.from(messageAttachments)
			.where(eq(messageAttachments.messageId, message.id))
			.all(),
			c
				.get("db")
				.select({
					id: outboundJobs.id,
					status: outboundJobs.status,
					attempts: outboundJobs.attempts,
					lastError: outboundJobs.lastError,
					scheduledFor: outboundJobs.scheduledFor,
					sentAt: outboundJobs.sentAt,
				})
				.from(outboundJobs)
				.where(eq(outboundJobs.messageId, message.id))
				.get(),
		]);

		const recipients = delivery
			? await c
					.get("db")
					.select({
						id: outboundDeliveries.id,
						recipient: outboundDeliveries.recipient,
						status: outboundDeliveries.status,
						attempts: outboundDeliveries.attempts,
						lastError: outboundDeliveries.lastError,
						sentAt: outboundDeliveries.sentAt,
					})
					.from(outboundDeliveries)
					.where(eq(outboundDeliveries.outboundJobId, delivery.id))
					.orderBy(outboundDeliveries.createdAt)
					.all()
			: [];
		const deliveryEvents = recipients.length
			? await c
					.get("db")
					.select({
						outboundDeliveryId: emailDeliveryEvents.outboundDeliveryId,
						type: emailDeliveryEvents.type,
						deliveryStatus: emailDeliveryEvents.deliveryStatus,
						bounceType: emailDeliveryEvents.bounceType,
						terminal: emailDeliveryEvents.terminal,
						detail: emailDeliveryEvents.detail,
						occurredAt: emailDeliveryEvents.occurredAt,
					})
					.from(emailDeliveryEvents)
					.where(inArray(emailDeliveryEvents.outboundDeliveryId, recipients.map((recipient) => recipient.id)))
					.orderBy(desc(emailDeliveryEvents.occurredAt))
					.all()
			: [];
		const latestLifecycle = new Map<string, (typeof deliveryEvents)[number]>();
		for (const event of deliveryEvents) {
			if (!latestLifecycle.has(event.outboundDeliveryId)) latestLifecycle.set(event.outboundDeliveryId, event);
		}

		return c.json({
			...message,
			attachments,
			delivery: delivery
				? {
						...delivery,
						recipients: recipients.map(({ id, ...recipient }) => ({
							...recipient,
							lifecycle: latestLifecycle.get(id) ?? null,
						})),
					}
				: null,
		});
	})

	/** The full thread this message belongs to, oldest first. */
	.get("/:id/thread", async (c) => {
		const message = await readable(c, c.req.param("id"));

		const rows = await c
			.get("db")
			.select(summaryColumns)
			.from(messages)
			.where(and(eq(messages.mailboxId, message.mailboxId), eq(messages.threadId, message.threadId)))
			.orderBy(messages.receivedAt)
			.all();

		return c.json({ items: rows });
	})

	.get("/:id/attachments/:attachmentId", async (c) => {
		const message = await readable(c, c.req.param("id"));

		const attachment = await c
			.get("db")
			.select()
			.from(messageAttachments)
			.where(
				and(
					eq(messageAttachments.id, c.req.param("attachmentId")),
					eq(messageAttachments.messageId, message.id),
				),
			)
			.get();

		if (!attachment) notFound("Attachment");
		// CID parts must render inside the reader; regular files should still download.
		return serveObject(c.env, attachment.r2Key, attachment.disposition === "inline" ? undefined : attachment.filename);
	})

	/** The untouched MIME source, for debugging a bad parse. */
	.get("/:id/raw", async (c) => {
		const message = await readable(c, c.req.param("id"));
		if (!message.rawKey) notFound("Raw message");
		return serveObject(c.env, message.rawKey, `${message.id}.eml`);
	})

	.patch("/:id", async (c) => {
		const input = await parseBody(c, patchInput);
		const message = await writable(c, c.req.param("id"));

		const row = await c
			.get("db")
			.update(messages)
			.set(toUpdate(input))
			.where(eq(messages.id, message.id))
			.returning()
			.get();

		return c.json(row);
	})

	.post("/:id/retry", async (c) => {
		const message = await writable(c, c.req.param("id"));
		const job = await c
			.get("db")
			.select()
			.from(outboundJobs)
			.where(and(eq(outboundJobs.messageId, message.id), eq(outboundJobs.status, "failed")))
			.get();
		if (!job) notFound("Failed delivery");

		await c
			.get("db")
			.update(outboundJobs)
			.set({ status: "queued", lastError: null, scheduledFor: null })
			.where(eq(outboundJobs.id, job.id));
		// Automatic retries deliberately skip permanent Cloudflare rejections. A
		// person pressing Retry has made a fresh, explicit decision — perhaps the
		// sender domain was just onboarded — so return those rows to the retry set.
		await c
			.get("db")
			.update(outboundDeliveries)
			.set({ status: "failed", lastError: null })
			.where(and(eq(outboundDeliveries.outboundJobId, job.id), eq(outboundDeliveries.status, "permanent")));
		await c.env.OUTBOUND_QUEUE.send({ kind: "outbound", jobId: job.id } satisfies OutboundSendMessage);
		audit(c, { action: "message.retry", messageId: message.id, mailboxId: message.mailboxId });
		return c.json({ ok: true });
	})

	/** Permanent delete. Moving to trash is a status patch, not this. */
	.delete("/:id", async (c) => {
		const message = await writable(c, c.req.param("id"));

		const attachments = await c
			.get("db")
			.select({ r2Key: messageAttachments.r2Key })
			.from(messageAttachments)
			.where(eq(messageAttachments.messageId, message.id))
			.all();

		await c.get("db").delete(messages).where(eq(messages.id, message.id));

		// Blobs outlive the row unless we clean them up explicitly.
		const keys = attachments.map((row) => row.r2Key);
		if (message.rawKey) keys.push(message.rawKey);
		await Promise.all(keys.map((key) => c.env.MAIL_BUCKET.delete(key)));

		audit(c, { action: "message.delete", messageId: message.id, mailboxId: message.mailboxId });
		return c.json({ ok: true });
	});

function toUpdate(patch: z.infer<typeof patchInput>) {
	return {
		...(patch.read !== undefined ? { read: patch.read } : {}),
		...(patch.starred !== undefined ? { starred: patch.starred } : {}),
		...(patch.status !== undefined ? { status: patch.status } : {}),
		...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}),
		...(patch.snoozedUntil !== undefined
			? { snoozedUntil: patch.snoozedUntil === null ? null : new Date(patch.snoozedUntil) }
			: {}),
	};
}

type MessageRow = typeof messages.$inferSelect;

/** Loads a message the caller may read, or 404s — a mailbox they cannot see must
 * be indistinguishable from one that does not exist. */
async function readable(c: Context<AppBindings>, id: string): Promise<MessageRow> {
	return load(c, id, "read_only");
}

/** Same, but requires write access; a read-only sharer gets 403, not a silent no-op. */
async function writable(c: Context<AppBindings>, id: string): Promise<MessageRow> {
	return load(c, id, "full_access");
}

async function load(
	c: Context<AppBindings>,
	id: string,
	required: "read_only" | "full_access",
): Promise<MessageRow> {
	const message = await c.get("db").select().from(messages).where(eq(messages.id, id)).get();
	if (!message) notFound("Message");

	const permission = await getPermission(c.get("db"), c.get("user"), message.mailboxId);
	if (!hasAtLeast(permission, "read_only")) notFound("Message");
	if (required === "full_access" && !hasAtLeast(permission, "full_access")) {
		forbidden("Read-only access to this mailbox");
	}

	return message;
}
