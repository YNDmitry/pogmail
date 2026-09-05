import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { domains, mailboxes, messages, users } from "@/db/schema";
import { audit } from "../audit";
import { requireAdmin } from "../middleware/auth";
import type { AppBindings } from "../middleware/context";
import { parseBody } from "./_util";

/** GitHub Actions workflow that merges upstream and applies D1 migrations. */
const UPDATE_WORKFLOW = "deploy-update.yml";

const updateInput = z.object({
	/** `owner/repo` of the installation, e.g. `you/pogmail`. */
	repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
	ref: z.string().max(120).default("main"),
	token: z.string().min(1),
});

export const adminRoutes = new Hono<AppBindings>()
	.use("*", requireAdmin)

	.get("/overview", async (c) => {
		const [userCount, domainCount, mailboxCount, messageCount, storage] = await Promise.all([
			c.get("db").select({ total: count() }).from(users).get(),
			c.get("db").select({ total: count() }).from(domains).get(),
			c.get("db").select({ total: count() }).from(mailboxes).get(),
			c.get("db").select({ total: count() }).from(messages).get(),
			c.get("db").select({ bytes: sql<number>`COALESCE(SUM(${messages.sizeBytes}), 0)` }).from(messages).get(),
		]);

		const byStatus = await c
			.get("db")
			.select({ status: messages.status, total: count() })
			.from(messages)
			.groupBy(messages.status)
			.all();

		return c.json({
			users: userCount?.total ?? 0,
			domains: domainCount?.total ?? 0,
			mailboxes: mailboxCount?.total ?? 0,
			messages: messageCount?.total ?? 0,
			storageBytes: storage?.bytes ?? 0,
			messagesByStatus: Object.fromEntries(byStatus.map((row) => [row.status, row.total])),
		});
	})

	/**
	 * Dispatches the update workflow in the user's own installation repository. This
	 * merges upstream and applies migrations; it does not build or deploy.
	 */
	.post("/update", async (c) => {
		const input = await parseBody(c, updateInput);

		const response = await fetch(
			`https://api.github.com/repos/${input.repository}/actions/workflows/${UPDATE_WORKFLOW}/dispatches`,
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${input.token}`,
					accept: "application/vnd.github+json",
					"user-agent": "pogmail",
					"content-type": "application/json",
				},
				body: JSON.stringify({ ref: input.ref }),
			},
		);

		if (!response.ok) {
			const body = await response.text();
			throw new HTTPException(502, {
				message: `GitHub rejected the dispatch (${response.status}): ${body.slice(0, 200)}`,
			});
		}

		audit(c, { action: "admin.update_dispatch", metadata: { repository: input.repository } });
		return c.json({ ok: true, workflow: UPDATE_WORKFLOW });
	})

	/** Drops sessions for one user; used when an account looks compromised. */
	.post("/revoke-sessions/:userId", async (c) => {
		const target = await c
			.get("db")
			.select({ id: users.id })
			.from(users)
			.where(eq(users.id, c.req.param("userId")))
			.get();

		if (!target) throw new HTTPException(404, { message: "Account not found" });

		const { destroyAllSessions } = await import("../auth/session");
		await destroyAllSessions(c.get("db"), target.id);

		audit(c, { action: "admin.revoke_sessions", targetUserId: target.id });
		return c.json({ ok: true });
	});
