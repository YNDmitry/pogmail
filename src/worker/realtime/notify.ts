import { eq, or } from "drizzle-orm";
import { getDb } from "@/db";
import { mailboxAccess, mailboxes } from "@/db/schema";

/** Everyone with access to the mailbox gets the event, not just its owner. */
export async function notifyMailbox(env: Env, mailboxId: string, event: RealtimeEvent): Promise<void> {
	const db = getDb(env.DB);

	const rows = await db
		.select({ ownerId: mailboxes.userId, sharedWith: mailboxAccess.userId })
		.from(mailboxes)
		.leftJoin(mailboxAccess, eq(mailboxAccess.mailboxId, mailboxes.id))
		.where(or(eq(mailboxes.id, mailboxId), eq(mailboxAccess.mailboxId, mailboxId)))
		.all();

	const userIds = new Set<string>();
	for (const row of rows) {
		userIds.add(row.ownerId);
		if (row.sharedWith) userIds.add(row.sharedWith);
	}

	await Promise.all(
		[...userIds].map((userId) =>
			env.REALTIME.getByName(userId).broadcast(event),
		),
	);
}

export function notifyNewMessage(env: Env, mailboxId: string, messageId: string): Promise<void> {
	return notifyMailbox(env, mailboxId, { type: "message.new", mailboxId, messageId });
}

/** Generic push for anything else the UI should refresh live. */
export async function notifyUser(env: Env, userId: string, event: RealtimeEvent): Promise<void> {
	await env.REALTIME.getByName(userId).broadcast(event);
}

export type RealtimeEvent =
	| { type: "message.new"; mailboxId: string; messageId: string }
	| { type: "message.sent"; mailboxId: string; messageId: string }
	| { type: "message.delivery"; mailboxId: string; messageId: string }
	| { type: "domain.status"; domainId: string; status: string };
