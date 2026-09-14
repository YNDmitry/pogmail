import { and, eq, or } from "drizzle-orm";
import { getDb } from "@/db";
import { mailboxAccess, mailboxes, users } from "@/db/schema";

/** Everyone with access to the mailbox gets the event, not just its owner. */
export async function notifyMailbox(env: Env, mailboxId: string, event: RealtimeEvent): Promise<void> {
	try {
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

		await broadcast(env, userIds, event);
		if (event.type.startsWith("message.")) {
			await notifyAdmins(env, { type: "admin.overview" });
		}
	} catch (error) {
		console.error("Realtime mailbox notification failed", error);
	}
}

export function notifyNewMessage(env: Env, mailboxId: string, messageId: string): Promise<void> {
	return notifyMailbox(env, mailboxId, { type: "message.new", mailboxId, messageId });
}

/** Generic push for anything else the UI should refresh live. */
export async function notifyUser(env: Env, userId: string, event: RealtimeEvent): Promise<void> {
	await broadcast(env, new Set([userId]), event);
}

/** Administrative screens are shared by enabled admins, rather than a single owner. */
export async function notifyAdmins(env: Env, event: RealtimeEvent): Promise<void> {
	try {
		const rows = await getDb(env.DB)
			.select({ id: users.id })
			.from(users)
			.where(and(eq(users.role, "admin"), eq(users.disabled, false)))
			.all();
		await broadcast(env, new Set(rows.map((row) => row.id)), event);
	} catch (error) {
		console.error("Realtime admin notification failed", error);
	}
}

/** Domains are managed by admins and users explicitly granted mailbox management. */
export async function notifyMailboxManagers(env: Env, event: RealtimeEvent): Promise<void> {
	try {
		const rows = await getDb(env.DB)
			.select({ id: users.id })
			.from(users)
			.where(
				and(
					eq(users.disabled, false),
					or(eq(users.role, "admin"), eq(users.canManageMailboxes, true)),
				),
			)
			.all();
		await broadcast(env, new Set(rows.map((row) => row.id)), event);
	} catch (error) {
		console.error("Realtime mailbox-manager notification failed", error);
	}
}

async function broadcast(env: Env, userIds: Set<string>, event: RealtimeEvent): Promise<void> {
	const results = await Promise.allSettled(
		[...userIds].map((userId) => env.REALTIME.getByName(userId).broadcast(event)),
	);
	for (const result of results) {
		if (result.status === "rejected") console.error("Realtime broadcast failed", result.reason);
	}
}

export type RealtimeEvent =
	| { type: "message.new"; mailboxId: string; messageId: string }
	| { type: "message.sent"; mailboxId: string; messageId: string }
	| { type: "message.delivery"; mailboxId: string; messageId: string }
	| { type: "message.changed"; mailboxId: string }
	| { type: "message.deleted"; mailboxId: string }
	| { type: "contacts.changed" }
	| { type: "campaigns.changed" }
	| { type: "calendar.changed" }
	| { type: "backups.changed" }
	| { type: "domain.changed"; domainId: string }
	| { type: "admin.overview" };
