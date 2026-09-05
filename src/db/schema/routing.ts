import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { id, timestamps } from "./_shared";
import { domains } from "./domains";
import { mailboxes } from "./mailboxes";

/**
 * Two genuinely different mechanisms share this table, split by `scope`:
 *
 * - `domain` rules run *while resolving the recipient address*, inside the Worker's
 *   `email` handler, because `message.setReject()` and `message.forward()` only exist
 *   there. Evaluated in phases (reject, then exact mailbox/alias, then catch-all) so a
 *   `*` catch-all cannot shadow a real mailbox.
 * - `mailbox` rules run *after* delivery to pick a folder or divert to spam/trash.
 *
 * Every query filters on `scope`; a rule that omits it belongs to neither engine.
 */
export const RULE_SCOPES = ["domain", "mailbox"] as const;
export type RuleScope = (typeof RULE_SCOPES)[number];

export const RULE_ACTIONS = ["deliver", "reject", "forward", "store", "move", "spam", "trash"] as const;
export type RuleAction = (typeof RULE_ACTIONS)[number];

export const MATCH_FIELDS = ["to", "from", "subject", "any_header"] as const;
export const MATCH_OPERATORS = ["equals", "contains", "starts_with", "ends_with", "regex"] as const;

export type RuleCondition = {
	field: (typeof MATCH_FIELDS)[number];
	operator: (typeof MATCH_OPERATORS)[number];
	value: string;
	/** Only meaningful when `field` is `any_header`. */
	header?: string;
};

export const routingRules = sqliteTable(
	"routing_rules",
	{
		id: id(),
		scope: text("scope", { enum: RULE_SCOPES }).notNull(),
		/** Set for `domain` scope. */
		domainId: text("domain_id").references(() => domains.id, { onDelete: "cascade" }),
		/** Set for `mailbox` scope. */
		mailboxId: text("mailbox_id").references(() => mailboxes.id, { onDelete: "cascade" }),

		name: text("name").notNull(),
		enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
		/** Higher runs first; ties break oldest-first so rule order is stable. */
		priority: integer("priority").notNull().default(0),

		conditions: text("conditions", { mode: "json" }).$type<RuleCondition[]>().notNull(),
		/** All conditions must match when true, any when false. */
		matchAll: integer("match_all", { mode: "boolean" }).notNull().default(true),

		action: text("action", { enum: RULE_ACTIONS }).notNull(),
		/** Forward target, destination mailbox, or folder id, depending on `action`. */
		actionTarget: text("action_target"),
		/** Message shown to the sender for `reject`. */
		rejectReason: text("reject_reason"),
		/** Later rules are skipped once this one matches. */
		stopProcessing: integer("stop_processing", { mode: "boolean" }).notNull().default(false),

		matchCount: integer("match_count").notNull().default(0),
		lastMatchedAt: integer("last_matched_at", { mode: "timestamp_ms" }),
		...timestamps(),
	},
	(t) => [
		index("routing_rules_domain_idx").on(t.scope, t.domainId, t.enabled, t.priority),
		index("routing_rules_mailbox_idx").on(t.scope, t.mailboxId, t.enabled, t.priority),
	],
);
