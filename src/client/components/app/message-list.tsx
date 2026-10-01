import { Link } from "@tanstack/react-router";
import { Archive, MailOpen, Paperclip, Star, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, Checkbox } from "@/client/components/ui";
import { Button } from "@/client/components/app/button";
import { conversationKey, initials, senderLabel, shortDate } from "@/client/lib/format";
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
	selectedConversationKey,
	/** Ids ticked for a bulk action; empty until the first checkbox is used. */
	picked,
	/** How many messages each thread holds; empty unless reading conversations. */
	threadSizes,
	cursorId,
	onToggleStar,
	onTogglePicked,
	onArchive,
	onTrash,
	onDelete,
	onToggleRead,
}: {
	messages: MessageSummary[];
	folder: string;
	selectedId?: string | undefined;
	selectedConversationKey?: string | undefined;
	picked: ReadonlySet<string>;
	threadSizes?: ReadonlyMap<string, number>;
	cursorId?: string | undefined;
	onToggleStar: (message: MessageSummary) => void;
	onTogglePicked: (message: MessageSummary) => void;
	onArchive: (message: MessageSummary) => void;
	onTrash: (message: MessageSummary) => void;
	onDelete?: (message: MessageSummary) => void;
	onToggleRead: (message: MessageSummary) => void;
}) {
	return (
		<ul>
			{messages.map((message, index) => {
				const selected = message.id === selectedId || conversationKey(message) === selectedConversationKey;
				const unread = !message.read;
				const isPicked = picked.has(message.id);
				const label = senderLabel(message.fromName, message.fromAddress);
				const group = groupFor(message.receivedAt);
				const showGroup = group !== groupFor(messages[index - 1]?.receivedAt);
				const size = threadSizes?.get(conversationKey(message)) ?? 1;

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
							<span className={cn(
								"absolute top-3 left-3.5 z-10 grid size-8 place-items-center opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 max-sm:opacity-100 [@media(hover:none)]:opacity-100",
								(isPicked || picked.size > 0) && "opacity-100",
							)}>
								<Checkbox
									checked={isPicked}
									className="relative size-4 after:absolute after:-inset-2 after:content-['']"
									aria-label={`Select mail from ${label}`}
									onCheckedChange={() => onTogglePicked(message)}
								/>
							</span>
							<Link
								{...(message.status === "draft"
									? ({ to: "/compose", search: { draftId: message.id } } as const)
									: ({
											to: "/mail/$folder/$messageId",
											params: { folder, messageId: message.id },
										} as const))}
								aria-current={selected ? "page" : undefined}
								className="flex gap-3 py-2.5 pr-3 pl-3.5"
							>
								{/* Selection sits outside this link: touch and keyboard users can
								    pick a row without opening the message. */}
								<span className="relative mt-0.5 size-8 shrink-0">
									<Avatar
										className={cn(
											"size-8 border border-[var(--pogpin-shell-border)] transition-opacity",
											(isPicked || picked.size > 0) && "opacity-0",
											"group-hover/row:opacity-0 group-focus-within/row:opacity-0 max-sm:opacity-0 [@media(hover:none)]:opacity-0",
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
								</span>

								<span className="min-w-0 flex-1">
									{/* A starred row's star never hides, so the line reserves the
									    width of it — otherwise the date sits under the star. */}
									<span className={cn(
										"flex items-baseline gap-2 group-hover/row:pr-30 group-focus-within/row:pr-30 max-sm:pr-0! [@media(hover:none)]:pr-0!",
										message.starred && "sm:pr-6",
									)}>
										<span
											className={cn(
												"min-w-0 flex-1 truncate text-[0.8125rem]",
												unread ? "font-semibold text-foreground" : "text-muted-foreground",
											)}
										>
											{label}
										</span>

										{/* Metadata yields to the toolbar on hover and keyboard focus.
										    Touch actions sit below, so metadata stays visible. */}
										{message.hasAttachments ? (
											<Paperclip
												aria-label="Has attachments"
												className="size-3 shrink-0 text-muted-foreground group-hover/row:hidden group-focus-within/row:hidden max-sm:block! [@media(hover:none)]:block!"
											/>
										) : null}

										<time
											dateTime={message.receivedAt}
											className="machine shrink-0 text-[0.6875rem] text-muted-foreground group-hover/row:hidden group-focus-within/row:hidden max-sm:block! [@media(hover:none)]:block!"
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
							 * also a click through to the message. Touch has no hover, so its
							 * actions get their own row below the message summary.
							 */}
							<div className="absolute top-1.5 right-2 flex items-center gap-0.5 max-sm:static max-sm:justify-end max-sm:border-t max-sm:border-border max-sm:px-2 max-sm:py-1 [@media(hover:none)]:static [@media(hover:none)]:justify-end [@media(hover:none)]:border-t [@media(hover:none)]:border-border [@media(hover:none)]:px-2 [@media(hover:none)]:py-1">
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

								{folder === "trash" && onDelete ? (
									<RowAction
										label="Delete permanently"
										className="opacity-0 group-hover/row:opacity-100 hover:text-fail"
										onClick={() => onDelete(message)}
									>
										<Trash2 className="size-3.5" />
									</RowAction>
								) : (
									<RowAction
										label="Move to trash"
										className="opacity-0 group-hover/row:opacity-100 hover:text-fail"
										onClick={() => onTrash(message)}
									>
										<Trash2 className="size-3.5" />
									</RowAction>
								)}

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
			className={cn("size-7 text-muted-foreground transition-opacity group-focus-within/row:opacity-100 max-sm:size-9 max-sm:opacity-100 [@media(hover:none)]:size-9 [@media(hover:none)]:opacity-100", className)}
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
