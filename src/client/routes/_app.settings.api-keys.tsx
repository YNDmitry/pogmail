import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/client/components/app/button";
import { Checkbox, Input } from "@/client/components/ui";
import { Modal } from "@/client/components/app/modal";
import { Card, Empty, Field, Machine, Tag } from "@/client/components/app/primitives";
import { useToast } from "@/client/components/app/toast-host";
import { fullDate } from "@/client/lib/format";
import { useCreate, useList, useRemove } from "@/client/lib/queries/crud";
import { qk } from "@/client/lib/queries/keys";

export const Route = createFileRoute("/_app/settings/api-keys")({ component: ApiKeys });

const SCOPES = [
	"messages:read",
	"messages:send",
	"mailboxes:read",
	"mailboxes:write",
	"domains:read",
	"domains:write",
	"contacts:read",
	"contacts:write",
	"webhooks:read",
	"webhooks:write",
] as const;

type ApiKey = {
	id: string;
	name: string;
	tokenPrefix: string;
	scopes: string[];
	lastUsedAt: string | null;
	expiresAt: string | null;
	revokedAt: string | null;
	createdAt: string;
};

function ApiKeys() {
	const toast = useToast();
	const [open, setOpen] = useState(false);
	const [issued, setIssued] = useState<string | null>(null);

	const keys = useList<ApiKey>(qk.apiKeys, "/api/api-keys");
	const create = useCreate<Record<string, unknown>, { token: string }>(qk.apiKeys, "/api/api-keys");
	const revoke = useRemove(qk.apiKeys, (id) => `/api/api-keys/${id}`);

	return (
		<div className="space-y-5">
			<header className="flex items-end justify-between gap-4">
				<div>
					<h2 className="display text-base">API keys</h2>
					<p className="mt-1 max-w-prose text-sm text-ink-2">
						Keys authenticate scripts against <Machine>/api/v1</Machine>. Each one carries only the
						scopes you give it.
					</p>
				</div>
				<Button size="sm" onClick={() => setOpen(true)}>
					<Plus className="size-3.5" />
					New key
				</Button>
			</header>

			{keys.data?.length ? (
				<Card>
					<ul className="divide-y divide-seam">
						{keys.data.map((key) => (
							<li key={key.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
								<div className="min-w-0 flex-1">
									<p className="text-sm font-medium text-ink">{key.name}</p>
									<Machine className="text-xs">{key.tokenPrefix}…</Machine>
								</div>

								<div className="flex flex-wrap gap-1">
									{key.scopes.map((scope) => (
										<Tag key={scope} tone="accent">
											<span className="machine">{scope}</span>
										</Tag>
									))}
								</div>

								<span className="text-xs text-ink-3">
									{key.revokedAt
										? "Revoked"
										: key.lastUsedAt
											? `Last used ${fullDate(key.lastUsedAt)}`
											: "Never used"}
								</span>

								{!key.revokedAt ? (
									<Button
										size="sm"
										variant="ghost"
										className="hover:text-fail"
										onClick={() =>
											revoke.mutate(key.id, { onSuccess: () => toast.ok("Key revoked") })
										}
									>
										<Trash2 className="size-3.5" />
										Revoke
									</Button>
								) : null}
							</li>
						))}
					</ul>
				</Card>
			) : (
				<Empty
					title="No API keys"
					body="Create a key to let a script read mail or send on your behalf."
					action={
						<Button size="sm" onClick={() => setOpen(true)}>
							Create a key
						</Button>
					}
				/>
			)}

			<Modal open={open} onClose={() => setOpen(false)} title="New API key">
				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						const form = new FormData(event.currentTarget);
						create.mutate(
							{
								name: String(form.get("name")),
								scopes: form.getAll("scopes").map(String),
							},
							{
								onSuccess: (result) => {
									// Shown once and never again; only the hash is stored.
									setIssued(result.token);
									setOpen(false);
								},
								onError: (error) => toast.fail("Could not create the key", String(error)),
							},
						);
					}}
				>

					<Field label="Name" hint="Something you will recognise in six months.">
						<Input name="name" required maxLength={80} />
					</Field>

					<fieldset className="space-y-2">
						<legend className="field-label">Scopes</legend>
						<div className="grid grid-cols-2 gap-1.5">
							{SCOPES.map((scope) => (
								<label key={scope} className="flex items-center gap-2 text-sm">
									<Checkbox name="scopes" value={scope} />
									<span className="machine text-xs">{scope}</span>
								</label>
							))}
						</div>
					</fieldset>

					<div className="flex justify-end gap-2 pt-2">
						<Button type="button" variant="secondary" onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button type="submit">Create key</Button>
					</div>
				</form>
			</Modal>

			<Modal open={issued !== null} onClose={() => setIssued(null)} title="Copy your key now">
				<div className="space-y-4">
					<p className="text-sm text-ink-2">
						This is the only time the key is shown. Pogmail stores a hash of it, so it cannot be
						recovered later.
					</p>

					<div className="flex items-center gap-2 rounded-panel border border-seam bg-recess p-3">
						<code className="min-w-0 flex-1 break-all text-xs">{issued}</code>
						<Button
							size="icon"
							variant="secondary"
							aria-label="Copy key"
							onClick={() => {
								void navigator.clipboard.writeText(issued ?? "");
								toast.ok("Key copied");
							}}
						>
							<Copy className="size-3.5" />
						</Button>
					</div>

					<div className="flex justify-end">
						<Button onClick={() => setIssued(null)}>Done</Button>
					</div>
				</div>
			</Modal>
		</div>
	);
}
