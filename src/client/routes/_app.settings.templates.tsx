import { useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Copy, Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/client/components/app/button";
import { Input } from "@/client/components/ui";
import { MailyEditor } from "@/client/components/app/maily-editor";
import { Modal } from "@/client/components/app/modal";
import { Card, Empty, Field } from "@/client/components/app/primitives";
import { useToast } from "@/client/components/app/toast-host";
import { useCreate, useList, useRemove, useUpdate } from "@/client/lib/queries/crud";
import { qk } from "@/client/lib/queries/keys";
import { textToHtml } from "@/client/lib/mail-html";

export const Route = createFileRoute("/_app/settings/templates")({ component: Templates });

type Template = { id: string; name: string; subject: string; bodyText: string; bodyHtml: string | null };
type Draft = Omit<Template, "id"> & { id?: string };

function emptyDraft(): Draft {
	return { name: "", subject: "", bodyText: "", bodyHtml: null };
}

function Templates() {
	const toast = useToast();
	const [draft, setDraft] = useState<Draft | null>(null);
	const [preview, setPreview] = useState<Template | null>(null);
	const [editorKey, setEditorKey] = useState(0);
	const templates = useList<Template>(qk.templates, "/api/templates");
	const create = useCreate<Draft, Template>(qk.templates, "/api/templates");
	const update = useUpdate<Draft, Template>(qk.templates, (id) => `/api/templates/${id}`);
	const remove = useRemove(qk.templates, (id) => `/api/templates/${id}`);

	function open(template?: Template, duplicate = false) {
		setDraft(
			template
				? { ...(duplicate ? { ...template, id: undefined, name: `Copy of ${template.name}` } : template) }
				: emptyDraft(),
		);
		setEditorKey((key) => key + 1);
	}

	return (
		<div className="space-y-5">
			<header className="flex items-end justify-between gap-4">
				<div>
					<h2 className="display text-base">Templates</h2>
					<p className="mt-1 max-w-prose text-sm text-ink-2">Replies you send often, kept ready to drop into a message.</p>
				</div>
				<Button size="sm" onClick={() => open()}>
					<Plus className="size-3.5" />
					New template
				</Button>
			</header>

			{templates.data?.length ? (
				<Card>
					<ul className="divide-y divide-seam">
						{templates.data.map((template) => (
							<li key={template.id} className="flex items-start gap-3 px-4 py-3">
								<div className="min-w-0 flex-1">
									<p className="text-sm font-medium text-ink">{template.name}</p>
									<p className="truncate text-xs text-ink-2">{template.subject}</p>
									<p className="mt-1 line-clamp-2 text-xs text-ink-3">{template.bodyText}</p>
								</div>
								<div className="flex shrink-0 items-center gap-1">
									<TemplateAction label={`Preview ${template.name}`} onClick={() => setPreview(template)}><Eye className="size-3.5" /></TemplateAction>
									<TemplateAction label={`Edit ${template.name}`} onClick={() => open(template)}><Pencil className="size-3.5" /></TemplateAction>
									<TemplateAction label={`Duplicate ${template.name}`} onClick={() => open(template, true)}><Copy className="size-3.5" /></TemplateAction>
									<TemplateAction label={`Delete ${template.name}`} className="hover:text-fail" onClick={() => remove.mutate(template.id, { onSuccess: () => toast.ok("Template deleted") })}><Trash2 className="size-3.5" /></TemplateAction>
								</div>
							</li>
						))}
					</ul>
				</Card>
			) : <Empty title="No templates" body="Save a reply you write often and reuse it in one click." />}

			<Modal open={Boolean(draft)} onClose={() => setDraft(null)} title={draft?.id ? "Edit template" : "New template"}>
				{draft ? <TemplateForm key={editorKey} draft={draft} onCancel={() => setDraft(null)} onSave={(next) => {
					if (next.id) update.mutate({ id: next.id, input: next }, { onSuccess: () => { toast.ok("Template saved"); setDraft(null); } });
					else create.mutate(next, { onSuccess: () => { toast.ok("Template saved"); setDraft(null); } });
				}} /> : null}
			</Modal>

			<Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.name ?? "Template preview"}>
				{preview ? <iframe title={`${preview.name} preview`} sandbox="" referrerPolicy="no-referrer" className="h-[32rem] w-full rounded-panel border border-seam bg-white" srcDoc={preview.bodyHtml ?? textToHtml(preview.bodyText)} /> : null}
			</Modal>
		</div>
	);
}

function TemplateForm({ draft, onCancel, onSave }: { draft: Draft; onCancel: () => void; onSave: (draft: Draft) => void }) {
	const [body, setBody] = useState({ html: draft.bodyHtml ?? textToHtml(draft.bodyText), text: draft.bodyText });
	return <form className="space-y-4" onSubmit={(event) => {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		onSave({ id: draft.id, name: String(form.get("name")), subject: String(form.get("subject")), bodyText: body.text, bodyHtml: body.html || null });
	}}>
		<Field label="Name"><Input name="name" required maxLength={80} defaultValue={draft.name} /></Field>
		<Field label="Subject"><Input name="subject" maxLength={300} defaultValue={draft.subject} /></Field>
		<Field label="Message" hint="Formatting and slash commands are kept when the template is inserted.">
			<MailyEditor initialHtml={body.html} onChange={(html, text) => setBody({ html, text })} ariaLabel="Template message" density="compact" className="rounded-panel border border-seam px-3" />
		</Field>
		<div className="flex justify-end gap-2 pt-2">
			<Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
			<Button type="submit">Save template</Button>
		</div>
	</form>;
}

function TemplateAction({
	label,
	children,
	className,
	onClick,
}: {
	label: string;
	children: ReactNode;
	className?: string;
	onClick: () => void;
}) {
	return <Button size="icon" variant="ghost" aria-label={label} title={label} className={className} onClick={onClick}>{children}</Button>;
}
