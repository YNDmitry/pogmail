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
		/** Telegram chat that receives this user's new-mail notifications. */
		telegramChatId: text("telegram_chat_id"),
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

/**
 * A long-lived, per-device mobile login. Refresh tokens are SHA-256 hashes, so
 * a D1 export cannot be replayed as an Android session.
 */
export const mobileDeviceSessions = sqliteTable(
	"mobile_device_sessions",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		refreshTokenHash: text("refresh_token_hash").notNull(),
		deviceName: text("device_name").notNull(),
		platform: text("platform").notNull().default("android"),
		appVersion: text("app_version"),
		ip: text("ip"),
		lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
		...timestamps(),
	},
	(t) => [
		uniqueIndex("mobile_device_sessions_refresh_unq").on(t.refreshTokenHash),
		index("mobile_device_sessions_user_idx").on(t.userId, t.expiresAt),
	],
);

/** Short-lived bearer credentials issued to one mobile device session. */
export const mobileAccessTokens = sqliteTable(
	"mobile_access_tokens",
	{
		id: id(),
		deviceSessionId: text("device_session_id")
			.notNull()
			.references(() => mobileDeviceSessions.id, { onDelete: "cascade" }),
		tokenHash: text("token_hash").notNull(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		createdAt: createdAt(),
	},
	(t) => [
		uniqueIndex("mobile_access_tokens_token_unq").on(t.tokenHash),
		index("mobile_access_tokens_session_idx").on(t.deviceSessionId, t.expiresAt),
	],
);

/** Ordered, mailbox-scoped changes consumed by offline mobile clients. */
export const MOBILE_SYNC_RESOURCE_TYPES = ["mailbox", "folder", "message"] as const;
export type MobileSyncResourceType = (typeof MOBILE_SYNC_RESOURCE_TYPES)[number];
export const MOBILE_SYNC_OPERATIONS = ["upsert", "delete"] as const;
export type MobileSyncOperation = (typeof MOBILE_SYNC_OPERATIONS)[number];

export const mobileSyncEvents = sqliteTable(
	"mobile_sync_events",
	{
		sequence: integer("sequence").primaryKey({ autoIncrement: true }),
		/** Kept after a mailbox is deleted so active clients can remove local data. */
		mailboxId: text("mailbox_id").notNull(),
		resourceType: text("resource_type", { enum: MOBILE_SYNC_RESOURCE_TYPES }).notNull(),
		resourceId: text("resource_id").notNull(),
		operation: text("operation", { enum: MOBILE_SYNC_OPERATIONS }).notNull(),
		createdAt: createdAt(),
	},
	(t) => [index("mobile_sync_events_mailbox_sequence_idx").on(t.mailboxId, t.sequence)],
);

/** A discoverable WebAuthn credential. Public keys are safe to retain in D1. */
export const passkeys = sqliteTable(
	"passkeys",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		/** base64url credential ID returned by the authenticator. */
		credentialId: text("credential_id").notNull(),
		/** base64url uncompressed P-256 public key (04 || x || y). */
		publicKey: text("public_key").notNull(),
		signCount: integer("sign_count").notNull().default(0),
		name: text("name").notNull().default("Passkey"),
		lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
		...timestamps(),
	},
	(t) => [
		uniqueIndex("passkeys_credential_unq").on(t.credentialId),
		index("passkeys_user_idx").on(t.userId),
	],
);

/** Short-lived, single-use WebAuthn ceremonies. Keeping these server-side prevents replay. */
export const passkeyChallenges = sqliteTable(
	"passkey_challenges",
	{
		id: id(),
		userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
		challenge: text("challenge").notNull(),
		purpose: text("purpose", { enum: ["registration", "authentication"] }).notNull(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		createdAt: createdAt(),
	},
	(t) => [index("passkey_challenges_expires_idx").on(t.expiresAt), index("passkey_challenges_user_idx").on(t.userId)],
);

/** One-time codes let a person recover access when every passkey is unavailable. */
export const recoveryCodes = sqliteTable(
	"recovery_codes",
	{
		id: id(),
		userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
		codeHash: text("code_hash").notNull(),
		usedAt: integer("used_at", { mode: "timestamp_ms" }),
		createdAt: createdAt(),
	},
	(t) => [uniqueIndex("recovery_codes_hash_unq").on(t.codeHash), index("recovery_codes_user_idx").on(t.userId)],
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
