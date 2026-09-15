import { and, eq, gt, isNull } from "drizzle-orm";
import type { Database } from "@/db";
import { mobileAccessTokens, mobileDeviceSessions, users } from "@/db/schema";
import type { SessionUser } from "@/shared/contract/auth";
import { sha256Hex } from "./password";
import { sessionUserColumns, toSessionUser } from "./session";

export const MOBILE_ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
export const MOBILE_REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

type DeviceMeta = {
	deviceName: string;
	appVersion?: string | null;
	ip?: string | null;
};

export type MobileTokens = {
	deviceSessionId: string;
	accessToken: string;
	accessTokenExpiresAt: Date;
	refreshToken: string;
	refreshTokenExpiresAt: Date;
};

export type MobileAccessSession = {
	user: SessionUser;
	deviceSessionId: string;
};

/** Creates an Android device login without ever persisting either raw token. */
export async function createMobileSession(db: Database, userId: string, meta: DeviceMeta): Promise<MobileTokens> {
	const now = new Date();
	const refreshToken = randomToken("pm_rt_");
	const accessToken = randomToken("pm_at_");
	const refreshTokenExpiresAt = new Date(now.getTime() + MOBILE_REFRESH_TOKEN_TTL_MS);
	const accessTokenExpiresAt = new Date(now.getTime() + MOBILE_ACCESS_TOKEN_TTL_MS);
	const deviceSessionId = crypto.randomUUID();

	await db.insert(mobileDeviceSessions).values({
		id: deviceSessionId,
		userId,
		refreshTokenHash: await sha256Hex(refreshToken),
		deviceName: meta.deviceName,
		appVersion: meta.appVersion ?? null,
		ip: meta.ip ?? null,
		lastSeenAt: now,
		expiresAt: refreshTokenExpiresAt,
	});
	await db.insert(mobileAccessTokens).values({
		deviceSessionId,
		tokenHash: await sha256Hex(accessToken),
		expiresAt: accessTokenExpiresAt,
	});

	return { deviceSessionId, accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt };
}

/** Resolves a non-expired Android bearer token into the app's normal user identity. */
export async function resolveMobileAccessToken(
	db: Database,
	token: string | undefined,
): Promise<MobileAccessSession | null> {
	if (!token?.startsWith("pm_at_")) return null;

	const row = await db
		.select({ ...sessionUserColumns, deviceSessionId: mobileDeviceSessions.id })
		.from(mobileAccessTokens)
		.innerJoin(mobileDeviceSessions, eq(mobileDeviceSessions.id, mobileAccessTokens.deviceSessionId))
		.innerJoin(users, eq(users.id, mobileDeviceSessions.userId))
		.where(
			and(
				eq(mobileAccessTokens.tokenHash, await sha256Hex(token)),
				gt(mobileAccessTokens.expiresAt, new Date()),
				gt(mobileDeviceSessions.expiresAt, new Date()),
				isNull(mobileDeviceSessions.revokedAt),
			),
		)
		.get();

	const user = toSessionUser(row);
	return user && row ? { user, deviceSessionId: row.deviceSessionId } : null;
}

/**
 * Rotates the one-time refresh credential. A competing refresh loses the
 * compare-and-swap update and must send the user through login again.
 */
export async function rotateMobileRefreshToken(
	db: Database,
	refreshToken: string,
	meta: Partial<DeviceMeta> = {},
): Promise<MobileTokens | null> {
	if (!refreshToken.startsWith("pm_rt_")) return null;

	const now = new Date();
	const previousHash = await sha256Hex(refreshToken);
	const nextRefreshToken = randomToken("pm_rt_");
	const nextAccessToken = randomToken("pm_at_");
	const refreshTokenExpiresAt = new Date(now.getTime() + MOBILE_REFRESH_TOKEN_TTL_MS);
	const accessTokenExpiresAt = new Date(now.getTime() + MOBILE_ACCESS_TOKEN_TTL_MS);
	const session = await db
		.update(mobileDeviceSessions)
		.set({
			refreshTokenHash: await sha256Hex(nextRefreshToken),
			...(meta.deviceName ? { deviceName: meta.deviceName } : {}),
			...(meta.appVersion ? { appVersion: meta.appVersion } : {}),
			...(meta.ip ? { ip: meta.ip } : {}),
			lastSeenAt: now,
			expiresAt: refreshTokenExpiresAt,
		})
		.where(
			and(
				eq(mobileDeviceSessions.refreshTokenHash, previousHash),
				gt(mobileDeviceSessions.expiresAt, now),
				isNull(mobileDeviceSessions.revokedAt),
			),
		)
		.returning({ id: mobileDeviceSessions.id })
		.get();
	if (!session) return null;

	await db.delete(mobileAccessTokens).where(eq(mobileAccessTokens.deviceSessionId, session.id));
	await db.insert(mobileAccessTokens).values({
		deviceSessionId: session.id,
		tokenHash: await sha256Hex(nextAccessToken),
		expiresAt: accessTokenExpiresAt,
	});

	return {
		deviceSessionId: session.id,
		accessToken: nextAccessToken,
		accessTokenExpiresAt,
		refreshToken: nextRefreshToken,
		refreshTokenExpiresAt,
	};
}

export async function destroyMobileSession(db: Database, deviceSessionId: string): Promise<void> {
	await db
		.update(mobileDeviceSessions)
		.set({ revokedAt: new Date() })
		.where(and(eq(mobileDeviceSessions.id, deviceSessionId), isNull(mobileDeviceSessions.revokedAt)));
}

/** Revokes every Android device when a password changes or an admin locks an account. */
export async function destroyAllMobileSessions(db: Database, userId: string): Promise<void> {
	await db
		.update(mobileDeviceSessions)
		.set({ revokedAt: new Date() })
		.where(and(eq(mobileDeviceSessions.userId, userId), isNull(mobileDeviceSessions.revokedAt)));
}

function randomToken(prefix: "pm_at_" | "pm_rt_"): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return `${prefix}${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
}
