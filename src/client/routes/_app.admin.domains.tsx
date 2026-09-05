import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/client/components/app/button";
import { Input } from "@/client/components/ui";
import { Modal } from "@/client/components/app/modal";
import { Card, Empty, Field, Machine, Tag } from "@/client/components/app/primitives";
import { useConfirm } from "@/client/components/app/confirm";
import { useToast } from "@/client/components/app/toast-host";
import { api, ApiError } from "@/client/lib/api";
import { useCreate, useList, useRemove } from "@/client/lib/queries/crud";
import { qk } from "@/client/lib/queries/keys";

export const Route = createFileRoute("/_app/admin/domains")({ component: Domains });

type Domain = {
	id: string;
	hostname: string;
	zoneId: string;
	status: "pending" | "active" | "error";
	routingEnabled: boolean;
	routingStatus: string | null;
	sendingEnabled: boolean;
	lastError: string | null;
};

const STATUS_TONE = { active: "ok", pending: "wait", error: "fail" } as const;

function Domains() {
	const toast = useToast();
	const { ask, dialog } = useConfirm();
	const [open, setOpen] = useState(false);
	const [inspecting, setInspecting] = useState<string | null>(null);

	const domains = useList<Domain>(qk.domains, "/api/domains");
	const create = useCreate<{ hostname: string }, Domain>(qk.domains, "/api/domains");
	const remove = useRemove(qk.domains, (id) => `/api/domains/${id}`);

	return (
		<div className="space-y-5">
			{dialog}

			<header className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h2 className="display text-base">Domains</h2>
					<p className="mt-1 max-w-prose text-sm text-ink-2">
						A domain must already be on your Cloudflare account. Pogmail turns on Email Routing and
						points it at this Worker.
					</p>
				</div>
				<Button size="sm" onClick={() => setOpen(true)}>
					<Plus className="size-3.5" />
					Add domain
				</Button>
			</header>

			{domains.data?.length ? (
				<Card>
					<ul className="divide-y divide-seam">
						{domains.data.map((domain) => (
							<li key={domain.id} className="space-y-2 px-4 py-3">
								<div className="flex flex-wrap items-center gap-3">
									<Machine className="flex-1 text-sm text-ink">{domain.hostname}</Machine>

									<Tag tone={STATUS_TONE[domain.status]}>{domain.status}</Tag>
									{domain.routingEnabled ? <Tag tone="accent">Receiving</Tag> : null}
									{domain.sendingEnabled ? <Tag tone="accent">Sending</Tag> : null}

									<Button
										size="sm"
										variant="ghost"
										onClick={() =>
											setInspecting(inspecting === domain.id ? null : domain.id)
										}
									>
										DNS
									</Button>

									<Button
										size="sm"
										variant="secondary"
										onClick={async () => {
											try {
												await api.post(`/api/domains/${domain.id}/verify`);
												await domains.refetch();
												toast.ok("Domain re-checked");
											} catch (error) {
												toast.fail(
													"Verification failed",
													error instanceof ApiError ? error.message : undefined,
												);
											}
										}}
									>
										<RefreshCw className="size-3.5" />
										Verify
									</Button>

									<Button
										size="icon"
										variant="ghost"
										aria-label={`Remove ${domain.hostname}`}
										className="hover:text-fail"
										onClick={() =>
											ask({
												title: `Remove ${domain.hostname}?`,
												description:
													"Its mailboxes and every message stored in them go with it. Mail already sent is unaffected. This cannot be undone.",
												confirmLabel: "Remove domain",
												onConfirm: () =>
													remove.mutate(domain.id, {
														onSuccess: () => toast.ok("Domain removed"),
														onError: (error) => toast.fail("Could not remove it", String(error)),
													}),
											})
										}
									>
										<Trash2 className="size-3.5" />
									</Button>
								</div>

								{domain.lastError ? (
									<p className="rounded-control bg-fail-soft px-3 py-2 text-xs text-fail">
										{domain.lastError}
									</p>
								) : null}

								{inspecting === domain.id ? <DnsPanel domainId={domain.id} /> : null}
							</li>
						))}
					</ul>
				</Card>
			) : (
				<Empty
					title="No domains yet"
					body="Add a domain you already have on Cloudflare to start receiving mail for it."
					action={
						<Button size="sm" onClick={() => setOpen(true)}>
							Add a domain
						</Button>
					}
				/>
			)}

			<Modal open={open} onClose={() => setOpen(false)} title="Add domain">
				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						const form = new FormData(event.currentTarget);
						create.mutate(
							{ hostname: String(form.get("hostname")).trim().toLowerCase() },
							{
								onSuccess: () => {
									toast.ok("Domain added", "DNS and Email Routing are being set up.");
									setOpen(false);
								},
								onError: (error) =>
									toast.fail(
										"Could not add the domain",
										error instanceof ApiError ? error.message : undefined,
									),
							},
						);
					}}
				>

					<Field
						label="Hostname"
						hint="The zone must already exist on the Cloudflare account this instance authenticates as."
					>
						<Input
							name="hostname"
							required
							placeholder="example.com"
							className="machine"
						/>
					</Field>

					<div className="flex justify-end gap-2 pt-2">
						<Button type="button" variant="secondary" onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button type="submit">Add domain</Button>
					</div>
				</form>
			</Modal>
		</div>
	);
}

/** Live DNS state read straight from Cloudflare, not from our copy of it. */
function DnsPanel({ domainId }: { domainId: string }) {
	const dns = useQuery({
		queryKey: qk.domainDns(domainId),
		queryFn: () =>
			api.get<{
				routing: { enabled: boolean; status: string } | null;
				records: { id: string; type: string; name: string; content: string; managedByPostbox: boolean }[];
			}>(`/api/domains/${domainId}/dns`),
	});

	if (dns.isPending) return <p className="text-xs text-ink-3">Reading DNS…</p>;

	return (
		<div className="overflow-x-auto rounded-panel border border-seam">
			<table className="w-full text-left text-xs">
				<thead className="bg-recess">
					<tr>
						<th className="field-label px-3 py-2">Type</th>
						<th className="field-label px-3 py-2">Name</th>
						<th className="field-label px-3 py-2">Value</th>
						<th className="field-label px-3 py-2">Managed</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-seam">
					{dns.data?.records.map((record) => (
						<tr key={record.id}>
							<td className="machine px-3 py-1.5">{record.type}</td>
							<td className="machine px-3 py-1.5">{record.name}</td>
							<td className="machine px-3 py-1.5 break-all">{record.content}</td>
							<td className="px-3 py-1.5">
								{record.managedByPostbox ? <Tag tone="accent">Pogmail</Tag> : <span className="text-ink-3">yours</span>}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
