import { index, integer, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { createdAt, id, timestamps } from "./_shared";

export const USER_ROLES = ["admin", "user"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * How a folder is read. `conversations` collapses a thread into one row and
 * stacks its messages when opened; `messages` keeps one row per message, which
 * is what an operator watching a mail server usually wants.
 */
export const MAIL_LAYOUTS = ["conversations", "messages"] as const;
export type MailLayout = (typeof MAIL_LAYOUTS)[number];

export const users = sqliteTable(
	"users",
	{
		id: id(),
		email: text("email").notNull(),
		name: text("name").notNull(),
		/** Where password-reset mail goes when the account's own mailbox is unreachable. */
		resetEmail: text("reset_email"),
		/** Account-level forwarding, applied after routing in the `email` handler. */
		forwardingEmail: text("forwarding_email"),
		/** PBKDF2-SHA256 as `iterations:salt_b64:hash_b64`. Workers has no argon2. */
		passwordHash: text("password_hash").notNull(),
		avatarKey: text("avatar_key"),
		mailLayout: text("mail_layout", { enum: MAIL_LAYOUTS }).notNull().default("messages"),
		role: text("role", { enum: USER_ROLES }).notNull().default("user"),
		disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
		/** Grants mailbox and domain management without full admin rights. */
		canManageMailboxes: integer("can_manage_mailboxes", { mode: "boolean" }).notNull().default(false),
		createdByUserId: text("created_by_user_id").references((): AnySQLiteColumn => users.id, {
			onDelete: "set null",
		}),
		...timestamps(),
	},
	(t) => [uniqueIndex("users_email_unq").on(t.email)],
);

export const sessions = sqliteTable(
	"sessions",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		/** SHA-256 of the cookie token. The raw token never touches the database. */
		tokenHash: text("token_hash").notNull(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		userAgent: text("user_agent"),
		ip: text("ip"),
		createdAt: createdAt(),
	},
	(t) => [
		uniqueIndex("sessions_token_unq").on(t.tokenHash),
		index("sessions_user_idx").on(t.userId, t.expiresAt),
	],
);

export const API_KEY_SCOPES = [
	"messages:read",
	"messages:send",
	"mailboxes:read",
	"mailboxes:write",
	"domains:read",
	"domains:write",
	"contacts:read",
	"contacts:write",
	"webhooks:read",
	"webhooks:write",
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const apiKeys = sqliteTable(
	"api_keys",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		/** SHA-256 of the bearer token; the prefix is stored plainly so the UI can show it. */
		tokenHash: text("token_hash").notNull(),
		tokenPrefix: text("token_prefix").notNull(),
		scopes: text("scopes", { mode: "json" }).$type<ApiKeyScope[]>().notNull(),
		lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
		revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
		...timestamps(),
	},
	(t) => [uniqueIndex("api_keys_token_unq").on(t.tokenHash), index("api_keys_user_idx").on(t.userId)],
);

export const auditLogs = sqliteTable(
	"audit_logs",
	{
		id: id(),
		actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
		targetUserId: text("target_user_id").references(() => users.id, { onDelete: "set null" }),
		mailboxId: text("mailbox_id"),
		messageId: text("message_id"),
		/** Dotted verb, e.g. `mailbox.create`, `message.delete`, `domain.verify`. */
		action: text("action").notNull(),
		metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
		ip: text("ip"),
		createdAt: createdAt(),
	},
	(t) => [
		index("audit_logs_actor_idx").on(t.actorUserId, t.createdAt),
		index("audit_logs_action_idx").on(t.action, t.createdAt),
		index("audit_logs_created_idx").on(t.createdAt),
	],
);
