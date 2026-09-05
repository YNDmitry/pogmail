import { useState } from "react";
import { AtSign, Check, ChevronsUpDown } from "lucide-react";
import { motion } from "motion/react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/client/components/ui";
import { Button as MotionButton } from "@/client/components/motion/button/base";
import { cn } from "@/client/lib/utils";
import type { MailboxSummary } from "@/shared/contract/mail";
import { ShellMenuDim, shellMenuTriggerLift } from "./shell-menu-dim";

/**
 * Which mailbox the folder list is showing.
 *
 * A switcher rather than a second list of destinations: an address is not a
 * place to go, it is a filter over the places already in the sidebar. Picking
 * one keeps the folder you are reading — moving from `hello@`'s Sent to
 * `dmitry@`'s Inbox because you changed the filter is not what anyone asked
 * for — and it survives in the URL, so the view is shareable.
 */
export function MailboxSwitcher({
	mailboxes,
	counts,
	currentId,
	compact = false,
	mobile = false,
	onSelect,
}: {
	mailboxes: MailboxSummary[];
	counts: Record<string, number>;
	currentId: string | null;
	compact?: boolean;
	mobile?: boolean;
	onSelect: (mailboxId: string | null) => void;
}) {
	const [open, setOpen] = useState(false);
	const current = mailboxes.find((mailbox) => mailbox.id === currentId) ?? null;
	const unreadElsewhere = mailboxes.reduce((total, mailbox) => total + (counts[mailbox.id] ?? 0), 0);

	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<ShellMenuDim open={open} />
			<DropdownMenuTrigger asChild>
				<MotionButton
					variant="outline"
					size="md"
					pressScale={0.98}
					className={cn(
						"shell-hover-trigger h-9 w-full min-w-0 cursor-pointer justify-start gap-2 overflow-hidden rounded-lg border border-[var(--pogpin-shell-border)] bg-[var(--pogpin-shell-fill-soft)] px-2 text-left transition-[border-color,background-color] duration-150 hover:border-[var(--pogpin-shell-border-strong)] hover:bg-[var(--pogpin-shell-fill-strong)] data-[state=open]:border-[var(--pogpin-shell-border-strong)]",
						// Collapsed the address is clipped away, so the icon is the control.
						compact && "w-11 justify-center px-0",
						open && shellMenuTriggerLift,
					)}
					aria-label={current ? `Mailbox: ${current.address}` : "All mailboxes"}
					title={current ? current.address : "All mailboxes"}
				>
					<AtSign className="size-4 shrink-0 text-[var(--pogpin-shell-text-muted)]" />
					<motion.span
						initial={false}
						animate={{ opacity: compact ? 0 : 1, x: compact ? -4 : 0 }}
						transition={compact ? { duration: 0.12 } : { duration: 0.2, delay: 0.08 }}
						aria-hidden={compact}
						className="flex min-w-0 flex-1 items-center gap-2"
					>
						{/* An address is machine-assigned, so it keeps the mono face. */}
						<span
							className={cn(
								"min-w-0 flex-1 truncate text-[0.75rem]",
								current ? "machine text-[var(--pogpin-shell-text)]" : "text-[var(--pogpin-shell-text-muted)]",
							)}
						>
							{current ? current.address : "All mailboxes"}
						</span>
						<ChevronsUpDown className="size-3.5 shrink-0 text-[var(--pogpin-shell-icon-muted)]" />
					</motion.span>
				</MotionButton>
			</DropdownMenuTrigger>

			<DropdownMenuContent
				side={mobile ? "bottom" : "right"}
				align="start"
				sideOffset={8}
				className="pogpin-menu-morph max-h-80 w-[15rem] overflow-y-auto rounded-xl border-[var(--pogpin-shell-border)] bg-[var(--pogpin-shell-panel)] p-1.5 text-[var(--pogpin-shell-text)] shadow-2xl"
			>
				<DropdownMenuItem className="account-menu-item" onSelect={() => onSelect(null)}>
					<Check className={cn("size-3.5 shrink-0", current && "invisible")} />
					<span className="flex-1">All mailboxes</span>
					{unreadElsewhere ? <Count value={unreadElsewhere} /> : null}
				</DropdownMenuItem>

				<DropdownMenuSeparator className="my-1.5 bg-[var(--pogpin-shell-border)]" />

				{mailboxes.map((mailbox) => (
					<DropdownMenuItem
						key={mailbox.id}
						className="account-menu-item"
						onSelect={() => onSelect(mailbox.id)}
					>
						<Check
							className={cn("size-3.5 shrink-0", mailbox.id !== currentId && "invisible")}
						/>
						<span className="machine min-w-0 flex-1 truncate">{mailbox.address}</span>
						{counts[mailbox.id] ? <Count value={counts[mailbox.id] ?? 0} /> : null}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** Unread counts are data, so they are set in mono with locked-width figures. */
function Count({ value }: { value: number }) {
	return (
		<span className="machine shrink-0 rounded-full bg-[var(--pogpin-shell-fill-soft)] px-1.5 py-0.5 text-[0.625rem] text-[var(--pogpin-shell-text-soft)]">
			{value > 999 ? "999+" : value}
		</span>
	);
}
