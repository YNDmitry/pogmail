import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/client/components/app/primitives";
import { Mark } from "@/client/components/app/mark";
import { AnimatedNumber } from "@/client/components/motion/animated-number";
import { useInstanceIdentity } from "@/client/lib/identity-context";
import { api } from "@/client/lib/api";
import { useBranding } from "@/client/lib/queries";
import { bytes } from "@/client/lib/format";
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

const STATUS_ORDER = ["received", "sent", "draft", "archived", "spam", "trash"];

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
		</div>
	);
}
