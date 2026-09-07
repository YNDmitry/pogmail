import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/client/components/app/button";
import { Modal } from "@/client/components/app/modal";
import { Card, Field, Tag } from "@/client/components/app/primitives";
import { Input, Skeleton } from "@/client/components/ui";
import { useToast } from "@/client/components/app/toast-host";
import { Mark } from "@/client/components/app/mark";
import { AnimatedNumber } from "@/client/components/motion/animated-number";
import { useInstanceIdentity } from "@/client/lib/identity-context";
import { api } from "@/client/lib/api";
import { useBranding } from "@/client/lib/queries";
import { bytes, fullDate } from "@/client/lib/format";
import { qk } from "@/client/lib/queries/keys";

export const Route = createFileRoute("/_app/admin/overview")({ component: Overview });

type OverviewData = {
	users: number;
	domains: number;
	mailboxes: number;
	messages: number;
	storageBytes: number;
	messagesByStatus: Record<string, number>;
};

type UpdateConfig = {
	repository: string | null;
	branch: string;
	hasToken: boolean;
	/** False when `CF_TOKEN` is unset: a token can be used, but not stored. */
	canRemember: boolean;
	detectedRepository: string | null;
	lastDispatchAt: string | null;
};

type VersionData = {
	repository: string;
	commit: string | null;
	upstream: { commit: string; url: string; subject: string; committedAt: string } | null;
	behind: boolean | null;
};

const STATUS_ORDER = ["received", "sent", "draft", "archived", "spam", "trash"];

/** A commit is read as an identifier, not memorised: seven characters is how git prints it. */
function short(commit: string | null | undefined): string | null {
	return commit ? commit.slice(0, 7) : null;
}

/**
 * The instance record. Deliberately not four identical stat tiles: the numbers
 * are read against each other, so they are set as one aligned column, and where
 * mail sits is a single proportional bar rather than six boxes that hide the
 * proportion they exist to show.
 */
function Overview() {
	const identity = useInstanceIdentity();
	const branding = useBranding();

	const overview = useQuery({
		queryKey: qk.adminOverview,
		queryFn: () => api.get<OverviewData>("/api/admin/overview"),
	});

	const data = overview.data;

	const byStatus = STATUS_ORDER.map((status) => ({
		status,
		total: data?.messagesByStatus[status] ?? 0,
	})).filter((entry) => entry.total > 0);

	const totalFiled = byStatus.reduce((sum, entry) => sum + entry.total, 0);

	return (
		<div className="space-y-8">
			<header className="flex items-center gap-3.5">
				<Mark identity={identity} className="size-10" animate />
				<div className="min-w-0">
					<h1 className="display text-[1.375rem] text-ink">
						{branding.data?.appName ?? "Pogmail"}
					</h1>
					<p className="machine text-xs text-ink-3">
						{identity.seed} · {location.host}
					</p>
				</div>
			</header>

			<Card className="p-6">
				<h2 className="display text-[0.9375rem] text-ink">Scale</h2>

				<dl className="mt-5 divide-y divide-seam">
					{[
						{ label: "Accounts", value: data?.users ?? 0 },
						{ label: "Domains", value: data?.domains ?? 0 },
						{ label: "Mailboxes", value: data?.mailboxes ?? 0 },
						{ label: "Messages", value: data?.messages ?? 0 },
					].map((stat) => (
						<div key={stat.label} className="flex items-baseline justify-between gap-6 py-3">
							<dt className="text-sm text-ink-2">{stat.label}</dt>
							<dd className="machine text-[1.0625rem] text-ink">
								<AnimatedNumber value={stat.value} />
							</dd>
						</div>
					))}
				</dl>
			</Card>

			<Card className="p-6">
				<h2 className="display text-[0.9375rem] text-ink">Where mail sits</h2>

				{totalFiled > 0 ? (
					<>
						<div
							className="mt-5 flex h-2.5 gap-0.5 overflow-hidden rounded-full"
							role="img"
							aria-label={byStatus
								.map((entry) => `${entry.status}: ${entry.total}`)
								.join(", ")}
						>
							{byStatus.map((entry, index) => (
								<span
									key={entry.status}
									className="h-full first:rounded-l-full last:rounded-r-full"
									style={{
										flexGrow: entry.total,
										// Graduated brand coral: these are storage locations, not delivery
										// outcomes, so they stay out of the signal channel.
										backgroundColor: `color-mix(in oklab, var(--pogpin-brand-500) ${Math.round(
											95 - index * 15,
										)}%, var(--pogpin-shell-panel-alt))`,
									}}
								/>
							))}
						</div>

						<dl className="mt-5 grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
							{byStatus.map((entry, index) => (
								<div key={entry.status} className="flex items-baseline gap-2.5">
									<span
										aria-hidden
										className="size-2 shrink-0 translate-y-[-1px] rounded-full"
										style={{
											backgroundColor: `color-mix(in oklab, var(--pogpin-brand-500) ${Math.round(
												95 - index * 15,
											)}%, var(--pogpin-shell-panel-alt))`,
										}}
									/>
									<dt className="flex-1 text-sm text-ink-2 capitalize">{entry.status}</dt>
									<dd className="machine text-sm text-ink">{entry.total}</dd>
								</div>
							))}
						</dl>
					</>
				) : (
					<p className="mt-3 text-sm text-ink-3">No mail stored yet.</p>
				)}
			</Card>

			<Card className="p-6">
				<h2 className="display text-[0.9375rem] text-ink">Storage</h2>
				<p className="mt-1.5 max-w-[68ch] text-sm text-ink-2">
					Raw MIME and attachments live in R2; this is the size of the mail itself.
				</p>
				<p className="machine mt-4 text-[1.375rem] text-ink">{bytes(data?.storageBytes ?? 0)}</p>
			</Card>

			<Version />
		</div>
	);
}

/**
 * Whether this installation is behind the repository it was deployed from.
 *
 * The Deploy button copies this repository into the operator's own account, so
 * upstream commits never arrive on their own; the check exists to say so out
 * loud rather than leave an instance quietly a year old. Applying the update is
 * still a decision — the workflow merges upstream, and on an installation wired
 * to Workers Builds that merge is also a deploy.
 *
 * Credentials are asked for once and kept by the Worker, so the usual update is
 * one button; the form comes back only to change them.
 */
function Version() {
	const toast = useToast();
	const client = useQueryClient();
	const [editing, setEditing] = useState(false);
	const [running, setRunning] = useState(false);

	const version = useQuery({
		queryKey: qk.adminVersion,
		queryFn: () => api.get<VersionData>("/api/admin/version"),
		// The Worker caches the GitHub call for an hour; nothing here changes faster.
		staleTime: 60 * 60 * 1000,
	});

	const config = useQuery({
		queryKey: qk.adminUpdateConfig,
		queryFn: () => api.get<UpdateConfig>("/api/admin/update/config"),
	});

	const migrations = useQuery({
		queryKey: qk.adminMigrations,
		queryFn: () => api.get<{ pending: string[] }>("/api/admin/migrations"),
	});

	const data = version.data;
	const settings = config.data;
	const pending = migrations.data?.pending ?? [];
	const behind = data?.behind === true;
	const ready = Boolean(settings?.hasToken && settings.repository);

	async function dispatch(body: Record<string, unknown>) {
		setRunning(true);
		try {
			const result = await api.post<{ installed: boolean; remembered: boolean }>(
				"/api/admin/update",
				body,
			);
			toast.ok(
				"Update started",
				result.installed
					? "The workflow was missing and has been added to your repository. Watch it under Actions."
					: !result.remembered && settings?.canRemember === false
						? "Watch it under Actions. The token was not kept: set the CF_TOKEN secret to store it encrypted."
						: "Watch it under Actions in your repository.",
			);
			setEditing(false);
			await client.invalidateQueries({ queryKey: qk.adminUpdateConfig });
		} catch (error) {
			toast.fail("Could not start the update", String(error));
		} finally {
			setRunning(false);
		}
	}

	async function migrate() {
		setRunning(true);
		try {
			const result = await api.post<{ applied: string[] }>("/api/admin/migrations", {});
			toast.ok(
				`Applied ${result.applied.length} migration${result.applied.length === 1 ? "" : "s"}`,
				result.applied.join(", "),
			);
			await client.invalidateQueries({ queryKey: qk.adminMigrations });
		} catch (error) {
			toast.fail("Could not apply the migrations", String(error));
		} finally {
			setRunning(false);
		}
	}

	return (
		<Card className="p-6">
			<Modal
				open={editing}
				onClose={() => setEditing(false)}
				title={ready ? "Update credentials" : "Set up updates"}
				description="Pogmail runs the Update workflow in your copy of the repository: it merges upstream and applies pending D1 migrations. If the workflow is not there, it is added first."
			>
				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						const form = new FormData(event.currentTarget);
						const token = String(form.get("token"));

						void dispatch({
							repository: String(form.get("repository")),
							ref: String(form.get("ref")) || "main",
							// An unchanged token is left out, so the stored one stays in place.
							...(token ? { token } : {}),
						});
					}}
				>
					<Field label="Your repository" hint="The copy the Deploy button made, as owner/repo.">
						<Input
							name="repository"
							required
							defaultValue={settings?.repository ?? settings?.detectedRepository ?? ""}
							placeholder="you/pogmail"
							autoComplete="off"
						/>
					</Field>

					<Field label="Branch" hint="The branch the workflow runs on.">
						<Input name="ref" defaultValue={settings?.branch ?? "main"} required autoComplete="off" />
					</Field>

					<Field
						label="GitHub token"
						hint={
							settings?.hasToken
								? "A token is stored, encrypted under CF_TOKEN. Leave this empty to keep it, or paste a new one to replace it."
								: settings?.canRemember === false
									? "A fine-grained token on that repository with Actions: write, Contents: write and Workflows: write. Without the CF_TOKEN secret it is used for this run only, never stored."
									: "A fine-grained token on that repository with Actions: write, Contents: write and Workflows: write — a copy made by the Deploy button has no workflow file, and the first update writes it. Stored encrypted under CF_TOKEN."
						}
					>
						<Input
							name="token"
							type="password"
							required={!settings?.hasToken}
							autoComplete="off"
							placeholder={settings?.hasToken ? "Unchanged" : undefined}
						/>
					</Field>

					<div className="flex justify-end gap-2 pt-2">
						<Button type="button" variant="secondary" onClick={() => setEditing(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={running}>
							{running ? "Starting…" : "Save and update"}
						</Button>
					</div>
				</form>
			</Modal>

			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="min-w-0">
					<h2 className="display text-[0.9375rem] text-ink">Version</h2>
					<p className="mt-1.5 max-w-[68ch] text-sm text-ink-2">
						Your copy of{" "}
						<span className="machine">{data?.repository ?? "the upstream repository"}</span> does not
						follow it: new code arrives only when you merge it.
					</p>
				</div>

				{version.isPending ? (
					<Skeleton className="h-5 w-24" />
				) : behind ? (
					<Tag tone="wait">Update available</Tag>
				) : data?.behind === false ? (
					<Tag tone="ok">Up to date</Tag>
				) : (
					<Tag tone="neutral">Unknown</Tag>
				)}
			</div>

			<dl className="mt-5 divide-y divide-seam">
				<div className="flex items-baseline justify-between gap-6 py-3">
					<dt className="text-sm text-ink-2">This build</dt>
					<dd className="machine text-sm text-ink">{short(data?.commit) ?? "unknown"}</dd>
				</div>
				<div className="flex items-baseline justify-between gap-6 py-3">
					<dt className="text-sm text-ink-2">Upstream</dt>
					<dd className="machine text-sm text-ink">
						{data?.upstream ? (
							<a
								href={data.upstream.url}
								target="_blank"
								rel="noreferrer noopener"
								className="underline underline-offset-2"
							>
								{short(data.upstream.commit)}
							</a>
						) : (
							"unreachable"
						)}
					</dd>
				</div>
				<div className="flex items-baseline justify-between gap-6 py-3">
					<dt className="text-sm text-ink-2">Updates from</dt>
					<dd className="flex items-baseline gap-3">
						<span className="machine text-sm text-ink">{settings?.repository ?? "not set"}</span>
						<button
							type="button"
							className="text-xs text-ink-3 underline underline-offset-2 hover:text-ink-2"
							onClick={() => setEditing(true)}
						>
							{ready ? "Change" : "Set up"}
						</button>
					</dd>
				</div>
			</dl>

			{pending.length > 0 ? (
				<div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-recess p-4">
					<p className="min-w-0 flex-1 text-sm text-ink-2">
						This build carries {pending.length} schema{" "}
						{pending.length === 1 ? "migration" : "migrations"} the database has not run:{" "}
						<span className="machine">{pending.join(", ")}</span>
					</p>
					<Button size="sm" disabled={running} onClick={() => void migrate()}>
						{running ? "Applying…" : "Apply"}
					</Button>
				</div>
			) : null}

			{behind && data?.upstream ? (
				<div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-recess p-4">
					<p className="min-w-0 flex-1 text-sm text-ink-2">
						{data.upstream.subject}{" "}
						<span className="text-ink-3">· {fullDate(data.upstream.committedAt)}</span>
					</p>
					<Button
						size="sm"
						disabled={running}
						// With credentials saved this is the whole interaction; without them
						// the form opens instead of failing on an empty request.
						onClick={() => (ready ? void dispatch({}) : setEditing(true))}
					>
						{running ? "Starting…" : "Update"}
					</Button>
				</div>
			) : null}
		</Card>
	);

}
