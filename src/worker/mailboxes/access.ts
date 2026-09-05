import { and, eq, inArray, or } from "drizzle-orm";
import type { Database } from "@/db";
import { domains, mailboxAccess, mailboxes, type MailboxPermission } from "@/db/schema";
import type { SessionUser } from "@/shared/contract/auth";

/** Ordered least to most capable; every check compares ranks, never string equality. */
const RANK: Record<MailboxPermission, number> = {
	read_only: 1,
	send_as: 2,
	send_on_behalf: 2,
	full_access: 3,
};

export type MailboxSummary = {
	id: string;
	address: string;
	localPart: string;
	displayName: string | null;
	avatarKey: string | null;
	type: "personal" | "shared";
	disabled: boolean;
	permission: MailboxPermission;
};

/**
 * Authorization is mailbox-scoped, not user-scoped: ownership, the sharing table and
 * the admin role are three independent grants. Message queries filter by the ids this
 * returns — never by `userId`.
 */
export async function listAccessibleMailboxes(db: Database, user: SessionUser): Promise<MailboxSummary[]> {
	const rows = await db
		.select({
			id: mailboxes.id,
			localPart: mailboxes.localPart,
			displayName: mailboxes.displayName,
			avatarKey: mailboxes.avatarKey,
			type: mailboxes.type,
			disabled: mailboxes.disabled,
			ownerId: mailboxes.userId,
			hostname: domains.hostname,
			sharedPermission: mailboxAccess.permission,
		})
		.from(mailboxes)
		.innerJoin(domains, eq(domains.id, mailboxes.domainId))
		.leftJoin(
			mailboxAccess,
			and(eq(mailboxAccess.mailboxId, mailboxes.id), eq(mailboxAccess.userId, user.id)),
		)
		.where(
			user.role === "admin"
				? undefined
				: or(eq(mailboxes.userId, user.id), eq(mailboxAccess.userId, user.id)),
		)
		.all();

	return rows.map((row) => ({
		id: row.id,
		address: `${row.localPart}@${row.hostname}`,
		localPart: row.localPart,
		displayName: row.displayName,
		avatarKey: row.avatarKey,
		type: row.type,
		disabled: row.disabled,
		permission:
			user.role === "admin" || row.ownerId === user.id
				? "full_access"
				: (row.sharedPermission ?? "read_only"),
	}));
}

export async function listAccessibleMailboxIds(db: Database, user: SessionUser): Promise<string[]> {
	return (await listAccessibleMailboxes(db, user)).map((mailbox) => mailbox.id);
}

export async function getPermission(
	db: Database,
	user: SessionUser,
	mailboxId: string,
): Promise<MailboxPermission | null> {
	if (user.role === "admin") return "full_access";

	const row = await db
		.select({ ownerId: mailboxes.userId, shared: mailboxAccess.permission })
		.from(mailboxes)
		.leftJoin(
			mailboxAccess,
			and(eq(mailboxAccess.mailboxId, mailboxes.id), eq(mailboxAccess.userId, user.id)),
		)
		.where(eq(mailboxes.id, mailboxId))
		.get();

	if (!row) return null;
	if (row.ownerId === user.id) return "full_access";
	return row.shared ?? null;
}

export function hasAtLeast(permission: MailboxPermission | null, required: MailboxPermission): boolean {
	return permission !== null && RANK[permission] >= RANK[required];
}

/** True when the user may put this mailbox's address in a From or Sender header. */
export function canSendFrom(permission: MailboxPermission | null): boolean {
	return permission === "send_as" || permission === "send_on_behalf" || permission === "full_access";
}

/** Narrows a caller-supplied mailbox filter to what that caller may actually read. */
export async function resolveMailboxScope(
	db: Database,
	user: SessionUser,
	mailboxId: string | undefined,
): Promise<string[]> {
	if (!mailboxId) return listAccessibleMailboxIds(db, user);
	const permission = await getPermission(db, user, mailboxId);
	return hasAtLeast(permission, "read_only") ? [mailboxId] : [];
}

/** Resolves several ids at once for bulk operations, dropping any the caller cannot touch. */
export async function filterAccessibleMailboxIds(
	db: Database,
	user: SessionUser,
	ids: string[],
): Promise<string[]> {
	if (ids.length === 0) return [];
	if (user.role === "admin") {
		const rows = await db
			.select({ id: mailboxes.id })
			.from(mailboxes)
			.where(inArray(mailboxes.id, ids))
			.all();
		return rows.map((row) => row.id);
	}

	const accessible = new Set(await listAccessibleMailboxIds(db, user));
	return ids.filter((id) => accessible.has(id));
}
