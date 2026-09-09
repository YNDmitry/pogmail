import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/db";
import { domains, mailboxes, messages, SINGLETON_ID, updateSettings, users } from "@/db/schema";
import { audit } from "../audit";
import { BUILD_COMMIT, BUILD_REPOSITORY, UPSTREAM_REPOSITORY } from "../build";
import { decryptSecret, encryptSecret } from "../auth/secrets";
import { CloudflareClient } from "../cloudflare/client";
import { getSendingMetrics } from "../cloudflare/email-analytics";
import { applyPendingMigrations, pendingMigrations } from "../db/migrate";
import { requireAdmin } from "../middleware/auth";
import type { AppBindings } from "../middleware/context";
import { parseBody } from "./_util";
// The workflow ships inside the Worker: an installation that never received
// `.github/workflows` has to be handed the file, and it must be the one this
// build expects to dispatch.
import updateWorkflowSource from "../../../.github/workflows/deploy-update.yml?raw";

/** GitHub Actions workflow that merges upstream and applies D1 migrations. */
const UPDATE_WORKFLOW = "deploy-update.yml";

/** What a GitHub call needs; assembled from the request and the stored settings. */
type UpdateInput = { repository: string; ref: string; token: string };

const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;

/**
 * Every field is optional: an installation that saved its credentials updates with
 * an empty body, and anything sent here replaces what was saved.
 */
const updateInput = z.object({
	/** `owner/repo` of the installation, e.g. `you/pogmail`. */
	repository: z.string().regex(REPOSITORY).optional(),
	ref: z.string().max(120).optional(),
	token: z.string().min(1).optional(),
	/** Keep the credentials for next time. Off means this run only. */
	remember: z.boolean().default(true),
});

const updateConfigInput = z.object({
	repository: z.string().regex(REPOSITORY).nullable().optional(),
	branch: z.string().max(120).optional(),
	/** Omitted leaves the stored token alone; `null` forgets it. */
	token: z.string().min(1).nullable().optional(),
});


/** One GitHub call, with the operator's token and the headers GitHub insists on. */
function github(input: UpdateInput, path: string, init: RequestInit = {}) {
	return fetch(`https://api.github.com/repos/${input.repository}${path}`, {
		...init,
		headers: {
			authorization: `Bearer ${input.token}`,
			accept: "application/vnd.github+json",
			"user-agent": "pogmail",
			...(init.body ? { "content-type": "application/json" } : {}),
		},
	});
}

function dispatchWorkflow(input: UpdateInput): Promise<Response> {
	return github(input, `/actions/workflows/${UPDATE_WORKFLOW}/dispatches`, {
		method: "POST",
		body: JSON.stringify({ ref: input.ref }),
	});
}

/** GitHub's Contents API takes base64, and `btoa` only reads a binary string. */
function toBase64(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

/**
 * Writes the update workflow into the installation repository.
 *
 * The Deploy to Cloudflare button imports this repository through a GitHub App
 * that cannot push `.github/workflows`, so every installation arrives without the
 * workflow and the update button had nothing to dispatch. The file ships inlined
 * in the Worker, so what lands is exactly what this build expects to run.
 */
async function installWorkflow(input: UpdateInput): Promise<Response> {
	return github(input, `/contents/.github/workflows/${UPDATE_WORKFLOW}`, {
		method: "PUT",
		body: JSON.stringify({
			message: "Add the Pogmail update workflow",
			content: toBase64(updateWorkflowSource),
			branch: input.ref,
		}),
	});
}

/** Upserts the singleton row, so an installation cannot race two of them. */
async function saveUpdateSettings(
	db: Database,
	values: Partial<typeof updateSettings.$inferInsert>,
): Promise<void> {
	await db
		.insert(updateSettings)
		.values({ id: SINGLETON_ID, ...values })
		.onConflictDoUpdate({ target: updateSettings.id, set: { ...values, updatedAt: new Date() } });
}

/**
 * Turns GitHub's undifferentiated 404 into the one sentence that names the cause.
 * A token that cannot see the repository and a workflow that is not there look
 * identical from the dispatch endpoint; two reads tell them apart.
 */
async function explain404(input: UpdateInput): Promise<string> {
	const repository = await github(input, "").catch(() => null);
	if (repository?.ok !== true) {
		return `GitHub cannot see ${input.repository} with this token. Check the name, and that the token grants Actions: write on that repository — a fine-grained token also has to list it under Repository access.`;
	}

	return `GitHub refused to run ${UPDATE_WORKFLOW} on ${input.ref}. Check that the branch exists and that Actions is enabled for ${input.repository}.`;
}

export const adminRoutes = new Hono<AppBindings>()
	.use("*", requireAdmin)

	/** Cloudflare's aggregate delivery telemetry for the last 30 calendar days. */
	.get("/deliverability", async (c) => {
		const now = new Date();
		const end = now.toISOString().slice(0, 10);
		const start = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
		const configured = await c
			.get("db")
			.select({ hostname: domains.hostname, zoneId: domains.zoneId, sendingEnabled: domains.sendingEnabled })
			.from(domains)
			.all();

		if (!c.env.CF_TOKEN) {
			return c.json({ start, end, domains: [], error: "Set CF_TOKEN with Zone / Analytics / Read to view delivery telemetry." });
		}

		const cf = CloudflareClient.fromEnv(c.env);
		const reports = await Promise.all(
			configured
				.filter((domain) => domain.sendingEnabled)
				.map(async (domain) => {
					try {
						return { hostname: domain.hostname, metrics: await getSendingMetrics(cf, domain.zoneId, start, end), error: null };
					} catch (error) {
						return { hostname: domain.hostname, metrics: [], error: error instanceof Error ? error.message : String(error) };
					}
				}),
		);

		return c.json({
			start,
			end,
			domains: reports,
			error: reports.length > 0 && reports.every((report) => report.error) ? "Add Zone / Analytics / Read to CF_TOKEN, then reload this page." : null,
		});
	})

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
	/**
	 * Schema migrations the deployed code carries but the database has not run.
	 *
	 * A deploy ships new SQL along with the code that expects it, and nothing else
	 * runs it: Workers Builds only deploys. So the gap is shown here and closed with
	 * a button, rather than through a Cloudflare API token handed to CI.
	 */
	.get("/migrations", async (c) => {
		const pending = await pendingMigrations(c.env);
		return c.json({ pending: pending.map((migration) => migration.name) });
	})

	.post("/migrations", async (c) => {
		const applied = await applyPendingMigrations(c.env);
		audit(c, { action: "admin.migrations_applied", metadata: { applied } });
		return c.json({ applied });
	})

	/**
	 * What this installation knows about updating itself. The token is never sent
	 * back — only whether one is held, so the form can stop asking for it.
	 */
	.get("/update/config", async (c) => {
		const saved = await c.get("db").select().from(updateSettings).get();

		return c.json({
			repository: saved?.repository ?? BUILD_REPOSITORY,
			branch: saved?.branch ?? "main",
			hasToken: Boolean(saved?.githubToken),
			/** Without `CF_TOKEN` there is no key to encrypt a token under, so none is kept. */
			canRemember: Boolean(c.env.CF_TOKEN),
			/** Where the running build came from, offered when nothing is saved yet. */
			detectedRepository: BUILD_REPOSITORY,
			lastDispatchAt: saved?.lastDispatchAt ?? null,
		});
	})

	.put("/update/config", async (c) => {
		const input = await parseBody(c, updateConfigInput);

		if (input.token && !c.env.CF_TOKEN) {
			throw new HTTPException(409, {
				message:
					"Set the CF_TOKEN secret before storing a GitHub token: it is the key the token is encrypted under.",
			});
		}

		const token =
			input.token === undefined || input.token === null
				? input.token
				: await encryptSecret(c.env, input.token);

		await saveUpdateSettings(c.get("db"), {
			...(input.repository !== undefined ? { repository: input.repository } : {}),
			...(input.branch !== undefined ? { branch: input.branch } : {}),
			...(token !== undefined ? { githubToken: token } : {}),
		});

		audit(c, { action: "admin.update_config", metadata: { repository: input.repository ?? null } });
		return c.json({ ok: true });
	})

	/**
	 * Dispatches the update workflow in the user's own installation repository, which
	 * merges upstream and applies migrations. The workflow itself does not deploy —
	 * but where Workers Builds watches that repository, its push does.
	 *
	 * Credentials come from `update_settings` unless the request carries its own, so
	 * the operator types them once instead of at every update.
	 */
	.post("/update", async (c) => {
		const body = await parseBody(c, updateInput);
		const saved = await c.get("db").select().from(updateSettings).get();

		const repository = body.repository ?? saved?.repository ?? BUILD_REPOSITORY;
		const ref = body.ref ?? saved?.branch ?? "main";

		let token = body.token;
		if (!token && saved?.githubToken) {
			token = (await decryptSecret(c.env, saved.githubToken)) ?? undefined;
			if (!token) {
				throw new HTTPException(409, {
					message:
						"The stored GitHub token could not be decrypted — CF_TOKEN has changed since it was saved. Enter the token again.",
				});
			}
		}

		if (!repository) {
			throw new HTTPException(400, {
				message: "Set the repository this installation was deployed from before updating.",
			});
		}
		if (!token) {
			throw new HTTPException(400, {
				message: "Set a GitHub token with Actions, Contents and Workflows write access before updating.",
			});
		}

		const input: UpdateInput = { repository, ref, token };

		let installed = false;
		let response = await dispatchWorkflow(input);

		// A dispatch for a workflow that is not in the repository is a 404, which is
		// the normal state of a fresh installation: write the file, then try again.
		if (response.status === 404) {
			const workflow = await github(input, `/actions/workflows/${UPDATE_WORKFLOW}`).catch(() => null);

			if (workflow?.status === 404) {
				const write = await installWorkflow(input);
				if (!write.ok) {
					const failure = await write.text();
					throw new HTTPException(502, {
						message: `${UPDATE_WORKFLOW} is missing from ${input.repository} and could not be added (${write.status}): ${failure.slice(0, 160)}. The token needs Contents: write and Workflows: write.`,
					});
				}

				installed = true;
				audit(c, {
					action: "admin.update_workflow_installed",
					metadata: { repository: input.repository },
				});

				// GitHub registers a new workflow asynchronously; the first dispatch
				// after the push is usually too early.
				for (let attempt = 0; attempt < 3 && response.status === 404; attempt++) {
					await new Promise((resolve) => setTimeout(resolve, 2000));
					response = await dispatchWorkflow(input);
				}
			}
		}

		if (!response.ok) {
			if (response.status === 404) {
				throw new HTTPException(502, {
					message: installed
						? `${UPDATE_WORKFLOW} was added to ${input.repository}, but GitHub has not registered it yet. Run it once from the Actions tab, or press Update again in a minute.`
						: await explain404(input),
				});
			}

			const failure = await response.text();
			throw new HTTPException(502, {
				message: `GitHub rejected the dispatch (${response.status}): ${failure.slice(0, 200)}`,
			});
		}

		// Only a dispatch GitHub accepted is worth remembering: storing credentials
		// that just failed would hand the next run the same broken pair. The token is
		// kept only if there is a `CF_TOKEN` to seal it with — never in the clear.
		const remembered = body.remember && Boolean(c.env.CF_TOKEN);
		await saveUpdateSettings(c.get("db"), {
			lastDispatchAt: new Date(),
			...(body.remember ? { repository, branch: ref } : {}),
			...(remembered ? { githubToken: await encryptSecret(c.env, token) } : {}),
		});

		audit(c, { action: "admin.update_dispatch", metadata: { repository: input.repository } });
		return c.json({ ok: true, workflow: UPDATE_WORKFLOW, installed, remembered });
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
