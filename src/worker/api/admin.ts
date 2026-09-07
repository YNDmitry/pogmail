import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { domains, mailboxes, messages, users } from "@/db/schema";
import { audit } from "../audit";
import { BUILD_COMMIT, UPSTREAM_REPOSITORY } from "../build";
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
	 * Compares the commit this Worker was built from against upstream's default
	 * branch. GitHub allows 60 unauthenticated calls an hour per address and
	 * Cloudflare's egress is shared, so the call is cached for an hour and every
	 * failure degrades to `upstream: null` — an instance that cannot reach GitHub
	 * still renders its own version.
	 */
	.get("/version", async (c) => {
		const response = await fetch(
			`https://api.github.com/repos/${UPSTREAM_REPOSITORY}/commits/HEAD`,
			{
				headers: { accept: "application/vnd.github+json", "user-agent": "pogmail" },
				cf: { cacheTtl: 3600, cacheEverything: true },
			},
		).catch(() => null);

		const upstream =
			response?.ok === true
				? ((await response.json()) as {
						sha: string;
						html_url: string;
						commit: { message: string; committer: { date: string } };
					})
				: null;

		return c.json({
			repository: UPSTREAM_REPOSITORY,
			commit: BUILD_COMMIT,
			upstream: upstream && {
				commit: upstream.sha,
				url: upstream.html_url,
				// Only the subject line: a merge commit body is pages long.
				subject: upstream.commit.message.split("\n")[0] ?? "",
				committedAt: upstream.commit.committer.date,
			},
			// Null, not false, when either side is unknown: "cannot tell" is not "current".
			behind: BUILD_COMMIT && upstream ? BUILD_COMMIT !== upstream.sha : null,
		});
	})

	/**
	 * Dispatches the update workflow in the user's own installation repository, which
	 * merges upstream and applies migrations. The workflow itself does not deploy —
	 * but where Workers Builds watches that repository, its push does.
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
