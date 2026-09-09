import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import {
	Archive,
	CalendarPlus,
	CornerUpLeft,
	Download,
	MailWarning,
	Paperclip,
	Star,
	Timer,
	Trash2,
} from "lucide-react";
import { Button } from "@/client/components/app/button";
import { Machine, Tag } from "@/client/components/app/primitives";
import { Modal } from "@/client/components/app/modal";
import { ReplyBox } from "@/client/components/app/reply-box";
import { useToast } from "@/client/components/app/toast-host";
import { Loader } from "@/client/components/motion/loader";
import { api } from "@/client/lib/api";
import { bytes, fullDate, initials, senderLabel } from "@/client/lib/format";
import {
	useDeleteMessage,
	useMailboxes,
	useMessage,
	usePatchMessage,
	useSession,
	useThread,
} from "@/client/lib/queries";
import { canSend } from "@/shared/contract/permissions";
import { cn } from "@/client/lib/utils";
import type { Attachment, MessageStatus, MessageSummary } from "@/shared/contract/mail";

export const Route = createFileRoute("/_app/mail/$folder/$messageId")({ component: Reader });

/*
 * Each option resolves to a real moment rather than an offset dressed up as one.
 * "Tomorrow morning" used to be `+20h`, which from breakfast meant tonight and
 * from midnight meant tomorrow evening — the label was a guess about when the
 * reader happened to be reading.
 */
const SNOOZE_OPTIONS: { label: string; at: () => Date }[] = [
	{
		label: "In 3 hours",
		at: () => new Date(Date.now() + 3 * 3_600_000),
	},
	{
		label: "Tomorrow",
		at: () => {
			const when = new Date();
			when.setDate(when.getDate() + 1);
			when.setHours(9, 0, 0, 0);
			return when;
		},
	},
	{
		label: "Next week",
		at: () => {
			const when = new Date();
			// The next Monday, not seven days from whenever this was read.
			when.setDate(when.getDate() + ((8 - when.getDay()) % 7 || 7));
			when.setHours(9, 0, 0, 0);
			return when;
		},
	},
];

const SNOOZE_FORMAT = new Intl.DateTimeFormat(undefined, {
	weekday: "short",
	day: "numeric",
	month: "short",
	hour: "2-digit",
	minute: "2-digit",
});

function Reader() {
	const { folder, messageId } = useParams({ from: "/_app/mail/$folder/$messageId" });
	const navigate = useNavigate();
	const toast = useToast();

	const session = useSession();
	const mailboxes = useMailboxes();
	const conversations = session.data?.mailLayout === "conversations";

	const [purging, setPurging] = useState(false);

	const message = useMessage(messageId);
	const thread = useThread(messageId);
	const patch = usePatchMessage();
	const remove = useDeleteMessage();

	// Opening a message is what marks it read; there is no separate action for it.
	// The ref is what keeps this to one write per message: the optimistic patch
	// updates the cache, which re-runs the effect with `read` already true.
	const marked = useRef<string | null>(null);
	useEffect(() => {
		const mail = message.data;
		if (!mail || mail.read || marked.current === mail.id) return;

		marked.current = mail.id;
		patch.mutate({ id: mail.id, patch: { read: true } });
	}, [message.data, patch]);

	const canReply = canSend(
		(mailboxes.data ?? []).find((mailbox) => mailbox.id === message.data?.mailboxId)?.permission ??
			"read_only",
	);

	const hasThread = (thread.data?.length ?? 0) > 1;

	if (message.isPending) {
		return (
			<div className="grid h-full place-items-center">
				<Loader />
			</div>
		);
	}

	if (!message.data) return null;
	const mail = message.data;
	const threadPosition = (thread.data?.findIndex((item) => item.id === mail.id) ?? -1) + 1;
	const isLatest = threadPosition > 0 && threadPosition === thread.data?.length;
	const title = conversations ? (thread.data?.[0]?.subject ?? mail.subject) : mail.subject;

	function move(status: MessageStatus, done: string) {
		patch.mutate(
			{ id: mail.id, patch: { status } },
			{
				onSuccess: () => {
					toast.ok(done);
					void navigate({ to: "/mail/$folder", params: { folder } });
				},
				onError: (error) => toast.fail("Could not move the message", String(error)),
			},
		);
	}

	return (
		<article className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-6">
			<header className="space-y-4">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<h1 className="display min-w-0 flex-1 text-xl leading-snug text-ink">
						{title || "(no subject)"}
					</h1>

					<div className="flex shrink-0 items-center gap-1">
						<IconAction
							label={mail.starred ? "Remove star" : "Add star"}
							pressed={mail.starred}
							onClick={() => patch.mutate({ id: mail.id, patch: { starred: !mail.starred } })}
						>
							<Star className={cn("size-4", mail.starred && "fill-wait text-wait")} />
						</IconAction>

						<IconAction label="Archive" onClick={() => move("archived", "Archived")}>
							<Archive className="size-4" />
						</IconAction>

						<IconAction label="Report as spam" onClick={() => move("spam", "Moved to spam")}>
							<MailWarning className="size-4" />
						</IconAction>

						{folder === "trash" ? (
							// The one irreversible action in the reader, so it asks first.
							<IconAction label="Delete permanently" destructive onClick={() => setPurging(true)}>
								<Trash2 className="size-4" />
							</IconAction>
						) : (
							<IconAction label="Move to trash" onClick={() => move("trash", "Moved to trash")}>
								<Trash2 className="size-4" />
							</IconAction>
						)}
					</div>
				</div>

				{conversations && hasThread ? (
					<p className="text-xs text-muted-foreground">
						{isLatest
							? `Viewing latest message · ${thread.data?.length} in thread`
							: `Viewing message ${threadPosition} of ${thread.data?.length} · latest is below`}
					</p>
				) : null}

				{mail.delivery ? (
					<div className="flex flex-wrap items-center gap-2 rounded-panel border border-seam bg-recess px-3 py-2 text-xs">
						<Tag tone={mail.delivery.status === "sent" ? "ok" : mail.delivery.status === "failed" ? "fail" : "wait"}>
							{mail.delivery.status === "sent" ? "Delivered" : mail.delivery.status === "failed" ? "Delivery failed" : "Sending"}
						</Tag>
						{mail.delivery.attempts > 1 ? <span className="text-ink-3">Attempt {mail.delivery.attempts}</span> : null}
						{mail.delivery.lastError ? <span className="min-w-0 truncate text-fail" title={mail.delivery.lastError}>{mail.delivery.lastError}</span> : null}
						{mail.delivery.recipients.length > 0 ? (
							<span className="text-ink-3" title={mail.delivery.recipients.map((entry) => `${entry.recipient}: ${entry.status}`).join("\n")}>
								{mail.delivery.recipients.filter((entry) => entry.status === "sent").length}/{mail.delivery.recipients.length} recipients accepted
							</span>
						) : null}
						{mail.delivery.status === "failed" ? (
							<Button size="sm" variant="secondary" className="ml-auto" onClick={async () => {
								try {
									await api.post(`/api/messages/${mail.id}/retry`, {});
									await message.refetch();
									toast.ok("Delivery retry queued");
								} catch (error) {
									toast.fail("Could not retry delivery", String(error));
								}
							}}>
								Retry delivery
							</Button>
						) : null}
					</div>
				) : null}

				<div className="flex items-start gap-3 border-b border-seam pb-4">
					<span
						aria-hidden
						className="grid size-9 shrink-0 place-items-center rounded-full bg-recess text-xs font-semibold text-ink-2"
					>
						{initials(senderLabel(mail.fromName, mail.fromAddress))}
					</span>

					<div className="min-w-0 flex-1 text-sm">
						<p className="font-medium text-ink">{senderLabel(mail.fromName, mail.fromAddress)}</p>
						<p className="truncate">
							<Machine>{mail.fromAddress}</Machine>
						</p>
						<p className="mt-1 text-xs text-ink-3">
							to{" "}
							<Machine className="text-ink-3">
								{mail.toAddresses.map((entry) => entry.address).join(", ")}
							</Machine>
						</p>
					</div>

					<time dateTime={mail.receivedAt} className="machine shrink-0 text-xs text-ink-3">
						{fullDate(mail.receivedAt)}
					</time>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					{/* Read as a conversation, the reply box at the end of the thread is
					    the reply; a second button for it would be a second answer to the
					    same question. */}
					{conversations || !canReply ? null : (
						<Button
							size="sm"
							variant="secondary"
							onClick={() =>
								void navigate({
									to: "/compose",
									search: { replyTo: mail.id },
								})
							}
						>
							<CornerUpLeft className="size-3.5" />
							Reply
						</Button>
					)}

					{/*
					 * A message that names a time is usually the only record of it. The
					 * event keeps the mailbox and the message it came from, so the two stay
					 * findable from each other.
					 */}
					<Button
						size="sm"
						variant="ghost"
						onClick={async () => {
							const start = new Date();
							start.setMinutes(0, 0, 0);
							start.setHours(start.getHours() + 1);

							try {
								await api.post("/api/calendar/events", {
									title: mail.subject || "(no subject)",
									description: (mail.bodyText ?? "").slice(0, 2000),
									mailboxId: mail.mailboxId,
									messageId: mail.id,
									startsAt: start.getTime(),
									endsAt: start.getTime() + 3_600_000,
								});
								toast.ok("Added to the calendar", "An hour from now; open it to set the time.");
							} catch (error) {
								toast.fail("Could not add the event", String(error));
							}
						}}
					>
						<CalendarPlus className="size-3.5" />
						Add to calendar
					</Button>

					{SNOOZE_OPTIONS.map((option) => {
						const when = option.at();
						return (
							<Button
								key={option.label}
								size="sm"
								variant="ghost"
								// The button says roughly when; the tooltip and the toast say
								// exactly when, so nobody has to guess what "next week" meant.
								title={`Back at ${SNOOZE_FORMAT.format(when)}`}
								onClick={() =>
									patch.mutate(
										{ id: mail.id, patch: { snoozedUntil: when.getTime() } },
										{
											onSuccess: () =>
												toast.ok("Snoozed", `Back in your inbox on ${SNOOZE_FORMAT.format(when)}.`),
										},
									)
								}
							>
								<Timer className="size-3.5" />
								{option.label}
							</Button>
						);
					})}
				</div>
			</header>

			{!conversations && hasThread ? (
				<section aria-labelledby="thread-heading" className="space-y-2">
					<div className="flex items-baseline justify-between gap-3">
						<h2 id="thread-heading" className="text-sm font-medium text-foreground">
							Thread
						</h2>
						<span className="text-xs text-muted-foreground">
							{thread.data?.length} messages · latest at top
						</span>
					</div>

					<ol className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
						{(thread.data ?? []).toReversed().map((item, index) => {
							const current = item.id === mail.id;
							return (
								<li key={item.id}>
									<Link
										to="/mail/$folder/$messageId"
										params={{ folder, messageId: item.id }}
										aria-current={current ? "page" : undefined}
										className={cn(
											"grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
											current ? "selected-row" : "hover:bg-[var(--pogpin-shell-fill-soft)]",
										)}
									>
										<span className="flex min-w-0 items-baseline gap-2">
											<span className="truncate font-medium text-foreground">
												{senderLabel(item.fromName, item.fromAddress)}
											</span>
											{index === 0 ? (
												<span className="shrink-0 text-[0.6875rem] text-muted-foreground">Latest</span>
											) : null}
											{current ? (
												<span className="shrink-0 text-[0.6875rem] font-medium text-primary">Open</span>
											) : null}
										</span>
										<time
											dateTime={item.receivedAt}
											className="machine shrink-0 text-[0.6875rem] text-muted-foreground"
										>
											{fullDate(item.receivedAt)}
										</time>
										<span className="col-span-2 mt-0.5 truncate text-xs text-muted-foreground">
											{item.snippet || "No preview"}
										</span>
									</Link>
								</li>
							);
						})}
					</ol>
				</section>
			) : null}

			{mail.attachments.length > 0 ? (
				<section className="space-y-2">
					<h2 className="field-label">
						{mail.attachments.length} attachment{mail.attachments.length === 1 ? "" : "s"}
					</h2>
					<ul className="grid gap-2 sm:grid-cols-2">
						{mail.attachments.map((attachment) => (
							<li key={attachment.id}>
								<a
									href={`/api/messages/${mail.id}/attachments/${attachment.id}`}
									className="flex items-center gap-2 rounded-panel border border-seam bg-panel px-3 py-2 text-sm transition-colors hover:border-primary"
								>
									<Paperclip aria-hidden className="size-4 shrink-0 text-ink-3" />
									<span className="min-w-0 flex-1 truncate">{attachment.filename}</span>
									<Machine className="shrink-0 text-xs">{bytes(attachment.sizeBytes)}</Machine>
									<Download aria-hidden className="size-3.5 shrink-0 text-ink-3" />
								</a>
							</li>
						))}
					</ul>
				</section>
			) : null}

			<MessageBody html={mail.bodyHtml} text={mail.bodyText} messageId={mail.id} attachments={mail.attachments} />

			<footer className="flex flex-wrap items-center gap-3 border-t border-seam pt-4 text-xs text-ink-3">
				<Tag tone={mail.direction === "inbound" ? "accent" : "neutral"}>
					{mail.direction === "inbound" ? "Received" : "Sent"}
				</Tag>
				{mail.messageId ? <Machine className="truncate text-[0.6875rem]">{mail.messageId}</Machine> : null}
				<a
					href={`/api/mail/export/${mail.id}/eml`}
					className="ml-auto underline underline-offset-2 hover:text-ink-2"
				>
					Download original
				</a>
			</footer>

			{conversations && hasThread ? (
				/*
				 * Read as a conversation, the thread is the page: the messages either
				 * side of this one are laid out in order, mine on the right and theirs
				 * on the left, so a back-and-forth reads as one.
				 */
				<section aria-labelledby="conversation-thread-heading" className="space-y-2">
					<div className="flex items-baseline justify-between gap-3">
						<h2 id="conversation-thread-heading" className="text-sm font-medium text-foreground">
							Thread
						</h2>
						<span className="text-xs text-muted-foreground">
							{thread.data?.length ?? 0} messages · oldest → latest
						</span>
					</div>
					<ol className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
						{(thread.data ?? []).map((item, index, items) => (
							<li key={item.id}>
								<ThreadRow
									item={item}
									folder={folder}
									current={item.id === mail.id}
									latest={index === items.length - 1}
								/>
							</li>
						))}
					</ol>
				</section>
			) : null}

			<Modal
				open={purging}
				onClose={() => setPurging(false)}
				title="Delete this message for good?"
				description="It leaves the trash, the search index and the storage bucket. This cannot be undone."
			>
				<div className="flex justify-end gap-2">
					<Button type="button" variant="secondary" onClick={() => setPurging(false)}>
						Keep it
					</Button>
					<Button
						type="button"
						className="bg-fail text-primary-foreground hover:bg-fail/90"
						onClick={() =>
							remove.mutate(mail.id, {
								onSuccess: () => {
									setPurging(false);
									toast.ok("Deleted permanently");
									void navigate({ to: "/mail/$folder", params: { folder } });
								},
							})
						}
					>
						<Trash2 className="size-3.5" />
						Delete for good
					</Button>
				</div>
			</Modal>

			{/*
			 * A shared mailbox can be readable without being sendable-from, and the
			 * old reply paths let someone write the whole answer before the server
			 * refused it. The box is only offered where the answer can actually go.
			 */}
			{conversations && mail.status !== "draft" ? (
				canReply ? (
					<ReplyBox
						mailboxId={mail.mailboxId}
						to={mail.replyTo ?? mail.fromAddress}
						subject={mail.subject}
						inReplyTo={mail.messageId}
						threadId={mail.threadId}
						replyToId={mail.id}
					/>
				) : (
					<p className="rounded-xl border border-border bg-[var(--pogpin-shell-panel-alt)] px-3 py-2 text-xs text-muted-foreground">
						You can read this mailbox, but not send from it — ask its owner for send
						access to reply here.
					</p>
				)
			) : null}
		</article>
	);
}

/**
 * HTML mail is hostile by default: remote images track the reader and scripts are
 * scripts. It renders inside a sandboxed iframe with no origin and no script
 * execution, so nothing in a message can reach the app or the network.
 */
function MessageBody({
	html,
	text,
	messageId,
	attachments,
}: {
	html: string | null;
	text: string | null;
	messageId: string;
	attachments: Attachment[];
}) {
	if (html) {
		const body = attachments.reduce((result, attachment) => {
			if (attachment.disposition !== "inline" || !attachment.contentId) return result;
			return result.replaceAll(
				`cid:${attachment.contentId}`,
				`/api/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachment.id)}`,
			);
		}, html);
		return (
			<iframe
				title="Message body"
				sandbox=""
				referrerPolicy="no-referrer"
				className="min-h-96 w-full rounded-panel border border-seam bg-white"
				srcDoc={body}
			/>
		);
	}

	return (
		<div className="text-sm leading-relaxed whitespace-pre-wrap text-ink">
			{text ?? <span className="text-ink-3">This message has no body.</span>}
		</div>
	);
}

function IconAction({
	label,
	children,
	onClick,
	pressed,
	destructive,
}: {
	label: string;
	children: React.ReactNode;
	onClick: () => void;
	pressed?: boolean;
	destructive?: boolean;
}) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon"
			aria-label={label}
			title={label}
			aria-pressed={pressed}
			onClick={onClick}
			className={cn(
				"text-ink-2",
				destructive ? "hover:bg-fail-soft hover:text-fail" : "hover:text-ink",
			)}
		>
			{children}
		</Button>
	);
}

/** A stable row in the thread timeline; only its state changes when another message opens. */
function ThreadRow({
	item,
	folder,
	current,
	latest,
}: {
	item: MessageSummary;
	folder: string;
	current: boolean;
	latest: boolean;
}) {
	return (
		<Link
			to="/mail/$folder/$messageId"
			params={{ folder, messageId: item.id }}
			aria-current={current ? "page" : undefined}
			className={cn(
				"block min-w-0 px-3 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
				current ? "selected-row" : "hover:bg-[var(--pogpin-shell-fill-soft)]",
			)}
		>
			<span className="flex min-w-0 items-baseline gap-2">
				<span className="truncate text-[0.8125rem] font-medium text-foreground">
					{senderLabel(item.fromName, item.fromAddress)}
				</span>
				<span className="shrink-0 text-[0.6875rem] text-muted-foreground">
					{item.direction === "outbound" ? "Sent" : "Received"}
				</span>
				{latest ? (
					<span className="shrink-0 text-[0.6875rem] font-medium text-muted-foreground">Latest</span>
				) : null}
				{current ? (
					<span className="shrink-0 text-[0.6875rem] font-medium text-primary">Open above</span>
				) : null}
				<Machine className="ml-auto shrink-0 text-[0.6875rem]">
					{fullDate(item.receivedAt)}
				</Machine>
			</span>
			<span className="mt-1 block truncate text-sm text-[var(--pogpin-shell-text-soft)]">
				{item.snippet || "No preview"}
			</span>
		</Link>
	);
}
