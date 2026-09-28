import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Trash2 } from "lucide-react";
import { Button } from "@/client/components/app/button";
import { Field } from "@/client/components/app/primitives";
import { Modal } from "@/client/components/app/modal";
import { RichTextEditor } from "@/client/components/app/rich-text-editor";
import { useToast } from "@/client/components/app/toast-host";
import { Input } from "@/client/components/ui";
import { api, ApiError } from "@/client/lib/api";
import { textToHtml } from "@/client/lib/mail-html";
import { cn } from "@/client/lib/utils";

type Signature = { id: string; name: string; bodyText: string; bodyHtml: string; isDefault: boolean };

export function SignatureSettings({ mailboxId }: { mailboxId: string }) {
	const toast = useToast();
	const client = useQueryClient();
	const key = ["mailbox-signatures", mailboxId];
	const { data, isError } = useQuery({
		queryKey: key,
		queryFn: () => api.get<{ items: Signature[] }>(`/api/mailboxes/${mailboxId}/signatures`),
	});
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [dirty, setDirty] = useState(false);
	const [pending, setPending] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [revision, setRevision] = useState(0);
	const selected = data?.items.find((item) => item.id === selectedId) ?? data?.items.find((item) => item.isDefault) ?? data?.items[0];
	const [name, setName] = useState("");
	const [body, setBody] = useState({ bodyHtml: "", bodyText: "" });

	function select(signature: Signature | null) {
		if (dirty) { toast.fail("Save or discard your changes before switching signatures"); return; }
		setCreating(!signature);
		setSelectedId(signature?.id ?? null);
		setName(signature?.name ?? "");
		setBody({ bodyHtml: signature?.bodyHtml ?? "", bodyText: signature?.bodyText ?? "" });
		setRevision((value) => value + 1);
	}

	async function save() {
		if (!name.trim()) { toast.fail("Give the signature a name"); return; }
		setPending(true);
		try {
			const payload = { name: name.trim(), ...body };
			const saved = creating
				? await api.post<Signature>(`/api/mailboxes/${mailboxId}/signatures`, payload)
				: await api.patch<Signature>(`/api/mailboxes/${mailboxId}/signatures/${selected?.id}`, payload);
			await client.invalidateQueries({ queryKey: key });
			setSelectedId(saved.id);
			setCreating(false);
			setDirty(false);
			toast.ok("Signature saved");
		} catch (error) {
			toast.fail("Could not save signature", error instanceof ApiError ? error.message : undefined);
		} finally { setPending(false); }
	}

	async function setDefault(signatureId: string | null) {
		if (dirty) { toast.fail("Save or discard your changes first"); return; }
		setPending(true);
		try {
			await api.put(`/api/mailboxes/${mailboxId}/signatures/default`, { signatureId });
			await client.invalidateQueries({ queryKey: key });
			toast.ok(signatureId ? "Default signature changed" : "Signatures turned off for this mailbox");
		} catch (error) {
			toast.fail("Could not change default signature", error instanceof ApiError ? error.message : undefined);
		} finally { setPending(false); }
	}

	async function remove() {
		if (!selected) return;
		setPending(true);
		try {
			await api.delete(`/api/mailboxes/${mailboxId}/signatures/${selected.id}`);
			await client.invalidateQueries({ queryKey: key });
			setSelectedId(null);
			setDirty(false);
			setConfirmDelete(false);
			toast.ok("Signature deleted");
		} catch (error) {
			toast.fail("Could not delete signature", error instanceof ApiError ? error.message : undefined);
		} finally { setPending(false); }
	}

	return (
		<section className="mt-6 space-y-4 border-t border-seam pt-5" aria-label="Signatures">
			<div>
				<h3 className="display text-sm">Signatures</h3>
				<p className="mt-1 text-xs text-ink-2">Save several signatures for this address. Choose which one is added to outgoing mail.</p>
			</div>
			{isError ? <p className="text-sm text-destructive">Could not load signatures. Reload to try again.</p> : !data ? <p className="text-sm text-ink-2">Loading signatures…</p> : (
				<div className="grid gap-5 md:grid-cols-[minmax(10rem,12rem)_minmax(0,1fr)]">
					<div className="space-y-2">
						{data.items.map((item) => (
							<Button key={item.id} type="button" variant={selected?.id === item.id && !creating ? "outline" : "ghost"}
								className={cn("w-full justify-between text-left", selected?.id === item.id && !creating && "border-[var(--pogpin-brand-border)]")}
								onClick={() => select(item)} disabled={pending} aria-current={selected?.id === item.id && !creating ? "true" : undefined}>
								<span className="truncate">{item.name}</span>{item.isDefault ? <Check className="size-4 shrink-0" aria-label="Default" /> : null}
							</Button>
						))}
						<Button type="button" variant="secondary" size="sm" onClick={() => select(null)} disabled={pending}>
							<Plus className="size-4" /> New signature
						</Button>
					</div>
					<div className="min-w-0 space-y-4">
						{selected || creating ? (
							<>
								<Field label="Signature name"><Input value={creating || dirty ? name : selected?.name ?? ""} maxLength={60} onChange={(event) => { if (!dirty) setBody({ bodyHtml: selected?.bodyHtml ?? "", bodyText: selected?.bodyText ?? "" }); setName(event.target.value); setDirty(true); }} /></Field>
								<div>
									<p className="mb-2 text-sm font-medium text-foreground">Content</p>
									<RichTextEditor key={`${creating ? "new" : selected?.id}-${revision}`}
										initialHtml={creating || dirty ? body.bodyHtml : (selected?.bodyHtml || textToHtml(selected?.bodyText))}
										onChange={(html, text) => { if (!dirty) setName(selected?.name ?? ""); setBody({ bodyHtml: html, bodyText: text }); setDirty(true); }}
										ariaLabel="Signature content" className="rounded-panel border border-seam px-3" />
								</div>
								<div className="flex flex-wrap gap-2">
									<Button type="button" variant="secondary" onClick={save} disabled={pending || !dirty}>Save signature</Button>
									{dirty ? <Button type="button" variant="ghost" onClick={() => { setDirty(false); setName(selected?.name ?? ""); setBody({ bodyHtml: selected?.bodyHtml ?? "", bodyText: selected?.bodyText ?? "" }); setRevision((value) => value + 1); if (creating) setCreating(false); }}>Discard changes</Button> : null}
									{!creating && selected ? <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)} disabled={pending}><Trash2 className="size-4" /> Delete</Button> : null}
								</div>
							</>
						) : <p className="text-sm text-ink-2">Create a signature to get started.</p>}
					</div>
				</div>
			)}
			{data?.items.length ? (
				<div className="flex flex-wrap items-center gap-2 border-t border-seam pt-4">
					<span className="text-sm text-ink-2">For new messages and replies:</span>
					{data.items.map((item) => (
						<Button key={item.id} type="button" size="sm" variant={item.isDefault ? "outline" : "ghost"} disabled={pending}
							onClick={() => setDefault(item.id)} aria-pressed={item.isDefault}>{item.name}</Button>
					))}
					<Button type="button" size="sm" variant={data.items.every((item) => !item.isDefault) ? "outline" : "ghost"} disabled={pending}
						onClick={() => setDefault(null)} aria-pressed={data.items.every((item) => !item.isDefault)}>No signature</Button>
				</div>
			) : null}
			<Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete signature">
				<p className="text-sm text-ink-2">Delete “{selected?.name}”? This cannot be undone.</p>
				<div className="mt-5 flex justify-end gap-2">
					<Button type="button" variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button>
					<Button type="button" variant="destructive" onClick={remove} disabled={pending}>Delete signature</Button>
				</div>
			</Modal>
		</section>
	);
}
