import { and, eq, gt } from "drizzle-orm";
import type { Database } from "@/db";
import { sessions, users } from "@/db/schema";
import type { SessionUser } from "@/shared/contract/auth";
import { sha256Hex } from "./password";

export const SESSION_COOKIE = "pb_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Columns that make up a `SessionUser`; kept in one place so every lookup agrees. */
const identity = {
	id: users.id,
	email: users.email,
	name: users.name,
	role: users.role,
	avatarKey: users.avatarKey,
	mailLayout: users.mailLayout,
	telegramChatId: users.telegramChatId,
	canManageMailboxes: users.canManageMailboxes,
	disabled: users.disabled,
} as const;

export async function createSession(
	db: Database,
	userId: string,
	meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
	const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
	const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

	await db.insert(sessions).values({
		userId,
		tokenHash: await sha256Hex(token),
		expiresAt,
		userAgent: meta.userAgent ?? null,
		ip: meta.ip ?? null,
	});

	return { token, expiresAt };
}

/** Null for missing, expired or disabled — never throws, so callers can answer 401. */
export async function resolveSession(db: Database, token: string | undefined): Promise<SessionUser | null> {
	if (!token) return null;

	const row = await db
		.select(identity)
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.where(and(eq(sessions.tokenHash, await sha256Hex(token)), gt(sessions.expiresAt, new Date())))
		.get();

	return toSessionUser(row);
}

export function toSessionUser(
	row: { disabled: boolean } & SessionUser | undefined,
): SessionUser | null {
	if (!row || row.disabled) return null;
	return {
		id: row.id,
		email: row.email,
		name: row.name,
		role: row.role,
		avatarKey: row.avatarKey,
		mailLayout: row.mailLayout,
		telegramChatId: row.telegramChatId,
		canManageMailboxes: row.canManageMailboxes,
	};
}

export { identity as sessionUserColumns };

export async function destroySession(db: Database, token: string | undefined): Promise<void> {
	if (!token) return;
	await db.delete(sessions).where(eq(sessions.tokenHash, await sha256Hex(token)));
}

/** Revokes every session for a user — used on password change and account disable. */
export async function destroyAllSessions(db: Database, userId: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.userId, userId));
}

export function sessionCookie(token: string, expiresAt: Date): string {
	return [
		`${SESSION_COOKIE}=${token}`,
		"Path=/",
		"HttpOnly",
		"Secure",
		"SameSite=Lax",
		`Expires=${expiresAt.toUTCString()}`,
	].join("; ");
}

export const clearedSessionCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/** Cookie reader for raw-`Request` paths that never reach Hono's context. */
export function readSessionCookie(request: Request): string | undefined {
	const header = request.headers.get("cookie");
	if (!header) return undefined;

	for (const part of header.split(";")) {
		const [name, ...rest] = part.trim().split("=");
		if (name === SESSION_COOKIE) return rest.join("=") || undefined;
	}
	return undefined;
}
