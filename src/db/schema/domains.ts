import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, timestamps } from "./_shared";
import { users } from "./users";

export const DOMAIN_STATUSES = ["pending", "active", "error"] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

export const domains = sqliteTable(
	"domains",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		hostname: text("hostname").notNull(),
		zoneId: text("zone_id").notNull(),
		status: text("status", { enum: DOMAIN_STATUSES }).notNull().default("pending"),
		/** Verbatim Cloudflare Email Routing status, shown in the UI without translation. */
		routingStatus: text("routing_status"),
		routingEnabled: integer("routing_enabled", { mode: "boolean" }).notNull().default(false),
		/** Random label of the `<tag>.<hostname>` subdomain Cloudflare signs outbound mail with. */
		sendingSubdomainTag: text("sending_subdomain_tag"),
		sendingEnabled: integer("sending_enabled", { mode: "boolean" }).notNull().default(false),
		lastError: text("last_error"),
		verifiedAt: integer("verified_at", { mode: "timestamp_ms" }),
		...timestamps(),
	},
	(t) => [uniqueIndex("domains_hostname_unq").on(t.hostname), index("domains_user_idx").on(t.userId)],
);

/** DNS records we created, so removing a domain cleans up exactly what we added. */
export const domainRecords = sqliteTable(
	"domain_records",
	{
		id: id(),
		domainId: text("domain_id")
			.notNull()
			.references(() => domains.id, { onDelete: "cascade" }),
		cloudflareRecordId: text("cloudflare_record_id").notNull(),
		type: text("type").notNull(),
		name: text("name").notNull(),
		content: text("content").notNull(),
		...timestamps(),
	},
	(t) => [index("domain_records_domain_idx").on(t.domainId)],
);
