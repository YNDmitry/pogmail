import { and, eq, isNotNull, lte } from "drizzle-orm";
import { getDb } from "@/db";
import {
  backupSettings,
  backups,
  mailboxes,
  messages,
  users,
} from "@/db/schema";
import { api } from "./api";
import { readSessionCookie, resolveSession } from "./auth/session";
import { processInboundMessage } from "./email/inbound";

import {
  EMAIL_EVENTS_QUEUE,
  parseEmailSendingLifecycleEvent,
  recordEmailSendingLifecycleEvent,
} from "./email/lifecycle";
import { resolveIncomingMail } from "./email/routing";
import { processOutboundJob } from "./email/send";
import {
  isInbound,
  isOutbound,
  isWebhookRetry,
  type InboundQueueMessage,
  type QueuePayload,
} from "./email/types";
import { runDelivery } from "./email/webhooks";
import { putRawMessage } from "./storage";
import { queueRetryDelay } from "./queue/retry";
import { notifyMailbox } from "./realtime/notify";

export { RealtimeHub } from "./realtime/hub";
export { DatabaseBackupWorkflow } from "./backups/workflow";
export { DatabaseRestoreWorkflow } from "./backups/restore-workflow";

/** Set on forwarded mail so a forward loop terminates instead of amplifying. */
const FORWARDED_HEADER = "x-pogmail-forwarded";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    // The WebSocket upgrade cannot go through Hono: it must reach the Durable
    // Object as a raw request, and only after the cookie is verified.
    if (url.pathname === "/api/realtime") {
      const user = await resolveSession(
        getDb(env.DB),
        readSessionCookie(request),
      );
      if (!user) return new Response("Unauthorized", { status: 401 });
      return env.REALTIME.getByName(user.id).fetch(request);
    }

    return api.fetch(request, env, ctx);
  },

  /**
   * Cloudflare Email Routing entrypoint. Routing decisions happen here because
   * `setReject` and `forward` exist only on this message object — everything
   * expensive is handed to the queue instead.
   */
  async email(message, env): Promise<void> {
    const db = getDb(env.DB);

    const decision = await resolveIncomingMail(db, {
      to: message.to.toLowerCase(),
      from: message.from.toLowerCase(),
      subject: message.headers.get("subject"),
      headers: message.headers,
    });

    if (decision.action === "reject") {
      message.setReject(decision.reason);
      return;
    }

    if (decision.action === "drop") {
      message.setReject("Address does not exist");
      return;
    }

    const alreadyForwarded = message.headers.get(FORWARDED_HEADER) !== null;

    if (decision.action === "forward") {
      if (alreadyForwarded) return;
      await message.forward(
        decision.to,
        new Headers({ [FORWARDED_HEADER]: "1" }),
      );
      return;
    }

    // Store the untouched MIME first: the queue job must be replayable.
    const rawKey = `raw/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.eml`;
    await putRawMessage(env, rawKey, message.raw, message.rawSize);

    const job: InboundQueueMessage = {
      kind: "inbound",
      mailboxId: decision.mailboxId,
      rawKey,
      to: message.to.toLowerCase(),
      from: message.from.toLowerCase(),
      sizeBytes: message.rawSize,
      receivedAt: Date.now(),
    };
    await env.INBOUND_QUEUE.send(job);

    // Account-level forwarding runs after delivery, so the copy in the mailbox is
    // kept either way. Guarded by the same header, or two accounts forwarding to
    // each other would bounce mail back and forth indefinitely.
    if (alreadyForwarded) return;

    const owner = await db
      .select({ forwardingEmail: users.forwardingEmail })
      .from(mailboxes)
      .innerJoin(users, eq(users.id, mailboxes.userId))
      .where(eq(mailboxes.id, decision.mailboxId))
      .get();

    if (owner?.forwardingEmail) {
      await message
        .forward(
          owner.forwardingEmail,
          new Headers({ [FORWARDED_HEADER]: "1" }),
        )
        .catch((error: unknown) =>
          console.error("account forward failed", error),
        );
    }
  },

  /**
   * The app queues carry a `kind` discriminant; Email Sending's subscription has
   * Cloudflare's own schema and arrives through its dedicated queue.
   */
  async queue(batch, env): Promise<void> {
    if (batch.queue === EMAIL_EVENTS_QUEUE) {
      const db = getDb(env.DB);
      for (const item of batch.messages) {
        const event = parseEmailSendingLifecycleEvent(item.body);
        if (!event) {
          // A malformed external event will not become valid by retrying it.
          console.error(JSON.stringify({ message: "Ignoring invalid Email Sending lifecycle event", queueMessageId: item.id }));
          item.ack();
          continue;
        }
        try {
          const result = await recordEmailSendingLifecycleEvent(db, event);
          if (result.result === "unmatched") {
            // A subscription can also observe mail sent outside Pogmail. Do not
            // store its recipient data, but acknowledge it so it does not retry.
            console.log(JSON.stringify({ message: "Ignoring unmatched Email Sending lifecycle event", eventId: event.payload.eventId, type: event.type }));
          } else if (result.result === "recorded" && result.mailboxId && result.messageId) {
            // A notification failure must not cause the already-durable event to
            // retry indefinitely; the page will refresh normally on its next use.
            await notifyMailbox(env, result.mailboxId, {
              type: "message.delivery",
              mailboxId: result.mailboxId,
              messageId: result.messageId,
            }).catch((error: unknown) =>
              console.error(JSON.stringify({ message: "Lifecycle event notification failed", eventId: event.payload.eventId, error: error instanceof Error ? error.message : String(error) })),
            );
          }
          item.ack();
        } catch (error) {
          console.error(JSON.stringify({ message: "Email Sending lifecycle event failed", eventId: event.payload.eventId, error: error instanceof Error ? error.message : String(error) }));
          item.retry({ delaySeconds: queueRetryDelay(item.attempts) });
        }
      }
      return;
    }

    for (const item of batch.messages) {
      const payload = item.body as QueuePayload;
      try {
        if (isInbound(payload)) await processInboundMessage(env, payload);
        else if (isWebhookRetry(payload))
          await runDelivery(env, payload.deliveryId, payload.attempt);
        else if (isOutbound(payload)) await processOutboundJob(env, payload);
        item.ack();
      } catch (error) {
        console.error("Queue job failed", payload, error);
        item.retry({ delaySeconds: queueRetryDelay(item.attempts) });
      }
    }
  },

  /** Nightly: wake snoozed messages, then start a backup if one is due. */
  async scheduled(_controller, env): Promise<void> {
    const db = getDb(env.DB);

    await db
      .update(messages)
      .set({ snoozedUntil: null, status: "received", read: false })
      .where(
        and(
          isNotNull(messages.snoozedUntil),
          lte(messages.snoozedUntil, new Date()),
        ),
      );

    const settings = await db.select().from(backupSettings).get();
    if (!settings?.enabled || !isBackupDue(settings)) return;

    const row = await db
      .insert(backups)
      .values({ trigger: "scheduled" })
      .returning({ id: backups.id })
      .get();

    await env.BACKUP_WORKFLOW.create({
      id: row.id,
      params: { backupId: row.id },
    });
    await db
      .update(backupSettings)
      .set({ lastRunAt: new Date() })
      .where(eq(backupSettings.id, settings.id));
  },
} satisfies ExportedHandler<Env>;

/**
 * The cron fires nightly regardless of schedule; this decides whether today counts.
 * `scheduleValue` is a weekday for `weekly` and a day of month for `monthly`.
 */
function isBackupDue(settings: typeof backupSettings.$inferSelect): boolean {
  const now = new Date();

  if (
    settings.scheduleType === "weekly" &&
    now.getUTCDay() !== (settings.scheduleValue ?? 0)
  )
    return false;
  if (
    settings.scheduleType === "monthly" &&
    now.getUTCDate() !== (settings.scheduleValue ?? 1)
  )
    return false;

  // Guards against a double run if the cron fires twice in one day.
  const last = settings.lastRunAt;
  return !last || now.getTime() - last.getTime() > 20 * 60 * 60 * 1000;
}
