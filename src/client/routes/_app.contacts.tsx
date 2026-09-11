import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Mail, Search, Send, SquareStop, Trash2 } from "lucide-react";
import { Button } from "@/client/components/app/button";
import { Choice } from "@/client/components/app/choice";
import { EmailFrame } from "@/client/components/app/email-frame";
import { MailyEditor } from "@/client/components/app/maily-editor";
import { Modal } from "@/client/components/app/modal";
import { useConfirm } from "@/client/components/app/confirm";
import { Card, Empty, Field, Machine, PageHeader, Tag } from "@/client/components/app/primitives";
import { useToast } from "@/client/components/app/toast-host";
import { Checkbox, Input } from "@/client/components/ui";
import { api, ApiError } from "@/client/lib/api";
import { Loader } from "@/client/components/motion/loader";
import { useList, useRemove, useUpdate } from "@/client/lib/queries/crud";
import { qk } from "@/client/lib/queries/keys";
import { shortDate } from "@/client/lib/format";
import { textToHtml } from "@/client/lib/mail-html";
import { useMailboxes } from "@/client/lib/queries";
import { cn } from "@/client/lib/utils";
import { canSend } from "@/shared/contract/permissions";

export const Route = createFileRoute("/_app/contacts")({ component: Contacts });

type Contact = {
	id: string;
	email: string;
	displayName: string | null;
	source: "manual" | "inbound" | "outbound";
	blocked: boolean;
	unsubscribedAt: string | null;
	messageCount: number;
	lastSeenAt: string | null;
};

type Template = { id: string; name: string; subject: string; bodyText: string; bodyHtml: string | null };
type CampaignResult = { id: string; queued: number; skippedBlocked: number; skippedMissing: number; skippedUnsubscribed: number };
type Audience = { id: string; name: string; description: string; memberCount: number };
type Campaign = {
	id: string;
	subject: string;
	recipientCount: number;
	createdAt: string;
	state: "queued" | "sending" | "completed" | "cancelled";
	queued: number;
	sending: number;
	sent: number;
	failed: number;
};

function Contacts() {
	const toast = useToast();
	const [search, setSearch] = useState("");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [campaignOpen, setCampaignOpen] = useState(false);
	const [audienceOpen, setAudienceOpen] = useState(false);

	const contacts = useList<Contact>(qk.contacts(), "/api/contacts", {
		search: search || undefined,
	});
	const update = useUpdate<{ blocked?: boolean }, Contact>(qk.contacts(), (id) => `/api/contacts/${id}`);
	const remove = useRemove(qk.contacts(), (id) => `/api/contacts/${id}`);
	const campaigns = useQuery({
		queryKey: qk.campaigns,
		queryFn: async () => (await api.get<{ items: Campaign[] }>("/api/send/campaigns")).items,
		refetchInterval: 5_000,
	});
	const selectable = (contacts.data ?? []).filter((contact) => !contact.blocked && !contact.unsubscribedAt);
	const allSelected = selectable.length > 0 && selectable.every((contact) => selected.has(contact.id));

	function toggleContact(id: string, checked: boolean) {
		setSelected((current) => {
			const next = new Set(current);
			if (checked) next.add(id);
			else next.delete(id);
			return next;
		});
	}

	return (
		<div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
			<PageHeader
				title="Contacts"
				description="Everyone you have exchanged mail with. Campaigns only include contacts who are neither blocked nor unsubscribed."
				actions={<>
					<Button size="sm" variant="secondary" disabled={selected.size === 0} onClick={() => setAudienceOpen(true)}>Save audience</Button>
					<Button size="sm" disabled={selected.size === 0} onClick={() => setCampaignOpen(true)}><Send className="size-3.5" />Campaign{selected.size ? ` (${selected.size})` : ""}</Button>
				</>}
			/>

			<div className="relative max-w-sm">
				<Search aria-hidden className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
				<Input
					type="search"
					value={search}
					onChange={(event) => setSearch(event.target.value)}
					placeholder="Search by name or address"
					aria-label="Search contacts"
					className="pl-9"
				/>
			</div>

			{contacts.isPending ? (
				<div className="grid place-items-center py-16">
					<Loader />
				</div>
			) : contacts.data?.length ? (
				<Card>
					<ul className="divide-y divide-seam">
						<li className="flex items-center gap-3 px-4 py-2.5 text-xs text-ink-3">
							<Checkbox
								checked={allSelected}
								disabled={selectable.length === 0}
								aria-label="Select all unblocked contacts shown"
								onCheckedChange={(checked) => {
									setSelected((current) => {
										const next = new Set(current);
										for (const contact of selectable) {
											if (checked === true) next.add(contact.id);
											else next.delete(contact.id);
										}
										return next;
									});
								}}
							/>
							<span>Select all available contacts shown</span>
						</li>
						{contacts.data.map((contact) => (
							<li
								key={contact.id}
								className={cn(
									"flex flex-wrap items-center gap-3 px-4 py-3",
									contact.blocked && "bg-fail-soft/40",
								)}
							>
								<Checkbox
									checked={selected.has(contact.id)}
									disabled={contact.blocked || Boolean(contact.unsubscribedAt)}
									aria-label={`Select ${contact.email} for campaign`}
									onCheckedChange={(checked) => toggleContact(contact.id, checked === true)}
								/>
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm font-medium text-ink">
										{contact.displayName || contact.email}
									</p>
									<Machine className="block truncate text-xs">{contact.email}</Machine>
								</div>

								<Tag tone="neutral">{contact.source}</Tag>
								{contact.blocked ? <Tag tone="fail">Blocked</Tag> : null}
								{contact.unsubscribedAt ? <Tag tone="neutral">Unsubscribed</Tag> : null}

								<span className="machine w-16 text-right text-xs text-ink-3 tabular-nums">
									{contact.messageCount}
								</span>
								<span className="machine w-20 text-right text-xs text-ink-3">
									{contact.lastSeenAt ? shortDate(contact.lastSeenAt) : "—"}
								</span>

								<Button
									size="sm"
									variant="ghost"
									onClick={() =>
										update.mutate(
											{ id: contact.id, input: { blocked: !contact.blocked } },
											{
												onSuccess: () =>
													toast.ok(contact.blocked ? "Unblocked" : "Blocked"),
											},
										)
									}
								>
									<Ban className="size-3.5" />
									{contact.blocked ? "Unblock" : "Block"}
								</Button>

								<Button
									size="icon"
									variant="ghost"
									aria-label={`Remove ${contact.email}`}
									onClick={() =>
										remove.mutate(contact.id, { onSuccess: () => toast.ok("Contact removed") })
									}
									className="hover:text-fail"
								>
									<Trash2 className="size-3.5" />
								</Button>
							</li>
						))}
					</ul>
				</Card>
			) : (
				<Empty
					title="No contacts yet"
					body="Addresses are added automatically as mail arrives, and you can block any of them from here."
				/>
			)}

			<CampaignComposer
				open={campaignOpen}
				contactIds={[...selected]}
				onClose={() => setCampaignOpen(false)}
				onSent={() => {
					setSelected(new Set());
					setCampaignOpen(false);
					void campaigns.refetch();
				}}
			/>
			<AudienceForm open={audienceOpen} contactIds={[...selected]} onClose={() => setAudienceOpen(false)} />
			<CampaignHistory campaigns={campaigns.data ?? []} />
		</div>
	);
}

function CampaignHistory({ campaigns }: { campaigns: Campaign[] }) {
	const toast = useToast();
	const queryClient = useQueryClient();
	const { ask, dialog } = useConfirm();
	const cancel = useMutation({
		mutationFn: (id: string) => api.post<{ ok: true }>(`/api/send/campaigns/${id}/cancel`),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: qk.campaigns });
			toast.ok("Campaign stopped; queued emails will not be sent");
		},
		onError: (error) => toast.fail("Could not stop campaign", error instanceof ApiError ? error.message : undefined),
	});

	if (campaigns.length === 0) return null;
	return <section className="space-y-3">
		<div>
			<h2 className="display text-base">Campaigns</h2>
			<p className="mt-1 text-sm text-ink-2">Progress updates while deliveries move through the queue.</p>
		</div>
		<Card>
			<ul className="divide-y divide-seam">
				{campaigns.map((campaign) => {
					const pending = campaign.queued + campaign.sending;
					return <li key={campaign.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-medium text-ink">{campaign.subject}</p>
							<p className="mt-1 text-xs text-ink-3">{shortDate(campaign.createdAt)} · {campaign.recipientCount} recipients</p>
						</div>
						<Tag tone={campaignTone(campaign.state)}>{campaign.state}</Tag>
						<span className="machine text-xs text-ink-3">{campaign.sent} sent · {pending} pending · {campaign.failed} failed</span>
						{campaign.state === "queued" || campaign.state === "sending" ? <Button
							size="sm"
							variant="secondary"
							disabled={cancel.isPending}
							onClick={() => ask({
								title: "Stop campaign?",
								description: "Any email already handed to the provider can still arrive. The remaining queued emails will be stopped.",
								confirmLabel: "Stop campaign",
								onConfirm: () => cancel.mutate(campaign.id),
							})}
						>
							<SquareStop className="size-3.5" />Stop
						</Button> : null}
					</li>;
				})}
			</ul>
		</Card>
		{dialog}
	</section>;
}

function AudienceForm({ open, contactIds, onClose }: { open: boolean; contactIds: string[]; onClose: () => void }) {
	const toast = useToast();
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [saving, setSaving] = useState(false);

	async function submit() {
		setSaving(true);
		try {
			await api.post("/api/contacts/audiences", { name, contactIds });
			await queryClient.invalidateQueries({ queryKey: qk.audiences });
			toast.ok(`Audience "${name}" saved`);
			setName("");
			onClose();
		} catch (error) {
			toast.fail("Could not save audience", error instanceof ApiError ? error.message : undefined);
		} finally {
			setSaving(false);
		}
	}

	return <Modal open={open} onClose={onClose} title="Save audience" description={`${contactIds.length} selected contacts will be reusable in future campaigns.`}>
		<form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
			<Field label="Audience name"><Input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="Newsletter subscribers" /></Field>
			<div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!name.trim() || saving}>{saving ? "Saving…" : "Save audience"}</Button></div>
		</form>
	</Modal>;
}

function campaignTone(state: Campaign["state"]): "wait" | "ok" | "fail" | "neutral" {
	if (state === "completed") return "ok";
	if (state === "cancelled") return "neutral";
	if (state === "queued" || state === "sending") return "wait";
	return "fail";
}

function CampaignComposer({
	open,
	contactIds,
	onClose,
	onSent,
}: {
	open: boolean;
	contactIds: string[];
	onClose: () => void;
	onSent: () => void;
}) {
	const toast = useToast();
	const mailboxes = useMailboxes();
	const templates = useList<Template>(qk.templates, "/api/templates");
	const audiences = useList<Audience>(qk.audiences, "/api/contacts/audiences");
	const sendable = (mailboxes.data ?? []).filter((mailbox) => canSend(mailbox.permission));
	const [mailboxId, setMailboxId] = useState("");
	const selectedMailboxId = mailboxId || sendable[0]?.id || "";
	const [subject, setSubject] = useState("");
	const [body, setBody] = useState({ html: "", text: "" });
	const [templateId, setTemplateId] = useState("none");
	const [audienceId, setAudienceId] = useState("none");
	const [editorKey, setEditorKey] = useState(0);
	const [confirmed, setConfirmed] = useState(false);
	const [sending, setSending] = useState(false);

	function useTemplate(id: string) {
		setTemplateId(id);
		if (id === "none") return;
		const template = templates.data?.find((entry) => entry.id === id);
		if (!template) return;
		setSubject(template.subject);
		setBody({ html: template.bodyHtml ?? textToHtml(template.bodyText), text: template.bodyText });
		setEditorKey((key) => key + 1);
	}

	async function submit() {
		setSending(true);
		try {
			const result = await api.post<CampaignResult>("/api/send/campaigns", {
				mailboxId: selectedMailboxId,
				contactIds: audienceId === "none" ? contactIds : [],
				...(audienceId === "none" ? {} : { audienceId }),
				subject,
				bodyText: body.text,
				bodyHtml: body.html || null,
			});
			const skipped = result.skippedBlocked + result.skippedMissing + (result.skippedUnsubscribed ?? 0);
			toast.ok(`Queued ${result.queued} private email${result.queued === 1 ? "" : "s"}${skipped ? `; skipped ${skipped}` : ""}`);
			onSent();
		} catch (error) {
			toast.fail("Could not queue campaign", error instanceof ApiError ? error.message : undefined);
		} finally {
			setSending(false);
		}
	}

	return (
		<Modal
			open={open}
			onClose={onClose}
			title="New campaign"
			description={`${contactIds.length} selected contact${contactIds.length === 1 ? "" : "s"}. Each receives an individual email and cannot see the other recipients.`}
			className="sm:max-w-6xl"
		>
			<form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
				<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
					<div className="space-y-4">
						<Field label="From">
							<Choice
								value={selectedMailboxId}
								onChange={setMailboxId}
								options={sendable.map((mailbox) => ({ value: mailbox.id, label: mailbox.displayName ? `${mailbox.displayName} <${mailbox.address}>` : mailbox.address }))}
								placeholder="Choose a mailbox"
								required
							/>
						</Field>
						<Field label="Audience" hint="Unsubscribed and blocked contacts are always excluded.">
							<Choice value={audienceId} onChange={setAudienceId} options={[{ value: "none", label: `Selected contacts (${contactIds.length})` }, ...(audiences.data ?? []).map((audience) => ({ value: audience.id, label: `${audience.name} (${audience.memberCount})` }))]} />
						</Field>
						<Field label="Start from a template" hint="Template images are not available in campaigns yet.">
							<Choice
								value={templateId}
								onChange={useTemplate}
								options={[{ value: "none", label: "Blank campaign" }, ...(templates.data ?? []).map((template) => ({ value: template.id, label: template.name }))]}
							/>
						</Field>
						<Field label="Subject"><Input required maxLength={300} value={subject} onChange={(event) => setSubject(event.target.value)} /></Field>
						<Field label="Message">
							<MailyEditor key={editorKey} initialHtml={body.html} onChange={(html, text) => setBody({ html, text })} ariaLabel="Campaign message" density="compact" className="rounded-panel border border-seam px-3" />
						</Field>
					</div>
					<div className="min-w-0 lg:sticky lg:top-0 lg:self-start">
						<p className="mb-2 text-sm font-medium text-ink">Live preview</p>
						<div className="overflow-hidden rounded-panel border border-seam bg-white">
							<p className="border-b border-seam px-4 py-3 text-sm font-medium text-black">{subject.trim() || "(No subject)"}</p>
							<EmailFrame title="Campaign preview" html={body.html || textToHtml(body.text)} />
						</div>
					</div>
				</div>
				<label className="flex items-start gap-2.5 text-sm text-ink-2">
					<Checkbox checked={confirmed} onCheckedChange={(checked) => setConfirmed(checked === true)} aria-label="Confirm campaign recipients" />
					<span>I confirm that these contacts expect this email and I want to queue {contactIds.length} individual deliveries.</span>
				</label>
				<div className="flex justify-end gap-2 pt-2">
					<Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
					<Button type="submit" disabled={!confirmed || !selectedMailboxId || !subject.trim() || !body.text.trim() || sending}>
						<Mail className="size-3.5" />
						{sending ? "Queueing…" : `Queue ${contactIds.length} emails`}
					</Button>
				</div>
			</form>
		</Modal>
	);
}
