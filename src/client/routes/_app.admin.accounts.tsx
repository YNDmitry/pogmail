import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/client/components/app/button";
import { Checkbox, Input } from "@/client/components/ui";
import { Choice } from "@/client/components/app/choice";
import { Modal } from "@/client/components/app/modal";
import { Card, Empty, Field, Machine, Tag } from "@/client/components/app/primitives";
import { useConfirm } from "@/client/components/app/confirm";
import { useToast } from "@/client/components/app/toast-host";
import { ApiError } from "@/client/lib/api";
import { shortDate } from "@/client/lib/format";
import { useCreate, useList, useRemove, useUpdate } from "@/client/lib/queries/crud";
import { qk } from "@/client/lib/queries/keys";

export const Route = createFileRoute("/_app/admin/accounts")({ component: Accounts });

type Account = {
	id: string;
	email: string;
	name: string;
	role: "admin" | "user";
	disabled: boolean;
	canManageMailboxes: boolean;
	mailboxCount: number;
	createdAt: string;
};

function Accounts() {
	const toast = useToast();
	const { ask, dialog } = useConfirm();
	const [open, setOpen] = useState(false);

	const accounts = useList<Account>(qk.accounts, "/api/accounts");
	const create = useCreate<Record<string, unknown>, Account>(qk.accounts, "/api/accounts");
	const update = useUpdate<Record<string, unknown>, Account>(qk.accounts, (id) => `/api/accounts/${id}`);
	const remove = useRemove(qk.accounts, (id) => `/api/accounts/${id}`);

	return (
		<div className="space-y-5">
			{dialog}

			<header className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h2 className="display text-base">Accounts</h2>
					<p className="mt-1 max-w-prose text-sm text-ink-2">
						People who can sign in. Mailbox access is granted separately, per mailbox.
					</p>
				</div>
				<Button size="sm" onClick={() => setOpen(true)}>
					<Plus className="size-3.5" />
					New account
				</Button>
			</header>

			{accounts.data?.length ? (
				<Card>
					<ul className="divide-y divide-seam">
						{accounts.data.map((account) => (
							<li key={account.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
								<div className="min-w-0 flex-1">
									<p className="text-sm font-medium text-ink">{account.name}</p>
									<Machine className="text-xs">{account.email}</Machine>
								</div>

								<Tag tone={account.role === "admin" ? "accent" : "neutral"}>{account.role}</Tag>
								{account.canManageMailboxes && account.role !== "admin" ? (
									<Tag tone="neutral">Manages mailboxes</Tag>
								) : null}
								{account.disabled ? <Tag tone="fail">Disabled</Tag> : null}

								<span className="machine w-12 text-right text-xs text-ink-3 tabular-nums">
									{account.mailboxCount}
								</span>
								<span className="machine w-20 text-right text-xs text-ink-3">
									{shortDate(account.createdAt)}
								</span>

								<Button
									size="sm"
									variant="ghost"
									onClick={() =>
										update.mutate(
											{ id: account.id, input: { disabled: !account.disabled } },
											{
												onSuccess: () => toast.ok(account.disabled ? "Enabled" : "Disabled"),
												onError: (error) =>
													toast.fail(
														"Could not update the account",
														error instanceof ApiError ? error.message : undefined,
													),
											},
										)
									}
								>
									{account.disabled ? "Enable" : "Disable"}
								</Button>

								<Button
									size="icon"
									variant="ghost"
									aria-label={`Delete ${account.email}`}
									className="hover:text-fail"
									onClick={() =>
										ask({
											title: `Delete ${account.email}?`,
											description:
												"They lose access immediately, and anything owned by the account — mailboxes, drafts, API keys — is deleted with it. This cannot be undone.",
											confirmLabel: "Delete account",
											onConfirm: () =>
												remove.mutate(account.id, {
													onSuccess: () => toast.ok("Account deleted"),
													onError: (error) =>
														toast.fail(
															"Could not delete the account",
															error instanceof ApiError ? error.message : undefined,
														),
												}),
										})
									}
								>
									<Trash2 className="size-3.5" />
								</Button>
							</li>
						))}
					</ul>
				</Card>
			) : (
				<Empty title="No accounts" body="Add someone who should be able to sign in." />
			)}

			<Modal open={open} onClose={() => setOpen(false)} title="New account">
				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						const form = new FormData(event.currentTarget);
						create.mutate(
							{
								name: String(form.get("name")),
								email: String(form.get("email")).toLowerCase(),
								password: String(form.get("password")),
								role: String(form.get("role")),
								canManageMailboxes: form.get("canManageMailboxes") === "on",
							},
							{
								onSuccess: () => {
									toast.ok("Account created");
									setOpen(false);
								},
								onError: (error) =>
									toast.fail(
										"Could not create the account",
										error instanceof ApiError ? error.message : undefined,
									),
							},
						);
					}}
				>

					<Field label="Name">
						<Input name="name" required maxLength={120} />
					</Field>
					<Field label="Email">
						<Input name="email" type="email" required />
					</Field>
					<Field label="Temporary password" hint="At least 12 characters. They can change it after signing in.">
						<Input name="password" type="password" required minLength={12} />
					</Field>

					<div className="grid grid-cols-2 items-end gap-3">
						<Field label="Role">
							<Choice
								name="role"
								options={[
									{ value: "user", label: "User" },
									{ value: "admin", label: "Admin" },
								]}
							/>
						</Field>
						<label className="flex items-center gap-2.5 pb-2 text-sm">
							<Checkbox name="canManageMailboxes" />
							Can manage mailboxes
						</label>
					</div>

					<div className="flex justify-end gap-2 pt-2">
						<Button type="button" variant="secondary" onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button type="submit">Create account</Button>
					</div>
				</form>
			</Modal>
		</div>
	);
}
