import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt, id, timestamps } from "./_shared";
import { users } from "./users";

/**
 * Single-row tables. Both are keyed by the literal id `singleton` so an upsert can
 * never race two rows into existence.
 */
export const SINGLETON_ID = "singleton";

export const appSettings = sqliteTable("app_settings", {
	id: id(),
	appName: text("app_name").notNull().default("Pogmail"),
	/** R2 key of the uploaded icon; also drives the favicon. */
	iconKey: text("icon_key"),
	accentColor: text("accent_color"),
	/** Public sign-up. Off by default: an open mail host is an open relay for spam. */
	allowRegistration: integer("allow_registration", { mode: "boolean" }).notNull().default(false),
	...timestamps(),
});

export const BACKUP_SCHEDULES = ["daily", "weekly", "monthly"] as const;
export type BackupSchedule = (typeof BACKUP_SCHEDULES)[number];

export const backupSettings = sqliteTable("backup_settings", {
	id: id(),
	enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
	scheduleType: text("schedule_type", { enum: BACKUP_SCHEDULES }).notNull().default("daily"),
	/** Weekday (0-6) for `weekly`, day of month (1-28) for `monthly`, unused for `daily`. */
	scheduleValue: integer("schedule_value"),
	retentionEnabled: integer("retention_enabled", { mode: "boolean" }).notNull().default(false),
	retentionDays: integer("retention_days").notNull().default(30),
	lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
	...timestamps(),
});

export const BACKUP_STATUSES = ["queued", "running", "completed", "failed"] as const;
export type BackupStatus = (typeof BACKUP_STATUSES)[number];

export const BACKUP_TRIGGERS = ["manual", "scheduled"] as const;
export type BackupTrigger = (typeof BACKUP_TRIGGERS)[number];

export const backups = sqliteTable(
	"backups",
	{
		id: id(),
		status: text("status", { enum: BACKUP_STATUSES }).notNull().default("queued"),
		trigger: text("trigger", { enum: BACKUP_TRIGGERS }).notNull(),
		r2Key: text("r2_key"),
		filename: text("filename"),
		sizeBytes: integer("size_bytes"),
		/** Row counts per table, so a restore can be sanity-checked before it runs. */
		tableCounts: text("table_counts", { mode: "json" }).$type<Record<string, number>>(),
		error: text("error"),
		createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
		startedAt: integer("started_at", { mode: "timestamp_ms" }),
		completedAt: integer("completed_at", { mode: "timestamp_ms" }),
		createdAt: createdAt(),
	},
	(t) => [index("backups_created_idx").on(t.createdAt), index("backups_status_idx").on(t.status)],
);
