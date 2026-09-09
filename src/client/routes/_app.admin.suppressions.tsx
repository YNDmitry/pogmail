import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw, Search, Trash2 } from "lucide-react";
import { Button } from "@/client/components/app/button";
import { Choice } from "@/client/components/app/choice";
import { useConfirm } from "@/client/components/app/confirm";
import { Card, Empty, Machine, Tag } from "@/client/components/app/primitives";
import { useToast } from "@/client/components/app/toast-host";
import { Input, Skeleton } from "@/client/components/ui";
import { api, ApiError } from "@/client/lib/api";
import { qk } from "@/client/lib/queries/keys";

export const Route = createFileRoute("/_app/admin/suppressions")({ component: Suppressions });

const REASONS = ["manual", "complaint", "hard_bounce", "soft_bounce", "policy"] as const;
type Reason = (typeof REASONS)[number];
type Suppression = {
	id: string;
	created_at: string;
	email: string;
	expires_at: string | null;
	read_only: boolean;
	reason: Reason;
	note?: string | null;
};
type Account = { id: string; name: string };
type SuppressionData = {
	accounts: Account[];
	accountId?: string;
	items: Suppression[];
	nextCursor: string | null;
	error: string | null;
};

const REASON_LABEL: Record<Reason, string> = {
	manual: "Manual",
	complaint: "Complaint",
	hard_bounce: "Hard bounce",
	soft_bounce: "Soft bounce",
	policy: "Policy",
};
const REASON_TONE: Record<Reason, "neutral" | "wait" | "fail"> = {
	manual: "neutral",
	complaint: "fail",
	hard_bounce: "fail",
	soft_bounce: "wait",
	policy: "wait",
};

function Suppressions() {
	const toast = useToast();
	const client = useQueryClient();
	const { ask, dialog } = useConfirm();
	const [accountId, setAccountId] = useState<string>();
	const [reason, setReason] = useState<Reason | "all">("all");
	const [searchInput, setSearchInput] = useState("");
	const [search, setSearch] = useState("");
	const [cursor, setCursor] = useState<string>();
	const [previousCursors, setPreviousCursors] = useState<string[]>([]);

	const filters = {
		accountId,
		reason: reason === "all" ? undefined : reason,
		search: search || undefined,
		cursor,
	};
	const report = useQuery({
		queryKey: qk.adminSuppressions(filters),
		queryFn: () => api.get<SuppressionData>("/api/admin/suppressions", { query: filters }),
		staleTime: 60_000,
	});
	const data = report.data;
	const selectedAccountId = accountId ?? data?.accountId;
	const remove = useMutation({
		mutationFn: ({ id, accountId: targetAccountId }: { id: string; accountId: string }) =>
			api.delete<{ ok: true }>(`/api/admin/suppressions/${id}`, { query: { accountId: targetAccountId } }),
		onSuccess: () => {
			void client.invalidateQueries({ queryKey: ["admin", "suppressions"] });
			toast.ok("Suppression removed", "Future delivery attempts to this address are allowed again.");
		},
		onError: (error) => toast.fail("Could not remove suppression", error instanceof ApiError ? error.message : String(error)),
	});

	function resetPage() {
		setCursor(undefined);
		setPreviousCursors([]);
	}

	return (
		<div className="space-y-5">
			{dialog}
			<header className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h2 className="display text-base">Suppressions</h2>
					<p className="mt-1 max-w-prose text-sm text-ink-2">
						Cloudflare blocks these recipients to protect sender reputation. Only records Cloudflare explicitly marks as editable can be removed.
					</p>
				</div>
				<Button size="sm" variant="secondary" disabled={report.isFetching} onClick={() => void report.refetch()}>
					<RefreshCw className="size-3.5" />
					{report.isFetching ? "Refreshing…" : "Refresh"}
				</Button>
			</header>

			{data?.accounts.length ? (
				<Card className="p-4">
					<div className="grid gap-3 md:grid-cols-[minmax(12rem,0.7fr)_minmax(11rem,0.55fr)_minmax(16rem,1fr)]">
						<Choice
							aria-label="Cloudflare account"
							value={selectedAccountId}
							onChange={(value) => {
								setAccountId(value);
								resetPage();
							}}
							options={data.accounts.map((account) => ({ value: account.id, label: account.name }))}
						/>
						<Choice
							aria-label="Suppression reason"
							value={reason}
							onChange={(value) => {
								setReason(value as Reason | "all");
								resetPage();
							}}
							options={[{ value: "all", label: "All reasons" }, ...REASONS.map((value) => ({ value, label: REASON_LABEL[value] }))]}
						/>
						<form
							className="flex gap-2"
							onSubmit={(event) => {
								event.preventDefault();
								setSearch(searchInput.trim());
								resetPage();
							}}
						>
							<Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search address" className="machine" />
							<Button size="sm" type="submit" variant="secondary" aria-label="Search suppressions">
								<Search className="size-3.5" />
							</Button>
						</form>
					</div>
				</Card>
			) : null}

			{report.isPending ? (
				<Card className="space-y-3 p-5"><Skeleton className="h-5 w-48" /><Skeleton className="h-16 w-full" /></Card>
			) : report.isError ? (
				<Card className="border-fail/30 bg-fail-soft p-5"><Tag tone="fail">Unavailable</Tag><p className="mt-3 text-sm text-ink-2">{report.error instanceof Error ? report.error.message : "Cloudflare could not load suppression records."}</p></Card>
			) : data?.error ? (
				<Card className="border-wait/30 bg-wait-soft p-5"><Tag tone="wait">Setup needed</Tag><p className="mt-3 text-sm text-ink-2">{data.error}</p></Card>
			) : data?.items.length ? (
				<>
					<Card>
						<ul className="divide-y divide-seam">
							{data.items.map((item) => (
								<li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
									<div className="min-w-0 flex-1">
										<Machine className="block truncate text-sm text-ink">{item.email}</Machine>
										<p className="mt-1 text-xs text-ink-3">
											Added <span className="machine">{new Date(item.created_at).toLocaleString()}</span>
											{item.expires_at ? <> · expires <span className="machine">{new Date(item.expires_at).toLocaleString()}</span></> : null}
											{item.note ? <> · {item.note}</> : null}
										</p>
									</div>
									<Tag tone={REASON_TONE[item.reason]}>{REASON_LABEL[item.reason]}</Tag>
									{item.read_only ? (
										<Tag tone="wait">Cloudflare protected</Tag>
									) : (
										<Button
											size="sm"
											variant="ghost"
											className="hover:text-fail"
											disabled={remove.isPending || !selectedAccountId}
											onClick={() => selectedAccountId && ask({
												title: `Allow ${item.email} again?`,
												description: "Cloudflare will allow future delivery attempts to this address across the selected account. Use this only after confirming the recipient can receive mail.",
												confirmLabel: "Remove suppression",
												onConfirm: () => remove.mutate({ id: item.id, accountId: selectedAccountId }),
											})}
										>
											<Trash2 className="size-3.5" /> Remove
										</Button>
									)}
								</li>
							))}
						</ul>
					</Card>
					<div className="flex justify-end gap-2">
						<Button size="sm" variant="secondary" disabled={previousCursors.length === 0 || report.isFetching} onClick={() => {
							const previous = previousCursors.at(-1);
							setPreviousCursors((items) => items.slice(0, -1));
							setCursor(previous || undefined);
						}}>Previous</Button>
						<Button size="sm" variant="secondary" disabled={!data.nextCursor || report.isFetching} onClick={() => {
							setPreviousCursors((items) => [...items, cursor ?? ""]);
							setCursor(data.nextCursor ?? undefined);
						}}>Next</Button>
					</div>
				</>
			) : (
				<Empty title="No suppressed recipients" body="Cloudflare has no active suppressions matching these filters." />
			)}
		</div>
	);
}
