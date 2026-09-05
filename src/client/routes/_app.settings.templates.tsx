import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/client/components/app/button";
import { Input, Textarea } from "@/client/components/ui";
import { Modal } from "@/client/components/app/modal";
import { Card, Empty, Field } from "@/client/components/app/primitives";
import { useToast } from "@/client/components/app/toast-host";
import { useCreate, useList, useRemove } from "@/client/lib/queries/crud";
import { qk } from "@/client/lib/queries/keys";

export const Route = createFileRoute("/_app/settings/templates")({ component: Templates });

type Template = { id: string; name: string; subject: string; bodyText: string };

function Templates() {
	const toast = useToast();
	const [open, setOpen] = useState(false);

	const templates = useList<Template>(qk.templates, "/api/templates");
	const create = useCreate<Record<string, unknown>, Template>(qk.templates, "/api/templates");
	const remove = useRemove(qk.templates, (id) => `/api/templates/${id}`);

	return (
		<div className="space-y-5">
			<header className="flex items-end justify-between gap-4">
				<div>
					<h2 className="display text-base">Templates</h2>
					<p className="mt-1 max-w-prose text-sm text-ink-2">
						Replies you send often, kept ready to drop into a message.
					</p>
				</div>
				<Button size="sm" onClick={() => setOpen(true)}>
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
								<Button
									size="icon"
									variant="ghost"
									aria-label={`Delete ${template.name}`}
									className="hover:text-fail"
									onClick={() =>
										remove.mutate(template.id, { onSuccess: () => toast.ok("Template deleted") })
									}
								>
									<Trash2 className="size-3.5" />
								</Button>
							</li>
						))}
					</ul>
				</Card>
			) : (
				<Empty title="No templates" body="Save a reply you write often and reuse it in one click." />
			)}

			<Modal open={open} onClose={() => setOpen(false)} title="New template">
				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						const form = new FormData(event.currentTarget);
						create.mutate(
							{
								name: String(form.get("name")),
								subject: String(form.get("subject")),
								bodyText: String(form.get("bodyText")),
							},
							{
								onSuccess: () => {
									toast.ok("Template saved");
									setOpen(false);
								},
							},
						);
					}}
				>

					<Field label="Name">
						<Input name="name" required maxLength={80} />
					</Field>
					<Field label="Subject">
						<Input name="subject" maxLength={300} />
					</Field>
					<Field label="Message">
						<Textarea name="bodyText" rows={6} />
					</Field>

					<div className="flex justify-end gap-2 pt-2">
						<Button type="button" variant="secondary" onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button type="submit">Save template</Button>
					</div>
				</form>
			</Modal>
		</div>
	);
}
