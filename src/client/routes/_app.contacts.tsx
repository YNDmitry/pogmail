import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Ban, Search, Trash2 } from "lucide-react";
import { Button } from "@/client/components/app/button";
import { Input } from "@/client/components/ui";
import { Card, Empty, Machine, PageHeader, Tag } from "@/client/components/app/primitives";
import { useToast } from "@/client/components/app/toast-host";
import { Loader } from "@/client/components/motion/loader";
import { useList, useRemove, useUpdate } from "@/client/lib/queries/crud";
import { qk } from "@/client/lib/queries/keys";
import { shortDate } from "@/client/lib/format";
import { cn } from "@/client/lib/utils";

export const Route = createFileRoute("/_app/contacts")({ component: Contacts });

type Contact = {
	id: string;
	email: string;
	displayName: string | null;
	source: "manual" | "inbound" | "outbound";
	blocked: boolean;
	messageCount: number;
	lastSeenAt: string | null;
};

function Contacts() {
	const toast = useToast();
	const [search, setSearch] = useState("");

	const contacts = useList<Contact>(qk.contacts(), "/api/contacts", {
		search: search || undefined,
	});
	const update = useUpdate<{ blocked?: boolean }, Contact>(qk.contacts(), (id) => `/api/contacts/${id}`);
	const remove = useRemove(qk.contacts(), (id) => `/api/contacts/${id}`);

	return (
		<div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
			<PageHeader
				title="Contacts"
				description="Everyone you have exchanged mail with. Blocking an address rejects its mail at the door."
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
						{contacts.data.map((contact) => (
							<li
								key={contact.id}
								className={cn(
									"flex flex-wrap items-center gap-3 px-4 py-3",
									contact.blocked && "bg-fail-soft/40",
								)}
							>
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm font-medium text-ink">
										{contact.displayName || contact.email}
									</p>
									<Machine className="block truncate text-xs">{contact.email}</Machine>
								</div>

								<Tag tone="neutral">{contact.source}</Tag>
								{contact.blocked ? <Tag tone="fail">Blocked</Tag> : null}

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
		</div>
	);
}
