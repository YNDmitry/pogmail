import {
	createFileRoute,
	Outlet,
	useNavigate,
	useParams,
	useRouterState,
	useSearch,
} from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { conversationKey } from "@/client/lib/format";
import { Archive, MailOpen, Search, Trash2, X } from "lucide-react";
import { z } from "zod";
import { Loader } from "@/client/components/motion/loader";
import { MessageList } from "@/client/components/app/message-list";
import { useConfirm } from "@/client/components/app/confirm";
import { Empty } from "@/client/components/app/primitives";
import { Input } from "@/client/components/ui";
import { Button } from "@/client/components/app/button";
import { Choice } from "@/client/components/app/choice";
import { Machine } from "@/client/components/app/primitives";
import {
	useBulkPatch,
	useDeleteMessage,
	useFolders,
	useMailboxes,
	useSession,
	useMessages,
	useMessage,
	resolveMessageRows,
	useMoveMessages,
	usePatchMessage,
	type MessageFilters,
} from "@/client/lib/queries";
import { useToast } from "@/client/components/app/toast-host";
import type { MessageStatus, MessageSummary } from "@/shared/contract/mail";

const searchSchema = z.object({
	mailboxId: z.string().optional(),
	q: z.string().optional(),
});

export const Route = createFileRoute("/_app/mail/$folder")({
	validateSearch: searchSchema,
	component: MailFolder,
});

/** Folder slugs are the URL vocabulary; statuses are storage detail. */
const FOLDER_FILTERS: Record<string, MessageFilters> = {
	inbox: { status: "received", inbox: "true" },
	starred: { starred: "true" },
	snoozed: { snoozed: "true" },
	drafts: { status: "draft" },
	sent: { status: "sent" },
	archived: { status: "archived" },
	spam: { status: "spam" },
	trash: { status: "trash" },
};

const FOLDER_TITLES: Record<string, string> = {
	inbox: "Inbox",
	starred: "Starred",
	snoozed: "Snoozed",
	drafts: "Drafts",
	sent: "Sent",
	archived: "Archive",
	spam: "Spam",
	trash: "Trash",
};

/** One frozen empty set, so a list with nothing ticked never re-renders on it. */
const EMPTY_SELECTION: ReadonlySet<string> = new Set();

const EMPTY_COPY: Record<string, { title: string; body: string }> = {
	inbox: { title: "Nothing waiting", body: "New mail for your mailboxes lands here." },
	starred: { title: "No starred mail", body: "Star a message to keep it within reach." },
	snoozed: { title: "Nothing snoozed", body: "Snoozed mail returns to the inbox at the time you pick." },
	drafts: { title: "No drafts", body: "Messages you save without sending wait here." },
	sent: { title: "Nothing sent yet", body: "Mail you send from this instance is kept here." },
	archived: { title: "Archive is empty", body: "Archiving keeps mail out of the inbox without deleting it." },
	spam: { title: "No spam", body: "Filtered mail lands here so you can check what was caught." },
	trash: { title: "Trash is empty", body: "Deleted mail waits here until you remove it for good." },
};

function MailFolder() {
	const { folder } = useParams({ from: "/_app/mail/$folder" });
	const search = useSearch({ from: "/_app/mail/$folder" });
	const navigate = useNavigate({ from: "/mail/$folder" });
	const patch = usePatchMessage();
	const client = useQueryClient();
	const bulk = useBulkPatch();
	const remove = useDeleteMessage();
	const confirm = useConfirm();
	const toast = useToast();
	const [selection, setSelection] = useState<{ scope: string; ids: Set<string> }>(() => ({
		scope: "",
		ids: new Set(),
	}));
	const [cursorId, setCursorId] = useState<string | null>(null);

	const selectedId = useRouterState({ select: (state) => state.location.pathname.split("/")[3] });

	// Typing must not fire a query per keystroke, but the term still has to reach the
	// URL so the view is shareable and survives a refresh.
	const [input, setInput] = useState({ query: search.q ?? "", value: search.q ?? "" });
	if (input.query !== (search.q ?? "")) {
		setInput({ query: search.q ?? "", value: search.q ?? "" });
	}
	const term = input.query === (search.q ?? "") ? input.value : search.q ?? "";
	const setTerm = (value: string) => setInput({ query: search.q ?? "", value });
	useEffect(() => {
		const timer = setTimeout(() => {
			if ((search.q ?? "") === term) return;
			void navigate({ search: (prev) => ({ ...prev, q: term || undefined }), replace: true });
		}, 250);
		return () => clearTimeout(timer);
	}, [term, search.q, navigate]);

	const filters: MessageFilters = {
		...(FOLDER_FILTERS[folder] ?? { folderId: folder }),
		...(search.mailboxId ? { mailboxId: search.mailboxId } : {}),
		...(search.q ? { search: search.q } : {}),
	};

	const messages = useMessages(filters);
	const session = useSession();
	// Drafts and permanent deletion stay explicitly per-message.
	const conversations = session.data?.mailLayout === "conversations" && folder !== "drafts" && folder !== "trash";
	const moveMessages = useMoveMessages(conversations);
	const selectedMessage = useMessage(conversations ? selectedId : undefined);
	const selectedConversationKey = selectedMessage.data ? conversationKey(selectedMessage.data) : undefined;

	/*
	 * Conversation mode collapses a thread into its newest message and counts the
	 * rest. The grouping is over the page that is loaded, not the whole folder —
	 * a thread whose older half is on the next page is counted when that page
	 * arrives, which is the honest trade for not asking the database to group.
	 */
	const { items, threadSizes } = useMemo(() => {
		const page = [...new Map((messages.data?.pages.flatMap((entry) => entry.items) ?? [])
			.map((message) => [message.id, message])).values()];
		if (!conversations) return { items: page, threadSizes: new Map<string, number>() };

		const heads = new Map<string, MessageSummary>();
		const sizes = new Map<string, number>();
		for (const message of page) {
			const key = conversationKey(message);
			const head = heads.get(key);
			sizes.set(key, (sizes.get(key) ?? 0) + 1);

			if (!head) {
				heads.set(key, message);
				continue;
			}

			// The row shows the newest message, but carries the thread's state: one
			// unread message makes the conversation unread, one star stars it.
			heads.set(key, {
				...(new Date(message.receivedAt) > new Date(head.receivedAt) ? message : head),
				read: head.read && message.read,
				starred: head.starred || message.starred,
				hasAttachments: head.hasAttachments || message.hasAttachments,
			});
		}

		return {
			items: [...heads.values()].toSorted(
				(a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
			),
			threadSizes: sizes,
		};
	}, [messages.data, conversations]);

	/*
	 * A tick belongs to the list on screen. Rather than clearing it from an effect
	 * when the folder, mailbox or search term changes, the selection carries the
	 * list it was made in: a selection from another list is simply not this one's.
	 */
	const scope = JSON.stringify([folder, search.mailboxId, search.q, conversations]);
	const picked = selection.scope === scope ? selection.ids : EMPTY_SELECTION;
	const mailboxes = useMailboxes();
	const folders = useFolders();
	const customFolder = (folders.data ?? []).find((entry) => entry.id === folder) ?? null;
	const filtered = (mailboxes.data ?? []).find((mailbox) => mailbox.id === search.mailboxId) ?? null;
	const title = FOLDER_TITLES[folder] ?? customFolder?.name ?? "Folder";
	const empty = EMPTY_COPY[folder] ?? { title: "Nothing here", body: "Move mail here to keep it out of the inbox." };
	const pickedMessages = items.filter((message) => picked.has(message.id));
	const selectedMailboxId = pickedMessages[0]?.mailboxId;
	const canMoveSelection = Boolean(
		selectedMailboxId && pickedMessages.every((message) => message.mailboxId === selectedMailboxId),
	);
	const moveTargets = canMoveSelection
		? [
				{ value: "inbox", label: "Inbox" },
				...(folders.data ?? [])
					.filter((entry) => entry.mailboxId === selectedMailboxId)
					.map((entry) => ({ value: entry.id, label: entry.name })),
			]
		: [];

	/*
	 * One place decides what an action means, so the row buttons, the bulk bar and
	 * the keyboard cannot drift apart.
	 */
	async function act(
		ids: string[],
		change: { status?: MessageStatus; read?: boolean; starred?: boolean; folderId?: string | null },
		said: string,
	) {
		if (ids.length === 0) return;
		if (change.status) {
			void moveMessages(items.filter((row) => ids.includes(row.id)), { status: change.status, folderId: change.folderId ?? null }, said)
				.then(() => setSelection({ scope, ids: new Set() })).catch(() => {});
			return;
		}
		let rows: MessageSummary[];
		try {
			rows = await resolveMessageRows(client, items.filter((row) => ids.includes(row.id)), conversations);
		} catch (error) {
			toast.fail("Could not load the conversation", error instanceof Error ? error.message : undefined);
			return;
		}
		try {
			if (rows.length === 1) await patch.mutateAsync({ id: rows[0]!.id, patch: change });
			else if (rows.length) await bulk.mutateAsync({ ids: rows.map((row) => row.id), ...change });
			else return;
			toast.ok(said);
			setSelection({ scope, ids: new Set() });
		} catch { /* Mutation errors are reported by the shared hooks. */ }
	}

	function askPermanentDelete(ids: string[]) {
		if (folder !== "trash" || ids.length === 0) return;
		confirm.ask({
			title: ids.length === 1 ? "Delete this message for good?" : `Delete ${ids.length} messages for good?`,
			description: "These messages, their attachments and stored MIME data will be permanently removed. This cannot be undone.",
			confirmLabel: ids.length === 1 ? "Delete for good" : "Delete all permanently",
			onConfirm: () => {
				void Promise.all(ids.map((id) => remove.mutateAsync(id))).then(() => {
					setSelection({ scope, ids: new Set() });
					toast.ok(ids.length === 1 ? "Deleted permanently" : `${ids.length} messages deleted permanently`);
				}).catch(() => {});
			},
		});
	}

	function toggle(id: string) {
		setSelection((current) => {
			const ids = new Set(current.scope === scope ? current.ids : []);
			if (ids.has(id)) ids.delete(id);
			else ids.add(id);
			return { scope, ids };
		});
	}

	/*
	 * The keys a mail client is expected to answer to: j/k walk the list, Enter
	 * opens, e archives, # trashes, s stars, u flips read, x ticks. They stand
	 * down while anything is being typed into.
	 */
	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			const target = event.target as HTMLElement | null;
			if (target?.closest("input, textarea, select, button, [role=button], [role=dialog], [contenteditable=true]")) return;
			if (event.key === "Enter" && target?.closest("a")) return;
			if (items.length === 0) return;

			const index = items.findIndex((item) => item.id === (cursorId ?? selectedId) || (!cursorId && selectedConversationKey === conversationKey(item)));
			const current = items[index] ?? items[0];
			if (!current) return;

			const key = event.key.toLowerCase();
			const move = (delta: number) => {
				const next = items[Math.max(0, Math.min(items.length - 1, index + delta))];
				if (!next) return;
				setCursorId(next.id);
				// A cursor that walks off the bottom of the viewport is not a cursor.
				document
					.querySelector(`[data-message="${next.id}"]`)
					?.scrollIntoView({ block: "nearest" });
			};

			if (key === "j" || event.key === "ArrowDown") move(index < 0 ? 0 : 1);
			else if (key === "k" || event.key === "ArrowUp") move(-1);
			else if (event.key === "Enter") {
				void navigate({
					to: "/mail/$folder/$messageId",
					params: { folder, messageId: current.id },
					search: (prev) => prev,
				});
			} else if (key === "e") act(pickedOr(current.id), { status: "archived", folderId: null }, "Archived");
			else if (key === "#") {
				if (folder === "trash") askPermanentDelete(pickedOr(current.id));
				else act(pickedOr(current.id), { status: "trash", folderId: null }, "Moved to trash");
			}
			else if (key === "s") act([current.id], { starred: !current.starred }, current.starred ? "Star removed" : "Starred");
			else if (key === "u") act(pickedOr(current.id), { read: !current.read }, current.read ? "Marked unread" : "Marked read");
			else if (key === "x") toggle(current.id);
			else return;

			event.preventDefault();
		}

		function pickedOr(id: string): string[] {
			return picked.size > 0 ? [...picked] : [id];
		}

		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
		// No dependency list on purpose: the handler closes over the list, the
		// cursor and the selection, all of which change together, and re-binding one
		// listener is cheaper than the bookkeeping to avoid it.
	});

	return (
		<div className="-m-3 grid h-[calc(100%+1.5rem)] grid-cols-1 sm:-m-5 sm:h-[calc(100%+2.5rem)] lg:-mx-6 lg:grid-cols-[minmax(20rem,24rem)_1fr]">
			{/*
			 * The same surface as the panel it sits in — `--card` is a shade lighter,
			 * which read as a seam between the list and the bar above it. The column is
			 * separated by its border, not by a second tone.
			 */}
			<section
				className={`${selectedId ? "hidden lg:flex" : "flex"} min-h-0 min-w-0 flex-col border-r border-border bg-[var(--pogpin-shell-panel)]`}
			>
				<header className="space-y-3 border-b border-border px-3.5 pt-3.5 pb-3">
					{/*
					 * The shell's bar already says which folder this is, so this row is
					 * for the list itself: how much of it there is, and — once anything is
					 * ticked — what can be done to the selection.
					 */}
					{picked.size > 0 ? (
						<div className="space-y-2 sm:flex sm:flex-wrap sm:items-center sm:gap-1.5 sm:space-y-0">
							<div className="flex items-center justify-between gap-2 sm:contents">
								<span className="machine text-xs text-muted-foreground">
									{picked.size} selected
								</span>
								<Button
									size="sm"
									variant="ghost"
									className="text-muted-foreground sm:order-last sm:ml-auto"
									onClick={() => setSelection({ scope, ids: new Set() })}
								>
									Clear
								</Button>
							</div>
							<div className="flex flex-wrap items-center gap-1">
								<Button
									size="sm"
									variant="ghost"
									onClick={() => act([...picked], { read: true }, "Marked read")}
								>
									<MailOpen className="size-3.5" />
									Read
								</Button>
								<Button
									size="sm"
									variant="ghost"
									onClick={() => act([...picked], { status: "archived", folderId: null }, "Archived")}
								>
									<Archive className="size-3.5" />
									Archive
								</Button>
								<Button
									size="sm"
									variant="ghost"
									className="hover:text-fail"
									onClick={() => act([...picked], { status: "trash", folderId: null }, "Moved to trash")}
								>
									<Trash2 className="size-3.5" />
									Trash
								</Button>
								{folder === "trash" ? (
									<Button
										size="sm"
										variant="ghost"
										className="text-fail hover:text-fail"
										onClick={() => askPermanentDelete([...picked])}
									>
										<Trash2 className="size-3.5" />
										Delete permanently
									</Button>
								) : null}
							</div>
							{moveTargets.length > 0 ? (
								<Choice
									placeholder="Move to…"
									aria-label="Move selected mail to a folder"
									size="sm"
									className="w-full min-w-32 sm:w-auto"
									options={moveTargets}
									onChange={(folderId) =>
										act(
											[...picked],
											folderId === "inbox"
												? { status: "received", folderId: null }
												: { status: "received", folderId },
											folderId === "inbox" ? "Moved to inbox" : "Moved to folder",
										)
									}
								/>
							) : null}
						</div>
					) : (
						<div className="flex items-baseline justify-between gap-3">
							<span className="text-[0.8125rem] font-medium text-foreground">
								{title}
							</span>
							{messages.data ? (
								<span className="machine text-[0.6875rem] text-muted-foreground">
									{items.length}{messages.hasNextPage ? "+" : ""}
									{search.q ? " found" : ""}
								</span>
							) : null}
						</div>
					)}

					{/*
					 * The filter is set in the sidebar, which is a sheet on small screens —
					 * so the list says what it is showing, and can drop the filter itself.
					 */}
					{filtered ? (
						<div className="pogpin-shell-chip flex w-fit items-center gap-1.5 rounded-full py-0.5 pr-0.5 pl-2.5 text-[0.6875rem]">
							<Machine className="text-[0.6875rem] text-foreground">{filtered.address}</Machine>
							<Button
								type="button"
								size="icon"
								variant="ghost"
								aria-label="Show every mailbox"
								className="size-5"
								onClick={() =>
									void navigate({ search: (prev) => ({ ...prev, mailboxId: undefined }) })
								}
							>
								<X className="size-3" />
							</Button>
						</div>
					) : null}

					<div className="relative">
						<Search
							aria-hidden
							className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3"
						/>
						<Input
							type="search"
							value={term}
							onChange={(event) => setTerm(event.target.value)}
							placeholder="Search mail"
							aria-label="Search mail"
							className="h-9 pl-8 text-base md:text-[0.8125rem]"
							aria-describedby="mail-search-help"
						/>
					</div>
					<p id="mail-search-help" className="text-xs text-muted-foreground">Search text, from:sender, has:attachment or is:unread.</p>
				</header>

				<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
					{messages.isError && messages.data ? (
						<div role="alert" className="space-y-2 border-b border-border p-3.5 text-sm">
							<p>{messages.isFetchNextPageError ? "Could not load more mail" : "Could not refresh mail"}</p>
							<Button size="sm" variant="secondary" disabled={messages.isFetching} onClick={() => {
								void (messages.isFetchNextPageError ? messages.fetchNextPage() : messages.refetch());
							}}>{messages.isFetchNextPageError ? "Retry loading more" : "Retry"}</Button>
						</div>
					) : null}
					{messages.fetchStatus === "paused" ? <p role="status" className="p-3.5 text-sm text-muted-foreground">Offline. Mail will refresh when you reconnect.</p> : null}
					{messages.isError && !messages.data ? (
						<Empty title="Could not load mail" body={messages.error.message}
							action={<Button variant="secondary" disabled={messages.isFetching} onClick={() => void messages.refetch()}>Retry</Button>} />
					) : messages.isPending ? (
						<div className="grid place-items-center py-16">
							<Loader />
						</div>
					) : items.length ? (
						<MessageList
							messages={items}
							folder={folder}
							selectedId={selectedId}
							selectedConversationKey={selectedConversationKey}
							picked={picked}
							threadSizes={threadSizes}
							cursorId={cursorId ?? undefined}
							onToggleStar={(message) =>
								void act([message.id], { starred: !message.starred }, message.starred ? "Star removed" : "Starred")
							}
							onTogglePicked={(message) => toggle(message.id)}
							onArchive={(message) => act([message.id], { status: "archived", folderId: null }, "Archived")}
							onTrash={(message) => act([message.id], { status: "trash", folderId: null }, "Moved to trash")}
							onDelete={folder === "trash" ? (message) => askPermanentDelete([message.id]) : undefined}
							onToggleRead={(message) =>
								act([message.id], { read: !message.read }, message.read ? "Marked unread" : "Marked read")
							}
						/>
					) : search.q ? (
						<Empty
							title="Nothing matched"
							body={`No mail in ${title.toLowerCase()} matches \u201c${search.q}\u201d.`}
							action={
								<Button
									size="sm"
									variant="secondary"
									onClick={() => {
										setTerm("");
										void navigate({ search: (prev) => ({ ...prev, q: undefined }) });
									}}
								>
									Clear the search
								</Button>
							}
						/>
					) : (
						<Empty title={empty.title} body={empty.body} />
					)}
					{messages.hasNextPage && !messages.isError ? (
						<div className="p-3.5"><Button variant="secondary" className="w-full" disabled={messages.isFetching} onClick={() => void messages.fetchNextPage()}>
							{messages.isFetchingNextPage ? "Loading…" : "Load more"}
						</Button></div>
					) : null}
				</div>
			</section>

			<section data-reader-scroll aria-label="Message reader"
				className={`${selectedId ? "block" : "hidden"} min-h-0 overflow-y-auto lg:block`}
			>
				<Outlet />
			</section>

			{confirm.dialog}
		</div>
	);
}
