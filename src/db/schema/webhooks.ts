import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { id, timestamps } from "./_shared";
import { mailboxes } from "./mailboxes";

export const WEBHOOK_EVENTS = [
  "message.received",
  "message.sent",
  "message.bounced",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const webhooks = sqliteTable(
  "webhooks",
  {
    id: id(),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    events: text("events", { mode: "json" }).$type<WebhookEvent[]>().notNull(),
    /** HMAC-SHA256 signing secret for the `X-Pogmail-Signature` header. */
    secret: text("secret").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    /** Disabled automatically after this many consecutive failures. */
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    ...timestamps(),
  },
  (t) => [index("webhooks_mailbox_idx").on(t.mailboxId, t.enabled)],
);

export const DELIVERY_STATUSES = [
  "pending",
  "delivered",
  "failed",
  "exhausted",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/**
 * One row per webhook attempt. Retries ride the outbound queue with a `delaySeconds`
 * backoff rather than adding a third queue binding.
 */
export const webhookDeliveries = sqliteTable(
  "webhook_deliveries",
  {
    id: id(),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    event: text("event", { enum: WEBHOOK_EVENTS }).notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    status: text("status", { enum: DELIVERY_STATUSES })
      .notNull()
      .default("pending"),
    attempt: integer("attempt").notNull().default(0),
    responseStatus: integer("response_status"),
    /** Truncated; we never store a full response body. */
    errorSnippet: text("error_snippet"),
    durationMs: integer("duration_ms"),
    nextRetryAt: integer("next_retry_at", { mode: "timestamp_ms" }),
    ...timestamps(),
  },
  (t) => [
    index("webhook_deliveries_webhook_idx").on(t.webhookId, t.createdAt),
    index("webhook_deliveries_retry_idx").on(t.status, t.nextRetryAt),
  ],
);
