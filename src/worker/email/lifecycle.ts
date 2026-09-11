import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/db";
import { contacts, domains, emailCampaigns, emailDeliveryEvents, mailboxes, messages, outboundDeliveries, outboundJobs } from "@/db/schema";

export const EMAIL_EVENTS_QUEUE = "pogmail-email-events";

const EVENT_TYPES = [
	"cf.email.sending.message.delivered",
	"cf.email.sending.message.deferred",
	"cf.email.sending.message.bounced",
	"cf.email.sending.message.failed",
	"cf.email.sending.message.rejected",
	"cf.email.sending.message.complained",
] as const;

const EVENT_TYPE_NAMES = {
	"cf.email.sending.message.delivered": "delivered",
	"cf.email.sending.message.deferred": "deferred",
	"cf.email.sending.message.bounced": "bounced",
	"cf.email.sending.message.failed": "failed",
	"cf.email.sending.message.rejected": "rejected",
	"cf.email.sending.message.complained": "complained",
} as const;

const emailSendingEvent = z.object({
	type: z.enum(EVENT_TYPES),
	source: z.object({ type: z.literal("email.sending"), zoneId: z.string().min(1), domain: z.string().min(1) }),
	payload: z.object({
		eventId: z.string().min(1).max(200),
		messageId: z.string().min(1).max(500),
		recipient: z.email(),
		terminal: z.boolean(),
		delivery: z.object({
			status: z.string().min(1).max(80),
			smtpResponse: z.string().max(2_000).optional(),
		}).optional(),
		bounce: z.object({ type: z.enum(["hard", "soft"]), reason: z.string().max(2_000).optional() }).optional(),
		failure: z.object({ reason: z.string().max(2_000).optional() }).optional(),
		rejection: z.object({ detail: z.string().max(2_000).optional(), reason: z.string().max(200).optional() }).optional(),
	}),
	metadata: z.object({ eventTimestamp: z.string().datetime() }),
});

export type EmailSendingLifecycleEvent = z.infer<typeof emailSendingEvent>;

/** Reject malformed external Queue bodies rather than letting an unknown shape reach D1. */
export function parseEmailSendingLifecycleEvent(value: unknown): EmailSendingLifecycleEvent | null {
	return emailSendingEvent.safeParse(value).data ?? null;
}

function eventType(type: EmailSendingLifecycleEvent["type"]) {
	return EVENT_TYPE_NAMES[type];
}

function messageIdVariants(messageId: string): string[] {
	const bare = messageId.trim().replace(/^<|>$/g, "");
	return [...new Set([messageId, bare, `<${bare}>`])];
}

function eventDetail(event: EmailSendingLifecycleEvent): string | null {
	const detail = event.payload.bounce?.reason
		?? event.payload.rejection?.detail
		?? event.payload.failure?.reason
		?? event.payload.delivery?.smtpResponse
		?? null;
	return detail?.slice(0, 500) ?? null;
}

/** A temporary delivery issue must not revoke consent; complaints and hard bounces must. */
function shouldSuppressMarketing(event: EmailSendingLifecycleEvent) {
	return event.type === "cf.email.sending.message.complained"
		|| (event.type === "cf.email.sending.message.bounced" && event.payload.bounce?.type === "hard");
}

/**
 * Records one event only when it belongs to a local recipient delivery. The event
 * id is the primary key, so a Queue replay is a harmless no-op.
 */
export async function recordEmailSendingLifecycleEvent(
	db: Database,
	event: EmailSendingLifecycleEvent,
): Promise<{ result: "recorded" | "duplicate" | "unmatched"; mailboxId?: string; messageId?: string; suppressed?: boolean }> {
	const delivery = await db
		.select({
			id: outboundDeliveries.id,
			mailboxId: messages.mailboxId,
			messageId: messages.id,
			campaignUserId: emailCampaigns.userId,
		})
		.from(outboundDeliveries)
		.innerJoin(outboundJobs, eq(outboundJobs.id, outboundDeliveries.outboundJobId))
		.innerJoin(messages, eq(messages.id, outboundJobs.messageId))
		.innerJoin(mailboxes, eq(mailboxes.id, messages.mailboxId))
		.innerJoin(domains, eq(domains.id, mailboxes.domainId))
		.leftJoin(emailCampaigns, eq(emailCampaigns.id, messages.campaignId))
		.where(
			and(
				inArray(messages.messageId, messageIdVariants(event.payload.messageId)),
				sql`lower(${outboundDeliveries.recipient}) = ${event.payload.recipient.toLowerCase()}`,
				eq(domains.zoneId, event.source.zoneId),
			),
		)
		.get();
	if (!delivery) return { result: "unmatched" };

	const occurredAt = new Date(event.metadata.eventTimestamp);
	const inserted = await db
		.insert(emailDeliveryEvents)
		.values({
			eventId: event.payload.eventId,
			outboundDeliveryId: delivery.id,
			type: eventType(event.type),
			deliveryStatus: event.payload.delivery?.status ?? eventType(event.type),
			bounceType: event.payload.bounce?.type ?? null,
			terminal: event.payload.terminal,
			detail: eventDetail(event),
			occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
		})
		.onConflictDoNothing()
		.returning({ eventId: emailDeliveryEvents.eventId })
		.get();
	if (!inserted) return { result: "duplicate" };
	const suppressed = Boolean(delivery.campaignUserId && shouldSuppressMarketing(event));
	if (suppressed) {
		await db.update(contacts).set({ marketingStatus: "unsubscribed", unsubscribedAt: new Date() }).where(and(
			eq(contacts.userId, delivery.campaignUserId!),
			sql`lower(${contacts.email}) = ${event.payload.recipient.toLowerCase()}`,
		));
	}
	return { result: "recorded", mailboxId: delivery.mailboxId, messageId: delivery.messageId, suppressed };
}
