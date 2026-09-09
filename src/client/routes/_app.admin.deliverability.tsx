import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { Button } from "@/client/components/app/button";
import { Card, Empty, Tag } from "@/client/components/app/primitives";
import { Skeleton } from "@/client/components/ui";
import { api } from "@/client/lib/api";
import { qk } from "@/client/lib/queries/keys";

export const Route = createFileRoute("/_app/admin/deliverability")({ component: Deliverability });

type Metric = { date: string; status: string; total: number };
type DomainReport = { hostname: string; metrics: Metric[]; error: string | null };
type DeliverabilityData = {
	start: string;
	end: string;
	domains: DomainReport[];
	error: string | null;
};

const STATUSES = ["sent", "delivered", "deliveryFailed", "rejected", "failed"] as const;
const STATUS_LABEL: Record<(typeof STATUSES)[number], string> = {
	sent: "Accepted",
	delivered: "Delivered",
	deliveryFailed: "Bounced",
	rejected: "Rejected",
	failed: "Failed",
};
const STATUS_TONE: Record<(typeof STATUSES)[number], "ok" | "wait" | "fail"> = {
	sent: "wait",
	delivered: "ok",
	deliveryFailed: "fail",
	rejected: "fail",
	failed: "fail",
};

function totalByStatus(metrics: Metric[]) {
	return Object.fromEntries(
		STATUSES.map((status) => [
			status,
			metrics.filter((metric) => metric.status === status).reduce((sum, metric) => sum + metric.total, 0),
		]),
	) as Record<(typeof STATUSES)[number], number>;
}

function Deliverability() {
	const report = useQuery({
		queryKey: qk.adminDeliverability,
		queryFn: () => api.get<DeliverabilityData>("/api/admin/deliverability"),
		staleTime: 5 * 60_000,
	});
	const data = report.data;

	return (
		<div className="space-y-5">
			<header className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h2 className="display text-base">Delivery health</h2>
					<p className="mt-1 max-w-prose text-sm text-ink-2">
						Cloudflare’s final delivery events for the last 30 days. “Accepted” means Email Service took the message; “Delivered” means the recipient’s server accepted it.
					</p>
				</div>
				<Button size="sm" variant="secondary" disabled={report.isFetching} onClick={() => void report.refetch()}>
					<RefreshCw className="size-3.5" />
					{report.isFetching ? "Refreshing…" : "Refresh"}
				</Button>
			</header>

			{report.isPending ? (
				<Card className="space-y-3 p-5">
					<Skeleton className="h-5 w-40" />
					<Skeleton className="h-16 w-full" />
				</Card>
			) : data?.error ? (
				<Card className="border-wait/30 bg-wait-soft p-5">
					<Tag tone="wait">Analytics needs setup</Tag>
					<p className="mt-3 text-sm text-ink-2">{data.error}</p>
				</Card>
			) : data?.domains.length ? (
				<>
					<p className="machine text-xs text-ink-3">{data.start} — {data.end} UTC</p>
					{data.domains.map((domain) => (
						<DomainHealth key={domain.hostname} domain={domain} />
					))}
				</>
			) : (
				<Empty title="No sending domains" body="Onboard a domain for Email Sending before Cloudflare has delivery events to show." />
			)}
		</div>
	);
}

function DomainHealth({ domain }: { domain: DomainReport }) {
	const totals = totalByStatus(domain.metrics);
	return (
		<Card className="p-5">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h3 className="machine text-sm text-ink">{domain.hostname}</h3>
				{domain.error ? <Tag tone="fail">Unavailable</Tag> : <Tag tone="accent">Cloudflare analytics</Tag>}
			</div>
			{domain.error ? (
				<p className="mt-3 text-sm text-fail">{domain.error}</p>
			) : domain.metrics.length === 0 ? (
				<p className="mt-3 text-sm text-ink-3">No Cloudflare Email Sending events in this period.</p>
			) : (
				<dl className="mt-4 grid gap-2 sm:grid-cols-5">
					{STATUSES.map((status) => (
						<div key={status} className="rounded-control bg-recess px-3 py-2.5">
							<dt className="text-xs text-ink-3">{STATUS_LABEL[status]}</dt>
							<dd className="mt-1 flex items-baseline justify-between gap-2">
								<span className="machine text-lg text-ink">{totals[status]}</span>
								<Tag tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Tag>
							</dd>
						</div>
					))}
				</dl>
			)}
		</Card>
	);
}
