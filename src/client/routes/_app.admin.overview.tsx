import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
 */
function Version() {
	const toast = useToast();
	const [dispatching, setDispatching] = useState(false);

	const version = useQuery({
		queryKey: qk.adminVersion,
		queryFn: () => api.get<VersionData>("/api/admin/version"),
		// The Worker caches the GitHub call for an hour; nothing here changes faster.
		staleTime: 60 * 60 * 1000,
	});

	const data = version.data;
	const behind = data?.behind === true;

	return (
		<Card className="p-6">
			<Modal
				open={dispatching}
				onClose={() => setDispatching(false)}
				title="Update this installation"
				description="Runs the Update workflow in your copy of the repository: it merges upstream and applies pending D1 migrations."
			>
				<form
					className="space-y-4"
					onSubmit={async (event) => {
						event.preventDefault();
						const form = new FormData(event.currentTarget);

						try {
							await api.post("/api/admin/update", {
								repository: String(form.get("repository")),
								ref: String(form.get("ref")) || "main",
								token: String(form.get("token")),
							});
							toast.ok("Update started", "Watch it under Actions in your repository.");
							setDispatching(false);
						} catch (error) {
							toast.fail("Could not start the update", String(error));
						}
					}}
				>
					<Field label="Your repository" hint="The copy the Deploy button made, as owner/repo.">
						<Input name="repository" required placeholder="you/pogmail" autoComplete="off" />
					</Field>

					<Field label="Branch" hint="The branch the workflow runs on.">
						<Input name="ref" defaultValue="main" required autoComplete="off" />
					</Field>

					<Field
						label="GitHub token"
						hint="A fine-grained token with Actions: write on that repository. It is forwarded to GitHub and never stored."
					>
						<Input name="token" type="password" required autoComplete="off" />
					</Field>

					<div className="flex justify-end gap-2 pt-2">
						<Button type="button" variant="secondary" onClick={() => setDispatching(false)}>
							Cancel
						</Button>
						<Button type="submit">Run update</Button>
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
			</dl>

			{behind && data?.upstream ? (
				<div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-recess p-4">
					<p className="min-w-0 flex-1 text-sm text-ink-2">
						{data.upstream.subject}{" "}
						<span className="text-ink-3">· {fullDate(data.upstream.committedAt)}</span>
					</p>
					<Button size="sm" onClick={() => setDispatching(true)}>
						Update
					</Button>
				</div>
			) : null}
		</Card>
	);
}
