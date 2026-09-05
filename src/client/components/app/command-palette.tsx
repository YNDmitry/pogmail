import { useMemo } from "react";
import {
	Archive,
	AtSign,
	CalendarDays,
	FileText,
	Inbox,
	MailWarning,
	PenLine,
	Send,
	Settings,
	Shield,
	Star,
	Timer,
	Trash2,
	Users,
} from "lucide-react";
import { CommandPalette, type CommandItem } from "@/client/components/motion/command-palette";
import type { MailboxSummary } from "@/shared/contract/mail";

/**
 * ⌘K is how anyone who lives in a mail client actually navigates. Every folder,
 * mailbox and settings page is reachable from here, so the sidebar never has to
 * grow a second level to stay complete.
 */
export function AppCommandPalette({
	open,
	onOpenChange,
	mailboxes,
	onNavigate,
}: {
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	mailboxes: MailboxSummary[];
	onNavigate: (to: string) => void;
}) {
	const items = useMemo<CommandItem[]>(
		() => [
			...[
				{ label: "Inbox", icon: Inbox, to: "/mail/inbox" },
				{ label: "Starred", icon: Star, to: "/mail/starred" },
				{ label: "Snoozed", icon: Timer, to: "/mail/snoozed" },
				{ label: "Drafts", icon: FileText, to: "/mail/drafts" },
				{ label: "Sent", icon: Send, to: "/mail/sent" },
				{ label: "Archive", icon: Archive, to: "/mail/archived" },
				{ label: "Spam", icon: MailWarning, to: "/mail/spam" },
				{ label: "Trash", icon: Trash2, to: "/mail/trash" },
			].map((entry) => ({
				id: entry.to,
				label: entry.label,
				group: "Go to",
				icon: entry.icon,
				onSelect: () => onNavigate(entry.to),
			})),

			{
				id: "compose",
				label: "Write a message",
				group: "Actions",
				icon: PenLine,
				hint: "C",
				onSelect: () => onNavigate("/compose"),
			},
			{
				id: "contacts",
				label: "Contacts",
				group: "Actions",
				icon: Users,
				onSelect: () => onNavigate("/contacts"),
			},
			{
				id: "calendar",
				label: "Calendar",
				group: "Actions",
				icon: CalendarDays,
				onSelect: () => onNavigate("/calendar"),
			},

			...mailboxes.map((mailbox) => ({
				id: `mailbox:${mailbox.id}`,
				label: mailbox.address,
				group: "Mailboxes",
				icon: AtSign,
				keywords: [mailbox.displayName ?? "", mailbox.localPart],
				onSelect: () => onNavigate(`/mail/inbox?mailboxId=${mailbox.id}`),
			})),

			...[
				{ label: "Profile", to: "/settings/profile" },
				{ label: "Mailboxes", to: "/settings/mailboxes" },
				{ label: "Filters", to: "/settings/rules" },
				{ label: "Templates", to: "/settings/templates" },
				{ label: "API keys", to: "/settings/api-keys" },
				{ label: "Import and export", to: "/settings/import-export" },
			].map((entry) => ({
				id: entry.to,
				label: entry.label,
				group: "Settings",
				icon: Settings,
				onSelect: () => onNavigate(entry.to),
			})),

			...[
				{ label: "Overview", to: "/admin/overview" },
				{ label: "Domains", to: "/admin/domains" },
				{ label: "Accounts", to: "/admin/accounts" },
				{ label: "Routing", to: "/admin/routing" },
				{ label: "Webhooks", to: "/admin/webhooks" },
				{ label: "Activity", to: "/admin/activity" },
				{ label: "Backups", to: "/admin/backups" },
				{ label: "Branding", to: "/admin/branding" },
			].map((entry) => ({
				id: entry.to,
				label: entry.label,
				group: "Administration",
				icon: Shield,
				onSelect: () => onNavigate(entry.to),
			})),
		],
		[mailboxes, onNavigate],
	);

	return (
		<CommandPalette
			open={open}
			onOpenChange={onOpenChange}
			items={items}
			placeholder="Search folders, mailboxes and settings…"
		/>
	);
}
