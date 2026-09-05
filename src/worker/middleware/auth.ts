import { HTTPException } from "hono/http-exception";
import { getCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { Database } from "@/db";
import { apiKeys, users, type ApiKeyScope } from "@/db/schema";
import type { SessionUser } from "@/shared/contract/auth";
import { sha256Hex } from "../auth/password";
import { resolveSession, sessionUserColumns, SESSION_COOKIE, toSessionUser } from "../auth/session";
import type { AppBindings } from "./context";

/**
 * Both auth surfaces resolve here and fail as 401, never as an unhandled throw.
 * Session cookie first, then `Authorization: Bearer` for the public API.
 */
export const requireAuth: MiddlewareHandler<AppBindings> = async (c, next) => {
	const db = c.get("db");

	const session = await resolveSession(db, getCookie(c, SESSION_COOKIE));
	if (session) {
		c.set("user", session);
		c.set("apiKeyScopes", null);
		await next();
		return;
	}

	const key = await resolveApiKey(db, c.req.header("authorization"));
	if (!key) throw new HTTPException(401, { message: "Not authenticated" });

	c.set("user", key.user);
	c.set("apiKeyScopes", key.scopes);
	await next();
};

export const requireAdmin: MiddlewareHandler<AppBindings> = async (c, next) => {
	if (c.get("user").role !== "admin") throw new HTTPException(403, { message: "Admin only" });
	await next();
};

/** Admin, or a user explicitly granted mailbox and domain management. */
export const requireMailboxManager: MiddlewareHandler<AppBindings> = async (c, next) => {
	const user = c.get("user");
	if (user.role !== "admin" && !user.canManageMailboxes) {
		throw new HTTPException(403, { message: "Mailbox management not permitted" });
	}
	await next();
};

/** Cookie sessions pass every scope check; only API keys are scope-limited. */
export function requireScope(scope: ApiKeyScope): MiddlewareHandler<AppBindings> {
	return async (c, next) => {
		const scopes = c.get("apiKeyScopes");
		if (scopes && !scopes.includes(scope)) {
			throw new HTTPException(403, { message: `API key is missing the ${scope} scope` });
		}
		await next();
	};
}

async function resolveApiKey(
	db: Database,
	header: string | undefined,
): Promise<{ user: SessionUser; scopes: ApiKeyScope[] } | null> {
	const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
	if (!token) return null;

	const row = await db
		.select({ ...sessionUserColumns, keyId: apiKeys.id, scopes: apiKeys.scopes })
		.from(apiKeys)
		.innerJoin(users, eq(users.id, apiKeys.userId))
		.where(
			and(
				eq(apiKeys.tokenHash, await sha256Hex(token)),
				isNull(apiKeys.revokedAt),
				or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date())),
			),
		)
		.get();

	const user = toSessionUser(row);
	if (!row || !user) return null;

	// Fire-and-forget: last-used is telemetry, not worth blocking the request on.
	void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.keyId));

	return { user, scopes: row.scopes };
}
