import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2, Users, X } from "lucide-react";
import { Button } from "@/client/components/app/button";
import { Input } from "@/client/components/ui";
import { Choice } from "@/client/components/app/choice";
import { Modal } from "@/client/components/app/modal";
import { Card, Empty, Field, Machine, Tag } from "@/client/components/app/primitives";
import { useConfirm } from "@/client/components/app/confirm";
import { useToast } from "@/client/components/app/toast-host";
import { ApiError } from "@/client/lib/api";
import { useCreate, useList, useRemove } from "@/client/lib/queries/crud";
import { qk } from "@/client/lib/queries/keys";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/client/lib/api";
import { MAILBOX_PERMISSIONS, PERMISSION_LABELS } from "@/shared/contract/permissions";

/** The "no other owner" option; an empty string is not a legal Radix value. */
const OWN_MAILBOX = "__self";

export const Route = createFileRoute("/_app/admin/mailboxes")({ component: AdminMailboxes });

type Domain = { id: string; hostname: string; status: string };
type Account = { id: string; email: string; name: string };
type Mailbox = { id: string; address: string; displayName: string | null; type: string; disabled: boolean };

function AdminMailboxes() {
	const toast = useToast();
	const { ask, dialog } = useConfirm();
	const [open, setOpen] = useState(false);
	const [sharing, setSharing] = useState<string | null>(null);

	const mailboxes = useList<Mailbox>(qk.mailboxes, "/api/mailboxes");
	const domains = useList<Domain>(qk.domains, "/api/domains");
	const accounts = useList<Account>(qk.accounts, "/api/accounts");
	const create = useCreate<Record<string, unknown>, Mailbox>(qk.mailboxes, "/api/mailboxes");
	const remove = useRemove(qk.mailboxes, (id) => `/api/mailboxes/${id}`);

	const active = (domains.data ?? []).filter((domain) => domain.status === "active");

	return (
		<div className="space-y-5">
			{dialog}

			<header className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h2 className="display text-base">Mailboxes</h2>
					<p className="mt-1 max-w-prose text-sm text-ink-2">
						Creating a mailbox also creates the Cloudflare routing rule that makes mail for it arrive.
					</p>
				</div>
				<Button size="sm" onClick={() => setOpen(true)} disabled={active.length === 0}>
					<Plus className="size-3.5" />
					New mailbox
				</Button>
			</header>

			{active.length === 0 ? (
				<Empty
					title="Verify a domain first"
					body="Mailboxes belong to a domain, and mail only arrives once Email Routing is active for it."
				/>
			) : mailboxes.data?.length ? (
				<Card>
					<ul className="divide-y divide-seam">
						{mailboxes.data.map((mailbox) => (
							<li key={mailbox.id} className="space-y-2 px-4 py-3">
								<div className="flex flex-wrap items-center gap-3">
									<Machine className="flex-1 text-sm text-ink">{mailbox.address}</Machine>
									{mailbox.displayName ? (
										<span className="text-sm text-ink-2">{mailbox.displayName}</span>
									) : null}
									<Tag tone={mailbox.type === "shared" ? "accent" : "neutral"}>{mailbox.type}</Tag>
									{mailbox.disabled ? <Tag tone="fail">Disabled</Tag> : null}

									<Button
										size="sm"
										variant="ghost"
										onClick={() => setSharing(sharing === mailbox.id ? null : mailbox.id)}
									>
										<Users className="size-3.5" />
										Sharing
									</Button>

									<Button
										size="icon"
										variant="ghost"
										aria-label={`Delete ${mailbox.address}`}
										className="hover:text-fail"
										onClick={() =>
											ask({
												title: `Delete ${mailbox.address}?`,
												description:
													"Every message in it goes too, and mail sent to the address afterwards is rejected. This cannot be undone.",
												confirmLabel: "Delete mailbox",
												onConfirm: () =>
													remove.mutate(mailbox.id, {
														onSuccess: () => toast.ok("Mailbox deleted"),
														onError: (error) => toast.fail("Could not delete it", String(error)),
													}),
											})
										}
									>
										<Trash2 className="size-3.5" />
									</Button>
								</div>

								{sharing === mailbox.id ? (
									<Sharing mailboxId={mailbox.id} accounts={accounts.data ?? []} />
								) : null}
							</li>
						))}
					</ul>
				</Card>
			) : (
				<Empty title="No mailboxes" body="Add the first address for one of your domains." />
			)}

			<Modal open={open} onClose={() => setOpen(false)} title="New mailbox">
				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						const form = new FormData(event.currentTarget);
						create.mutate(
							{
								domainId: String(form.get("domainId")),
								localPart: String(form.get("localPart")).trim().toLowerCase(),
								displayName: String(form.get("displayName")) || null,
								type: String(form.get("type")),
								userId:
									String(form.get("userId")) === OWN_MAILBOX
										? undefined
										: String(form.get("userId")) || undefined,
							},
							{
								onSuccess: () => {
									toast.ok("Mailbox created");
									setOpen(false);
								},
								onError: (error) =>
									toast.fail(
										"Could not create the mailbox",
										error instanceof ApiError ? error.message : undefined,
									),
							},
						);
					}}
				>

					<div className="grid grid-cols-[1fr_1.2fr] gap-3">
						<Field label="Address">
							<Input name="localPart" required placeholder="hello" className="machine" />
						</Field>
						<Field label="Domain">
							<Choice
								name="domainId"
								required
								className="machine"
								options={active.map((domain) => ({
									value: domain.id,
									label: `@${domain.hostname}`,
								}))}
							/>
						</Field>
					</div>

					<Field label="Display name" hint="Shown as the sender name on outgoing mail.">
						<Input name="displayName" maxLength={120} />
					</Field>

					<div className="grid grid-cols-2 gap-3">
						<Field label="Type">
							<Choice
								name="type"
								options={[
									{ value: "personal", label: "Personal" },
									{ value: "shared", label: "Shared" },
								]}
							/>
						</Field>

						<Field label="Owner">
							<Choice
								name="userId"
								options={[
									// Radix refuses an empty item value, so "mine" is spelled out and
									// translated on submit.
									{ value: OWN_MAILBOX, label: "Me" },
									...(accounts.data ?? []).map((account) => ({
										value: account.id,
										label: account.name,
									})),
								]}
							/>
						</Field>
					</div>

					<div className="flex justify-end gap-2 pt-2">
						<Button type="button" variant="secondary" onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button type="submit">Create mailbox</Button>
					</div>
				</form>
			</Modal>
		</div>
	);
}

/**
 * Who else can reach this mailbox, and how far. Ownership is separate: the owner
 * always has full access and never appears here.
 */
function Sharing({ mailboxId, accounts }: { mailboxId: string; accounts: Account[] }) {
	const toast = useToast();
	const client = useQueryClient();

	const detail = useQuery({
		queryKey: qk.mailbox(mailboxId),
		queryFn: () =>
			api.get<{
				userId: string;
				sharing: { id: string; userId: string; permission: string; email: string; name: string }[];
			}>(`/api/mailboxes/${mailboxId}`),
	});

	const shared = detail.data?.sharing ?? [];
	const sharedWith = new Set(shared.map((entry) => entry.userId));
	const available = accounts.filter(
		(account) => account.id !== detail.data?.userId && !sharedWith.has(account.id),
	);

	async function refresh() {
		await client.invalidateQueries({ queryKey: qk.mailbox(mailboxId) });
		await client.invalidateQueries({ queryKey: qk.mailboxes });
	}

	return (
		<div className="space-y-3 rounded-panel border border-seam bg-recess/50 p-3">
			{shared.length > 0 ? (
				<ul className="space-y-1.5">
					{shared.map((entry) => (
						<li key={entry.id} className="flex flex-wrap items-center gap-2 text-sm">
							<span className="min-w-0 flex-1 truncate">{entry.name}</span>
							<Machine className="text-xs">{entry.email}</Machine>

							<Choice
								value={entry.permission}
								size="sm"
								aria-label={`Access for ${entry.email}`}
								className="w-auto text-xs"
								options={MAILBOX_PERMISSIONS.map((permission) => ({
									value: permission,
									label: PERMISSION_LABELS[permission],
								}))}
								onChange={async (next) => {
									await api.put(`/api/mailboxes/${mailboxId}/access`, {
										userId: entry.userId,
										permission: next,
									});
									await refresh();
									toast.ok("Access updated");
								}}
							/>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								aria-label={`Remove access for ${entry.email}`}
								className="size-7 text-ink-3 hover:text-fail"
								onClick={async () => {
									await api.delete(`/api/mailboxes/${mailboxId}/access/${entry.userId}`);
									await refresh();
									toast.ok("Access removed");
								}}
							>
								<X className="size-3.5" />
							</Button>
						</li>
					))}
				</ul>
			) : (
				<p className="text-xs text-ink-3">Only the owner can reach this mailbox.</p>
			)}

			{available.length > 0 ? (
				<form
					className="flex flex-wrap items-end gap-2"
					onSubmit={async (event) => {
						event.preventDefault();
						const data = new FormData(event.currentTarget);
						await api.put(`/api/mailboxes/${mailboxId}/access`, {
							userId: String(data.get("userId")),
							permission: String(data.get("permission")),
						});
						await refresh();
						toast.ok("Access granted");
					}}
				>
					<Choice
						name="userId"
						required
						size="sm"
						aria-label="Account"
						className="w-auto text-xs"
						options={available.map((account) => ({
							value: account.id,
							label: `${account.name} (${account.email})`,
						}))}
					/>

					<Choice
						name="permission"
						size="sm"
						aria-label="Permission"
						className="w-auto text-xs"
						options={MAILBOX_PERMISSIONS.map((permission) => ({
							value: permission,
							label: PERMISSION_LABELS[permission],
						}))}
					/>

					<Button type="submit" size="sm" variant="secondary">
						Grant access
					</Button>
				</form>
			) : null}
		</div>
	);
}
