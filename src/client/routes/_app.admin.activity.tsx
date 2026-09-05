import { createFileRoute } from "@tanstack/react-router";
import { Card, Empty, Machine } from "@/client/components/app/primitives";
import { fullDate } from "@/client/lib/format";
import { useList } from "@/client/lib/queries/crud";
import { qk } from "@/client/lib/queries/keys";

export const Route = createFileRoute("/_app/admin/activity")({ component: Activity });

type Entry = {
	id: string;
	action: string;
	metadata: Record<string, unknown> | null;
	ip: string | null;
	createdAt: string;
	actorEmail: string | null;
	actorName: string | null;
};

function Activity() {
	const entries = useList<Entry>(qk.activity, "/api/activity");

	return (
		<div className="space-y-5">
			<header>
				<h2 className="display text-base">Activity</h2>
				<p className="mt-1 max-w-prose text-sm text-ink-2">
					Every administrative action, who took it, and from where.
				</p>
			</header>

			{entries.data?.length ? (
				<Card className="overflow-x-auto">
					<table className="w-full text-left text-sm">
						<thead className="border-b border-seam bg-recess">
							<tr>
								<th className="field-label px-4 py-2">When</th>
								<th className="field-label px-4 py-2">Who</th>
								<th className="field-label px-4 py-2">Action</th>
								<th className="field-label px-4 py-2">Details</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-seam">
							{entries.data.map((entry) => (
								<tr key={entry.id}>
									<td className="machine px-4 py-2 text-xs whitespace-nowrap text-ink-2">
										{fullDate(entry.createdAt)}
									</td>
									<td className="px-4 py-2">
										<span className="text-sm">{entry.actorName ?? "System"}</span>
										{entry.actorEmail ? (
											<Machine className="block text-xs">{entry.actorEmail}</Machine>
										) : null}
									</td>
									<td className="px-4 py-2">
										<Machine className="text-xs">{entry.action}</Machine>
									</td>
									<td className="px-4 py-2 text-xs text-ink-3">
										{entry.metadata ? (
											<code className="break-all">{JSON.stringify(entry.metadata)}</code>
										) : null}
										{entry.ip ? <Machine className="ml-2 text-xs">{entry.ip}</Machine> : null}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</Card>
			) : (
				<Empty title="Nothing logged yet" body="Administrative actions appear here as they happen." />
			)}
		</div>
	);
}
