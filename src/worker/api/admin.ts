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
// The workflow ships inside the Worker: an installation that never received
// `.github/workflows` has to be handed the file, and it must be the one this
// build expects to dispatch.
import updateWorkflowSource from "../../../.github/workflows/deploy-update.yml?raw";

/** GitHub Actions workflow that merges upstream and applies D1 migrations. */
const UPDATE_WORKFLOW = "deploy-update.yml";

type UpdateInput = z.infer<typeof updateInput>;

const updateInput = z.object({
	/** `owner/repo` of the installation, e.g. `you/pogmail`. */
	repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
	ref: z.string().max(120).default("main"),
	token: z.string().min(1),
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

		let installed = false;
		let response = await dispatchWorkflow(input);

		// A dispatch for a workflow that is not in the repository is a 404, which is
		// the normal state of a fresh installation: write the file, then try again.
		if (response.status === 404) {
			const workflow = await github(input, `/actions/workflows/${UPDATE_WORKFLOW}`).catch(() => null);

			if (workflow?.status === 404) {
				const write = await installWorkflow(input);
				if (!write.ok) {
					const body = await write.text();
					throw new HTTPException(502, {
						message: `${UPDATE_WORKFLOW} is missing from ${input.repository} and could not be added (${write.status}): ${body.slice(0, 160)}. The token needs Contents: write and Workflows: write.`,
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

			const body = await response.text();
			throw new HTTPException(502, {
				message: `GitHub rejected the dispatch (${response.status}): ${body.slice(0, 200)}`,
			});
		}

		audit(c, { action: "admin.update_dispatch", metadata: { repository: input.repository } });
		return c.json({ ok: true, workflow: UPDATE_WORKFLOW, installed });
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
