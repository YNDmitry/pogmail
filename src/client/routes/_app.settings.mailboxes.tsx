import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Plus, X } from "lucide-react";
import { Button, SubmitButton } from "@/client/components/app/button";
import { Input, Switch } from "@/client/components/ui";
import { MailyEditor } from "@/client/components/app/maily-editor";
import { Modal } from "@/client/components/app/modal";
import { Card, Empty, Field, Machine, Tag } from "@/client/components/app/primitives";
import { useToast } from "@/client/components/app/toast-host";
import { api } from "@/client/lib/api";
import { useMailboxes } from "@/client/lib/queries";
import { useCreate, useList, useRemove } from "@/client/lib/queries/crud";
import { qk } from "@/client/lib/queries/keys";
import { PERMISSION_LABELS } from "@/shared/contract/permissions";
import { textToHtml } from "@/client/lib/mail-html";

export const Route = createFileRoute("/_app/settings/mailboxes")({ component: MailboxSettings });

type MailboxDetail = {
	id: string;
	address: string;
	displayName: string | null;
	signature: string | null;
	signatureHtml: string | null;
	autoReplyEnabled: boolean;
	autoReplySubject: string;
	autoReplyBody: string;
	autoReplyHtml: string | null;
	aliases: { id: string; localPart: string }[];
};

function MailboxSettings() {
	const mailboxes = useMailboxes();
	const [selected, setSelected] = useState<string | null>(null);

	const current = selected ?? mailboxes.data?.[0]?.id ?? null;

	if (!mailboxes.data?.length) {
		return (
			<Empty
				title="No mailboxes yet"
				body="An administrator adds mailboxes under Administration once a domain is verified."
			/>
		);
	}

	return (
		<div className="space-y-5">
			<header>
				<h2 className="display text-base">Mailboxes</h2>
				<p className="mt-1 max-w-prose text-sm text-ink-2">
					Your signature and out-of-office reply, per address.
				</p>
			</header>

			<div className="flex flex-wrap gap-2">
				{mailboxes.data.map((mailbox) => (
					<Button
						key={mailbox.id}
						type="button"
						variant={mailbox.id === current ? "outline" : "secondary"}
						size="sm"
						onClick={() => setSelected(mailbox.id)}
						className={
							mailbox.id === current
								? "machine border-[var(--pogpin-brand-border)] bg-accent text-xs text-primary"
								: "machine text-xs"
						}
					>
						{mailbox.address}
					</Button>
				))}
			</div>

			{current ? <MailboxForm key={current} id={current} /> : null}
		</div>
	);
}

function MailboxForm({ id }: { id: string }) {
	const toast = useToast();
	const client = useQueryClient();
	const [state, setState] = useState<"idle" | "loading">("idle");
	const [contentMailboxId, setContentMailboxId] = useState<string | null>(null);
	const [signature, setSignature] = useState({ html: "", text: "" });
	const [autoReply, setAutoReply] = useState({ html: "", text: "" });

	const mailbox = useQuery({
		queryKey: qk.mailbox(id),
		queryFn: () => api.get<MailboxDetail>(`/api/mailboxes/${id}`),
	});

	const permission = useMailboxes().data?.find((entry) => entry.id === id)?.permission;

	if (!mailbox.data) return null;
	const data = mailbox.data;
	// Query data arrives after this component mounts. Reset the two editors before
	// they mount for a different mailbox, without clobbering edits on a refetch.
	if (contentMailboxId !== data.id) {
		setContentMailboxId(data.id);
		setSignature({ html: data.signatureHtml ?? textToHtml(data.signature), text: data.signature ?? "" });
		setAutoReply({ html: data.autoReplyHtml ?? textToHtml(data.autoReplyBody), text: data.autoReplyBody });
		return null;
	}

	return (
		<Card className="p-5">
			<form
				key={data.id}
				className="space-y-5"
				onSubmit={async (event) => {
					event.preventDefault();
					const form = new FormData(event.currentTarget);
					setState("loading");
					try {
						await api.patch(`/api/mailboxes/${id}`, {
							displayName: String(form.get("displayName")) || null,
							signature: signature.text || null,
							signatureHtml: signature.html || null,
							autoReplyEnabled: form.get("autoReplyEnabled") === "on",
							autoReplySubject: String(form.get("autoReplySubject")),
							autoReplyBody: autoReply.text,
							autoReplyHtml: autoReply.html || null,
						});
						await client.invalidateQueries({ queryKey: qk.mailbox(id) });
						toast.ok("Mailbox saved");
					} catch (error) {
						toast.fail("Could not save the mailbox", String(error));
					} finally {
						setState("idle");
					}
				}}
			>
				<div className="flex flex-wrap items-center gap-3 border-b border-seam pb-4">
					<Machine className="text-sm text-ink">{data.address}</Machine>
					{permission ? <Tag tone="accent">{PERMISSION_LABELS[permission]}</Tag> : null}
					{data.aliases.length > 0 ? (
						<Tag tone="neutral">
							{data.aliases.length} alias{data.aliases.length === 1 ? "" : "es"}
						</Tag>
					) : null}
				</div>

				<Field label="Display name" hint="Shown as the sender name on mail you send.">
					<Input
						name="displayName"
						defaultValue={data.displayName ?? ""}
						maxLength={120}

					/>
				</Field>

				<Field label="Signature" hint="Added to every sent message with a plain-text fallback.">
					<MailyEditor
						initialHtml={data.signatureHtml ?? textToHtml(data.signature)}
						onChange={(html, text) => setSignature({ html, text })}
						ariaLabel="Signature"
						density="compact"
						className="rounded-panel border border-seam px-3"
					/>
				</Field>

				<fieldset className="space-y-4 rounded-panel border border-seam p-4">
					<legend className="field-label px-1">Out of office</legend>

					<label className="flex items-center gap-2.5 text-sm">
						<Switch name="autoReplyEnabled" defaultChecked={data.autoReplyEnabled} />
						Reply automatically to new senders
					</label>

					<p className="text-xs text-ink-3">
						Each correspondent gets one reply every four days, and automated mail never gets one at
						all.
					</p>

					<Field label="Subject">
						<Input
							name="autoReplySubject"
							defaultValue={data.autoReplySubject}
							maxLength={300}

						/>
					</Field>

					<Field label="Message" hint="Formatting is sent to capable clients; everyone else receives the text version.">
						<MailyEditor
							initialHtml={data.autoReplyHtml ?? textToHtml(data.autoReplyBody)}
							onChange={(html, text) => setAutoReply({ html, text })}
							ariaLabel="Out-of-office message"
							density="compact"
							className="rounded-panel border border-seam px-3"
						/>
					</Field>
				</fieldset>

				<SubmitButton type="submit" state={state}>
					Save mailbox
				</SubmitButton>
			</form>

			<Folders mailboxId={id} />
		</Card>
	);
}

/**
 * Folders are per-mailbox, so they are managed here rather than on a page of
 * their own. Deleting one leaves its messages where they are; only the label goes.
 */
function Folders({ mailboxId }: { mailboxId: string }) {
	const toast = useToast();
	const client = useQueryClient();
	const [editing, setEditing] = useState<{ id: string; name: string; color: string | null } | null>(null);
	const folders = useList<{ id: string; mailboxId: string; name: string; color: string | null; position: number }>(
		qk.folders,
		"/api/folders",
	);
	const create = useCreate<Record<string, unknown>, unknown>(qk.folders, "/api/folders");
	const remove = useRemove(qk.folders, (id) => `/api/folders/${id}`);

	const mine = (folders.data ?? []).filter((folder) => folder.mailboxId === mailboxId);

	function reorder(folderId: string, direction: -1 | 1) {
		const from = mine.findIndex((folder) => folder.id === folderId);
		const to = from + direction;
		if (from < 0 || to < 0 || to >= mine.length) return;

		const next = [...mine];
		const [folder] = next.splice(from, 1);
		if (!folder) return;
		next.splice(to, 0, folder);

		void Promise.all(next.map((entry, position) => api.patch(`/api/folders/${entry.id}`, { position })))
			.then(() => {
				void client.invalidateQueries({ queryKey: qk.folders });
				toast.ok("Folder order updated");
			})
			.catch((error) => toast.fail("Could not reorder folders", String(error)));
	}

	return (
		<section className="mt-6 space-y-3 border-t border-seam pt-5">
			<h3 className="display text-sm">Folders</h3>

			{mine.length > 0 ? (
				<ul className="flex flex-wrap gap-2">
				{mine.map((folder, index) => (
						<li
							key={folder.id}
							className="flex items-center gap-2 rounded-panel border border-seam px-2.5 py-1 text-xs"
						>
							{folder.color ? (
								<span
									aria-hidden
									className="size-2 rounded-full"
									style={{ background: folder.color }}
								/>
							) : null}
							{folder.name}
							<Button
								type="button"
								variant="ghost"
								size="icon"
								aria-label={`Move ${folder.name} up`}
								className="size-6 text-ink-3"
								disabled={index === 0}
								onClick={() => reorder(folder.id, -1)}
							>
								<ArrowUp className="size-3" />
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								aria-label={`Move ${folder.name} down`}
								className="size-6 text-ink-3"
								disabled={index === mine.length - 1}
								onClick={() => reorder(folder.id, 1)}
							>
								<ArrowDown className="size-3" />
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								aria-label={`Edit ${folder.name}`}
								className="size-6 text-ink-3"
								onClick={() => setEditing(folder)}
							>
								<Pencil className="size-3" />
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								aria-label={`Delete ${folder.name}`}
								className="size-6 text-ink-3 hover:text-fail"
								onClick={() =>
									remove.mutate(folder.id, { onSuccess: () => toast.ok("Folder deleted") })
								}
							>
								<X className="size-3" />
							</Button>
						</li>
					))}
				</ul>
			) : (
				<p className="text-xs text-ink-3">No folders yet. Filters can move mail into one.</p>
			)}

			<form
				className="flex items-end gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					const form = event.currentTarget;
					const data = new FormData(form);

					create.mutate(
						{
							mailboxId,
							name: String(data.get("name")),
							color: String(data.get("color")),
						},
						{
							onSuccess: () => {
								toast.ok("Folder added");
								form.reset();
							},
							onError: (error) => toast.fail("Could not add the folder", String(error)),
						},
					);
				}}
			>
				<Field label="New folder" className="flex-1">
					<Input name="name" required maxLength={60} />
				</Field>
				{/* The one native control left: no colour picker ships in the kit. */}
				<input
					name="color"
					type="color"
					defaultValue="#ff5e57"
					aria-label="Folder colour"
					className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1 shadow-xs dark:bg-input/30"
				/>
				<Button type="submit" variant="secondary">
					<Plus className="size-3.5" />
					Add
				</Button>
			</form>

			<Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Edit folder">
				{editing ? (
					<form
						className="space-y-4"
						onSubmit={(event) => {
							event.preventDefault();
							const data = new FormData(event.currentTarget);
							void api
								.patch(`/api/folders/${editing.id}`, {
									name: String(data.get("name")),
									color: String(data.get("color")),
								})
								.then(() => {
									void client.invalidateQueries({ queryKey: qk.folders });
									setEditing(null);
									toast.ok("Folder updated");
								})
								.catch((error) => toast.fail("Could not update folder", String(error)));
						}}
					>
						<Field label="Name"><Input name="name" required maxLength={60} defaultValue={editing.name} /></Field>
						<Field label="Colour"><input name="color" type="color" defaultValue={editing.color ?? "#ff5e57"} aria-label="Folder colour" className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent p-1 shadow-xs dark:bg-input/30" /></Field>
						<div className="flex justify-end gap-2">
							<Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
							<Button type="submit">Save folder</Button>
						</div>
					</form>
				) : null}
			</Modal>
		</section>
	);
}
