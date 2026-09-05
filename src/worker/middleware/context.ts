import type { MiddlewareHandler } from "hono";
import { getDb, type Database } from "@/db";
import type { ApiKeyScope } from "@/db/schema";
import type { SessionUser } from "@/shared/contract/auth";

export type AppBindings = {
	Bindings: Env;
	Variables: {
		db: Database;
		/** Set only below `requireAuth`; routes there can read it unconditionally. */
		user: SessionUser;
		/** Null for cookie sessions, which carry every scope the user's role allows. */
		apiKeyScopes: ApiKeyScope[] | null;
	};
};

export const withDb: MiddlewareHandler<AppBindings> = async (c, next) => {
	c.set("db", getDb(c.env.DB));
	await next();
};
