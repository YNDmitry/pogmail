import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, timestamps } from "./_shared";
import { folders, mailboxes } from "./mailboxes";
import { users } from "./users";

/**
 * Folder views are a filter over this column, not separate tables. Constrained to a
 * union so a typo cannot create an invisible folder.
 */
export const MESSAGE_STATUSES = ["received", "sent", "draft", "spam", "trash", "archived"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export type MailAddress = { address: string; name?: string };

/** A campaign can be cancelled, while its per-recipient messages remain auditable. */
export const CAMPAIGN_STATUSES = ["queued", "cancelled"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const emailCampaigns = sqliteTable(
	"email_campaigns",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		mailboxId: text("mailbox_id")
			.notNull()
			.references(() => mailboxes.id, { onDelete: "cascade" }),
		subject: text("subject").notNull(),
		status: text("status", { enum: CAMPAIGN_STATUSES }).notNull().default("queued"),
		recipientCount: integer("recipient_count").notNull(),
		/** Campaign copies share this queue wake-up time, if one was selected. */
		scheduledFor: integer("scheduled_for", { mode: "timestamp_ms" }),
		...timestamps(),
	},
	(t) => [
		index("email_campaigns_user_created_idx").on(t.userId, t.createdAt),
		index("email_campaigns_mailbox_idx").on(t.mailboxId, t.createdAt),
	],
);

export const messages = sqliteTable(
	"messages",
	{
		id: id(),
		mailboxId: text("mailbox_id")
			.notNull()
			.references(() => mailboxes.id, { onDelete: "cascade" }),
		/** Null for ordinary mail; campaign copies retain their immutable recipient record. */
		campaignId: text("campaign_id").references(() => emailCampaigns.id, { onDelete: "set null" }),
		/** Who composed it. Null for inbound mail, which nobody here authored. */
		authorUserId: text("author_user_id").references(() => users.id, { onDelete: "set null" }),
		direction: text("direction", { enum: MESSAGE_DIRECTIONS }).notNull(),

		/** RFC 5322 Message-ID; deduplicates redeliveries and threads replies. */
		messageId: text("message_id"),
		inReplyTo: text("in_reply_to"),
		/** Thread root Message-ID, or this message's own when it starts a thread. */
		threadId: text("thread_id").notNull(),

		status: text("status", { enum: MESSAGE_STATUSES }).notNull(),
		folderId: text("folder_id").references(() => folders.id, { onDelete: "set null" }),

		subject: text("subject"),
		fromAddress: text("from_address").notNull(),
		fromName: text("from_name"),
		/** Recipient lists as JSON arrays of `{ address, name }`. */
		toAddresses: text("to_addresses", { mode: "json" }).$type<MailAddress[]>().notNull(),
		ccAddresses: text("cc_addresses", { mode: "json" }).$type<MailAddress[]>(),
		bccAddresses: text("bcc_addresses", { mode: "json" }).$type<MailAddress[]>(),
		replyTo: text("reply_to"),

		snippet: text("snippet"),
		bodyText: text("body_text"),
		bodyHtml: text("body_html"),

		/** R2 key of the untouched MIME source, so the parse can be redone later. */
		rawKey: text("raw_key"),
		sizeBytes: integer("size_bytes").notNull().default(0),
		hasAttachments: integer("has_attachments", { mode: "boolean" }).notNull().default(false),

		read: integer("read", { mode: "boolean" }).notNull().default(false),
		starred: integer("starred", { mode: "boolean" }).notNull().default(false),
		snoozedUntil: integer("snoozed_until", { mode: "timestamp_ms" }),

		spamScore: integer("spam_score"),
		receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
		...timestamps(),
	},
	(t) => [
		// Every folder view is (mailbox, status) ordered by recency.
		index("messages_folder_idx").on(t.mailboxId, t.status, t.receivedAt),
		index("messages_thread_idx").on(t.mailboxId, t.threadId, t.receivedAt),
		index("messages_starred_idx").on(t.mailboxId, t.starred, t.receivedAt),
		index("messages_custom_folder_idx").on(t.folderId, t.receivedAt),
		index("messages_snoozed_idx").on(t.snoozedUntil),
		// Redelivery of the same Message-ID into the same mailbox is a no-op.
		uniqueIndex("messages_dedupe_unq").on(t.mailboxId, t.messageId),
	],
);

export const ATTACHMENT_DISPOSITIONS = ["attachment", "inline"] as const;
export type AttachmentDisposition = (typeof ATTACHMENT_DISPOSITIONS)[number];

export const messageAttachments = sqliteTable(
	"message_attachments",
	{
		id: id(),
		messageId: text("message_id")
			.notNull()
			.references(() => messages.id, { onDelete: "cascade" }),
		filename: text("filename").notNull(),
		contentType: text("content_type").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		disposition: text("disposition", { enum: ATTACHMENT_DISPOSITIONS }).notNull().default("attachment"),
		/** Content-ID for inline images referenced by `cid:` in the HTML body. */
		contentId: text("content_id"),
		r2Key: text("r2_key").notNull(),
		...timestamps(),
	},
	(t) => [
		index("message_attachments_message_idx").on(t.messageId),
		uniqueIndex("message_attachments_key_unq").on(t.r2Key),
	],
);

export const CONTACT_SOURCES = ["manual", "inbound", "outbound"] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

export const contacts = sqliteTable(
	"contacts",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		email: text("email").notNull(),
		displayName: text("display_name"),
		source: text("source", { enum: CONTACT_SOURCES }).notNull().default("inbound"),
		/** Blocked senders are rejected by the domain-scope routing phase. */
		blocked: integer("blocked", { mode: "boolean" }).notNull().default(false),
		/** A marketing opt-out never blocks ordinary inbound mail. */
		unsubscribedAt: integer("unsubscribed_at", { mode: "timestamp_ms" }),
		/** Opaque capability used only by the public unsubscribe page. */
		unsubscribeToken: text("unsubscribe_token"),
		messageCount: integer("message_count").notNull().default(0),
		lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
		...timestamps(),
	},
	(t) => [
		uniqueIndex("contacts_email_unq").on(t.userId, t.email),
		uniqueIndex("contacts_unsubscribe_token_unq").on(t.unsubscribeToken),
		index("contacts_blocked_idx").on(t.blocked),
	],
);

/** A reusable, owned subset of contacts for marketing campaigns. */
export const audiences = sqliteTable(
	"audiences",
	{
		id: id(),
		userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		description: text("description").notNull().default(""),
		...timestamps(),
	},
	(t) => [
		uniqueIndex("audiences_user_name_unq").on(t.userId, t.name),
		index("audiences_user_created_idx").on(t.userId, t.createdAt),
	],
);

export const audienceMembers = sqliteTable(
	"audience_members",
	{
		id: id(),
		audienceId: text("audience_id").notNull().references(() => audiences.id, { onDelete: "cascade" }),
		contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
		...timestamps(),
	},
	(t) => [
		uniqueIndex("audience_members_member_unq").on(t.audienceId, t.contactId),
		index("audience_members_contact_idx").on(t.contactId),
	],
);

export const OUTBOUND_STATUSES = ["queued", "sending", "sent", "failed"] as const;
export type OutboundStatus = (typeof OUTBOUND_STATUSES)[number];

export const outboundJobs = sqliteTable(
	"outbound_jobs",
	{
		id: id(),
		messageId: text("message_id")
			.notNull()
			.references(() => messages.id, { onDelete: "cascade" }),
		status: text("status", { enum: OUTBOUND_STATUSES }).notNull().default("queued"),
		attempts: integer("attempts").notNull().default(0),
		lastError: text("last_error"),
		scheduledFor: integer("scheduled_for", { mode: "timestamp_ms" }),
		sentAt: integer("sent_at", { mode: "timestamp_ms" }),
		...timestamps(),
	},
	(t) => [index("outbound_jobs_status_idx").on(t.status, t.createdAt)],
);

/** One row per envelope recipient: queue retries skip recipients already accepted. */
export const OUTBOUND_DELIVERY_STATUSES = ["pending", "sending", "sent", "failed", "permanent"] as const;
export type OutboundDeliveryStatus = (typeof OUTBOUND_DELIVERY_STATUSES)[number];

export const outboundDeliveries = sqliteTable(
	"outbound_deliveries",
	{
		id: id(),
		outboundJobId: text("outbound_job_id")
			.notNull()
			.references(() => outboundJobs.id, { onDelete: "cascade" }),
		recipient: text("recipient").notNull(),
		status: text("status", { enum: OUTBOUND_DELIVERY_STATUSES }).notNull().default("pending"),
		attempts: integer("attempts").notNull().default(0),
		lastError: text("last_error"),
		sentAt: integer("sent_at", { mode: "timestamp_ms" }),
		...timestamps(),
	},
	(t) => [
		uniqueIndex("outbound_deliveries_recipient_unq").on(t.outboundJobId, t.recipient),
		index("outbound_deliveries_status_idx").on(t.outboundJobId, t.status),
	],
);

/** Final Email Sending lifecycle events, deduplicated by Cloudflare's event id. */
export const EMAIL_DELIVERY_EVENT_TYPES = [
	"delivered",
	"deferred",
	"bounced",
	"failed",
	"rejected",
	"complained",
] as const;
export type EmailDeliveryEventType = (typeof EMAIL_DELIVERY_EVENT_TYPES)[number];

export const emailDeliveryEvents = sqliteTable(
	"email_delivery_events",
	{
		/** Cloudflare's eventId makes Queues' at-least-once delivery safe to replay. */
		eventId: text("event_id").primaryKey(),
		outboundDeliveryId: text("outbound_delivery_id")
			.notNull()
			.references(() => outboundDeliveries.id, { onDelete: "cascade" }),
		type: text("type", { enum: EMAIL_DELIVERY_EVENT_TYPES }).notNull(),
		deliveryStatus: text("delivery_status").notNull(),
		bounceType: text("bounce_type"),
		terminal: integer("terminal", { mode: "boolean" }).notNull(),
		/** Cloudflare's SMTP, bounce, failure or rejection explanation, capped before storage. */
		detail: text("detail"),
		occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
		...timestamps(),
	},
	(t) => [
		index("email_delivery_events_delivery_idx").on(t.outboundDeliveryId, t.occurredAt),
	],
);

export const emailTemplates = sqliteTable(
	"email_templates",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		subject: text("subject").notNull().default(""),
		bodyText: text("body_text").notNull().default(""),
		bodyHtml: text("body_html"),
		...timestamps(),
	},
	(t) => [index("email_templates_user_idx").on(t.userId)],
);

/**
 * Images owned by a template. They intentionally do not share the draft
 * attachment table: applying a template copies each image into the draft so a
 * later edit or deletion of the template can never change mail already sent.
 */
export const templateAttachments = sqliteTable(
	"template_attachments",
	{
		id: id(),
		templateId: text("template_id")
			.notNull()
			.references(() => emailTemplates.id, { onDelete: "cascade" }),
		filename: text("filename").notNull(),
		contentType: text("content_type").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		/** Kept separate from the draft's Content-ID; a fresh one is minted on insertion. */
		contentId: text("content_id").notNull(),
		r2Key: text("r2_key").notNull(),
		...timestamps(),
	},
	(t) => [
		index("template_attachments_template_idx").on(t.templateId),
		uniqueIndex("template_attachments_key_unq").on(t.r2Key),
	],
);

export const calendarEvents = sqliteTable(
	"calendar_events",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		mailboxId: text("mailbox_id").references(() => mailboxes.id, { onDelete: "set null" }),
		/** Set when the event came from an .ics invitation rather than the UI. */
		messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }),
		title: text("title").notNull(),
		description: text("description").notNull().default(""),
		location: text("location").notNull().default(""),
		attendees: text("attendees", { mode: "json" }).$type<MailAddress[]>().notNull().default([]),
		allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
		startsAt: integer("starts_at", { mode: "timestamp_ms" }).notNull(),
		endsAt: integer("ends_at", { mode: "timestamp_ms" }).notNull(),
		...timestamps(),
	},
	(t) => [index("calendar_events_user_starts_idx").on(t.userId, t.startsAt)],
);
