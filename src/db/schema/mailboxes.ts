import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, timestamps } from "./_shared";
import { domains } from "./domains";
import { users } from "./users";

export const MAILBOX_TYPES = ["personal", "shared"] as const;
export type MailboxType = (typeof MAILBOX_TYPES)[number];

export const mailboxes = sqliteTable(
	"mailboxes",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		domainId: text("domain_id")
			.notNull()
			.references(() => domains.id, { onDelete: "cascade" }),
		/** Local part only. The address is `localPart@domain.hostname`. */
		localPart: text("local_part").notNull(),
		displayName: text("display_name"),
		/** Plain-text fallback for signatures sent to clients that decline HTML. */
		signature: text("signature"),
		signatureHtml: text("signature_html"),
		avatarKey: text("avatar_key"),
		type: text("type", { enum: MAILBOX_TYPES }).notNull().default("personal"),
		/** Accept mail for this local part on every verified domain, not just `domainId`. */
		useAllDomains: integer("use_all_domains", { mode: "boolean" }).notNull().default(false),

		autoReplyEnabled: integer("auto_reply_enabled", { mode: "boolean" }).notNull().default(false),
		autoReplySubject: text("auto_reply_subject").notNull().default("Out of office"),
		autoReplyBody: text("auto_reply_body").notNull().default(""),
		autoReplyHtml: text("auto_reply_html"),

		/** Cloudflare Email Routing rule id, so teardown removes the right rule. */
		cloudflareRuleId: text("cloudflare_rule_id"),
		disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
		...timestamps(),
	},
	(t) => [
		uniqueIndex("mailboxes_address_unq").on(t.domainId, t.localPart),
		index("mailboxes_user_idx").on(t.userId),
	],
);

/** Extra addresses that deliver into an existing mailbox. */
export const mailboxAliases = sqliteTable(
	"mailbox_aliases",
	{
		id: id(),
		mailboxId: text("mailbox_id")
			.notNull()
			.references(() => mailboxes.id, { onDelete: "cascade" }),
		domainId: text("domain_id")
			.notNull()
			.references(() => domains.id, { onDelete: "cascade" }),
		localPart: text("local_part").notNull(),
		...timestamps(),
	},
	(t) => [
		uniqueIndex("mailbox_aliases_address_unq").on(t.domainId, t.localPart),
		index("mailbox_aliases_mailbox_idx").on(t.mailboxId),
	],
);

/**
 * Sharing grants, ordered least to most capable. `send_as` puts the mailbox address in
 * From; `send_on_behalf` sends as the grantee with the mailbox in Sender.
 */
export const MAILBOX_PERMISSIONS = ["read_only", "send_as", "send_on_behalf", "full_access"] as const;
export type MailboxPermission = (typeof MAILBOX_PERMISSIONS)[number];

export const mailboxAccess = sqliteTable(
	"mailbox_access",
	{
		id: id(),
		mailboxId: text("mailbox_id")
			.notNull()
			.references(() => mailboxes.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		permission: text("permission", { enum: MAILBOX_PERMISSIONS }).notNull().default("read_only"),
		createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
		...timestamps(),
	},
	(t) => [
		uniqueIndex("mailbox_access_unq").on(t.mailboxId, t.userId),
		index("mailbox_access_user_idx").on(t.userId),
	],
);

/**
 * One row per (mailbox, sender) so an auto-reply is sent at most once per correspondent.
 * Without it a pair of out-of-office mailboxes will happily mail each other forever.
 */
export const autoReplyDeliveries = sqliteTable(
	"auto_reply_deliveries",
	{
		id: id(),
		mailboxId: text("mailbox_id")
			.notNull()
			.references(() => mailboxes.id, { onDelete: "cascade" }),
		recipient: text("recipient").notNull(),
		sentAt: integer("sent_at", { mode: "timestamp_ms" }).notNull(),
	},
	(t) => [
		uniqueIndex("auto_reply_deliveries_unq").on(t.mailboxId, t.recipient),
		index("auto_reply_deliveries_sent_idx").on(t.sentAt),
	],
);

export const folders = sqliteTable(
	"folders",
	{
		id: id(),
		mailboxId: text("mailbox_id")
			.notNull()
			.references(() => mailboxes.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		color: text("color"),
		position: integer("position").notNull().default(0),
		...timestamps(),
	},
	(t) => [uniqueIndex("folders_name_unq").on(t.mailboxId, t.name)],
);
