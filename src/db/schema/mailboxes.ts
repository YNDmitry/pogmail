import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, timestamps } from "./_shared";
import { domains } from "./domains";
import { users } from "./users";

export const MAILBOX_TYPES = ["personal", "shared"] as const;
export type MailboxType = (typeof MAILBOX_TYPES)[number];

/** How mail reaches this mailbox and leaves it again. */
export const MAILBOX_SOURCES = ["cloudflare", "external"] as const;
export type MailboxSource = (typeof MAILBOX_SOURCES)[number];

export const mailboxes = sqliteTable(
	"mailboxes",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		/** Present only for a domain which Pogmail provisions through Cloudflare. */
		domainId: text("domain_id").references(() => domains.id, { onDelete: "cascade" }),
		/** Local part only. The address is `localPart@domain.hostname`. */
		localPart: text("local_part").notNull(),
		source: text("source", { enum: MAILBOX_SOURCES }).notNull().default("cloudflare"),
		/** Full address for an externally hosted mailbox. Never use it for a Cloudflare mailbox. */
		externalAddress: text("external_address"),
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
		uniqueIndex("mailboxes_external_address_unq").on(t.externalAddress),
		index("mailboxes_user_idx").on(t.userId),
		index("mailboxes_source_idx").on(t.source),
	],
);

export const EXTERNAL_ACCOUNT_STATUSES = ["active", "paused", "needs_auth", "error"] as const;
export type ExternalAccountStatus = (typeof EXTERNAL_ACCOUNT_STATUSES)[number];

/**
 * One encrypted, long-lived IMAP/SMTP connection per external mailbox. Protocol
 * credentials are sealed as a JSON envelope so the application never needs to
 * return a password or token after the initial connection form is submitted.
 */
export const externalAccounts = sqliteTable(
	"external_accounts",
	{
		id: id(),
		mailboxId: text("mailbox_id")
			.notNull()
			.references(() => mailboxes.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		imapHost: text("imap_host").notNull(),
		imapPort: integer("imap_port").notNull(),
		imapSecurity: text("imap_security", { enum: ["tls", "starttls"] }).notNull(),
		imapUsername: text("imap_username").notNull(),
		imapSecret: text("imap_secret").notNull(),
		smtpHost: text("smtp_host").notNull(),
		smtpPort: integer("smtp_port").notNull(),
		smtpSecurity: text("smtp_security", { enum: ["tls", "starttls"] }).notNull(),
		smtpUsername: text("smtp_username").notNull(),
		smtpSecret: text("smtp_secret").notNull(),
		status: text("status", { enum: EXTERNAL_ACCOUNT_STATUSES }).notNull().default("active"),
		lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
		lastError: text("last_error"),
		/** A D1 lease prevents an at-least-once queue delivery from syncing twice. */
		syncLeaseUntil: integer("sync_lease_until", { mode: "timestamp_ms" }),
		...timestamps(),
	},
	(t) => [
		uniqueIndex("external_accounts_mailbox_unq").on(t.mailboxId),
		index("external_accounts_status_idx").on(t.status, t.lastSyncedAt),
		index("external_accounts_user_idx").on(t.userId),
	],
);

/** Per-folder IMAP cursor. UIDs are meaningful only together with UIDVALIDITY. */
export const externalFolders = sqliteTable(
	"external_folders",
	{
		id: id(),
		accountId: text("account_id")
			.notNull()
			.references(() => externalAccounts.id, { onDelete: "cascade" }),
		remoteName: text("remote_name").notNull(),
		localFolderId: text("local_folder_id").references(() => folders.id, { onDelete: "set null" }),
		uidValidity: integer("uid_validity"),
		lastUid: integer("last_uid").notNull().default(0),
		isInbox: integer("is_inbox", { mode: "boolean" }).notNull().default(false),
		isSent: integer("is_sent", { mode: "boolean" }).notNull().default(false),
		...timestamps(),
	},
	(t) => [
		uniqueIndex("external_folders_account_name_unq").on(t.accountId, t.remoteName),
		index("external_folders_account_idx").on(t.accountId),
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
