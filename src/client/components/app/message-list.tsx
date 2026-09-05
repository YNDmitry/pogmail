import { Link } from "@tanstack/react-router";
import { Archive, MailOpen, Paperclip, Star, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, Checkbox } from "@/client/components/ui";
import { Button } from "@/client/components/app/button";
import { initials, senderLabel, shortDate } from "@/client/lib/format";
import { cn } from "@/client/lib/utils";
import type { MessageSummary } from "@/shared/contract/mail";

/**
 * The scan column.
 *
 * An operator reads three things in one pass — who it is from, what it is about,
 * and when — so those three carry the contrast and everything else recedes. The
 * avatar is what the eye lands on first while scrolling, the unread row is the
 * only one set in full ink, and the actions a row needs are on the row itself
 * rather than in a menu two clicks away.
 */
export function MessageList({
	messages,
	folder,
	selectedId,
	/** Ids ticked for a bulk action; empty until the first checkbox is used. */
	picked,
	/** How many messages each thread holds; empty unless reading conversations. */
	threadSizes,
	cursorId,
	onToggleStar,
	onTogglePicked,
	onArchive,
	onTrash,
	onToggleRead,
}: {
	messages: MessageSummary[];
	folder: string;
	selectedId?: string | undefined;
	picked: ReadonlySet<string>;
	threadSizes?: ReadonlyMap<string, number>;
	cursorId?: string | undefined;
	onToggleStar: (message: MessageSummary) => void;
	onTogglePicked: (message: MessageSummary) => void;
	onArchive: (message: MessageSummary) => void;
	onTrash: (message: MessageSummary) => void;
	onToggleRead: (message: MessageSummary) => void;
}) {
	return (
		<ul>
			{messages.map((message, index) => {
				const selected = message.id === selectedId;
				const unread = !message.read;
				const isPicked = picked.has(message.id);
				const label = senderLabel(message.fromName, message.fromAddress);
				const group = groupFor(message.receivedAt);
				const showGroup = group !== groupFor(messages[index - 1]?.receivedAt);
				const size = threadSizes?.get(message.threadId) ?? 1;

				return (
					<li key={message.id} data-message={message.id}>
						{/* Mail is read in time order, so the list says which day it is on
						    rather than making every row repeat a date. */}
						{showGroup ? (
							<div className="field-label sticky top-0 z-10 border-b border-border bg-[var(--pogpin-shell-panel)] px-3.5 py-1">
								{group}
							</div>
						) : null}

						<div
							className={cn(
								"group/row relative border-b border-border transition-colors",
								selected
									? "selected-row"
									: isPicked
										? "bg-accent"
										: "hover:bg-[var(--pogpin-shell-fill-soft)]",
								// The keyboard cursor is its own state: it says where j/k is
								// without pretending a message is open.
								cursorId === message.id && !selected && "ring-1 ring-[var(--pogpin-brand-border)] ring-inset",
							)}
						>
							<Link
								{...(folder === "drafts"
									? ({ to: "/compose", search: { draftId: message.id } } as const)
									: ({
											to: "/mail/$folder/$messageId",
											params: { folder, messageId: message.id },
										} as const))}
								className="flex gap-3 py-2.5 pr-3 pl-3.5"
							>
								{/* One gutter, two states: the sender's initials — coral while the
								    message is unread — swapped for a tick on hover or while picking. */}
								<span className="relative mt-0.5 size-8 shrink-0">
									<Avatar
										className={cn(
											"size-8 border border-[var(--pogpin-shell-border)] transition-opacity",
											(isPicked || picked.size > 0) && "opacity-0",
											"group-hover/row:opacity-0",
										)}
									>
										<AvatarFallback
											className={cn(
												"text-[0.6875rem] font-semibold",
												unread
													? "bg-primary text-primary-foreground"
													: "bg-[var(--pogpin-shell-fill-strong)] text-[var(--pogpin-shell-text-soft)]",
											)}
										>
											{initials(label)}
										</AvatarFallback>
									</Avatar>

									<span
										className={cn(
											"absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover/row:opacity-100",
											(isPicked || picked.size > 0) && "opacity-100",
										)}
										onClick={(event) => {
											// The tick is inside the link, so it has to refuse the
											// navigation the link would otherwise perform.
											event.preventDefault();
											event.stopPropagation();
										}}
									>
										<Checkbox
											checked={isPicked}
											aria-label={`Select mail from ${label}`}
											onCheckedChange={() => onTogglePicked(message)}
										/>
									</span>
								</span>

								<span className="min-w-0 flex-1">
									<span className="flex items-baseline gap-2">
										<span
											className={cn(
												"min-w-0 flex-1 truncate text-[0.8125rem]",
												unread ? "font-semibold text-foreground" : "text-muted-foreground",
											)}
										>
											{label}
										</span>

										{message.hasAttachments ? (
											<Paperclip
												aria-label="Has attachments"
												className="size-3 shrink-0 text-muted-foreground"
											/>
										) : null}

										{/* The date steps aside for the actions on hover: a row is
										    either being read or being acted on. */}
										<time
											dateTime={message.receivedAt}
											className="machine shrink-0 text-[0.6875rem] text-muted-foreground group-hover/row:invisible"
										>
											{shortDate(message.receivedAt)}
										</time>
									</span>

									<span className="mt-0.5 flex items-center gap-2">
										<span
											className={cn(
												"min-w-0 flex-1 truncate text-[0.8125rem]",
												unread
													? "font-medium text-foreground"
													: "text-[var(--pogpin-shell-text-soft)]",
											)}
										>
											{message.subject || "(no subject)"}
										</span>

										{/* A conversation says how long it is; a single message says
										    nothing, because there is nothing to say. */}
										{size > 1 ? (
											<span className="machine shrink-0 rounded-full bg-[var(--pogpin-shell-fill-strong)] px-1.5 text-[0.625rem] text-[var(--pogpin-shell-text-soft)]">
												{size}
											</span>
										) : null}
									</span>

									{message.snippet ? (
										<span className="mt-0.5 block truncate text-xs text-muted-foreground">
											{message.snippet}
										</span>
									) : null}
								</span>
							</Link>

							{/*
							 * The row's own actions. Outside the link, so a click on one is not
							 * also a click through to the message, and only on hover — a list of
							 * fifty rows with five buttons each is not a list any more.
							 */}
							<div className="absolute top-1.5 right-2 flex items-center gap-0.5">
								<RowAction
									label={message.starred ? "Remove star" : "Add star"}
									pressed={message.starred}
									className={cn(
										message.starred
											? "text-wait opacity-100"
											: "opacity-0 group-hover/row:opacity-100",
									)}
									onClick={() => onToggleStar(message)}
								>
									<Star className={cn("size-3.5", message.starred && "fill-wait")} />
								</RowAction>

								<RowAction
									label={message.read ? "Mark as unread" : "Mark as read"}
									className="opacity-0 group-hover/row:opacity-100"
									onClick={() => onToggleRead(message)}
								>
									<MailOpen className="size-3.5" />
								</RowAction>

								<RowAction
									label="Archive"
									className="opacity-0 group-hover/row:opacity-100"
									onClick={() => onArchive(message)}
								>
									<Archive className="size-3.5" />
								</RowAction>

								<RowAction
									label="Move to trash"
									className="opacity-0 group-hover/row:opacity-100 hover:text-fail"
									onClick={() => onTrash(message)}
								>
									<Trash2 className="size-3.5" />
								</RowAction>
							</div>
						</div>
					</li>
				);
			})}
		</ul>
	);
}

function RowAction({
	label,
	pressed,
	className,
	children,
	onClick,
}: {
	label: string;
	pressed?: boolean;
	className?: string;
	children: React.ReactNode;
	onClick: () => void;
}) {
	return (
		<Button
			type="button"
			size="icon"
			variant="ghost"
			aria-label={label}
			title={label}
			aria-pressed={pressed}
			className={cn("size-7 text-muted-foreground transition-opacity", className)}
			onClick={onClick}
		>
			{children}
		</Button>
	);
}

const DAY_LABEL = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long" });

/** Today, yesterday, then the date — the way a mail client says "when". */
function groupFor(value: string | undefined): string {
	if (!value) return "";
	const date = new Date(value);
	const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

	if (day === today) return "Today";
	if (day === today - 86_400_000) return "Yesterday";
	if (day > today - 7 * 86_400_000) {
		return date.toLocaleDateString(undefined, { weekday: "long" });
	}
	return date.getFullYear() === now.getFullYear()
		? DAY_LABEL.format(date)
		: date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}
