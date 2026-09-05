import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { LogOut, Moon, Settings2, Shield, Sun } from "lucide-react";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/client/components/ui";
import { ActionSwapIcon } from "@/client/components/motion/action-swap";
import { Button as MotionButton } from "@/client/components/motion/button/base";
import { useThemeToggle } from "@/client/components/motion/theme-toggle";
import { initials } from "@/client/lib/format";
import { cn } from "@/client/lib/utils";
import { ShellMenuDim, shellMenuTriggerLift } from "./shell-menu-dim";

/**
 * The account control that anchors the sidebar footer. Collapsed, only the
 * avatar survives the clip — everything else the operator needs (settings,
 * theme, sign-out) lives one click deeper, so the rail never loses a route.
 */
export function AccountCard({
	name,
	email,
	image,
	isAdmin = false,
	compact = false,
	mobile = false,
	onSignOut,
}: {
	name?: string | null;
	email?: string | null;
	image?: string | null;
	isAdmin?: boolean;
	compact?: boolean;
	mobile?: boolean;
	onSignOut: () => void;
}) {
	const [open, setOpen] = useState(false);
	const { isDark, toggle, mounted } = useThemeToggle({
		variant: "circle-blur",
		start: "bottom-left",
	});
	const displayName = name?.trim() || "Account";
	const displayEmail = email || "No address";
	const ThemeIcon = isDark ? Sun : Moon;

	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<ShellMenuDim open={open} />
			<DropdownMenuTrigger asChild>
				<MotionButton
					variant="outline"
					size="md"
					pressScale={0.98}
					className={cn(
						"shell-hover-trigger relative h-11 w-full min-w-0 cursor-pointer justify-start gap-2.5 overflow-hidden rounded-xl border border-[var(--pogpin-shell-border)] bg-[var(--pogpin-shell-fill-soft)] px-1 text-left outline-none transition-[transform,border-color,background-color] duration-150 hover:border-[var(--pogpin-shell-border-strong)] hover:bg-[var(--pogpin-shell-fill-strong)] focus-visible:ring-2 focus-visible:ring-[var(--pogpin-brand-border)] data-[state=open]:border-[var(--pogpin-shell-border-strong)] data-[state=open]:bg-[var(--pogpin-shell-fill-strong)]",
						// Collapsed there is only the avatar, so the control is the avatar:
						// a full-width row would sit it against the left edge of the rail.
						compact && "w-11 justify-center px-0",
						open && shellMenuTriggerLift,
					)}
					aria-label={displayName}
				>
					<Avatar className="size-8 shrink-0 border border-[var(--pogpin-shell-border)]">
						{image ? <AvatarImage src={image} alt={displayName} /> : null}
						<AvatarFallback className="bg-primary text-sm font-semibold text-primary-foreground">
							{initials(displayName)}
						</AvatarFallback>
					</Avatar>
					<motion.span
						initial={false}
						animate={{ opacity: compact ? 0 : 1, x: compact ? -4 : 0 }}
						transition={compact ? { duration: 0.12 } : { duration: 0.2, delay: 0.08 }}
						aria-hidden={compact}
						className="min-w-0 flex-1"
					>
						<span className="block truncate text-[0.78rem] font-semibold tracking-[-0.02em] text-[var(--pogpin-shell-text)]">
							{displayName}
						</span>
						{/* An address is machine-assigned, so it keeps the mono face. */}
						<span className="machine block truncate text-[0.65rem] text-[var(--pogpin-shell-text-muted)]">
							{displayEmail}
						</span>
					</motion.span>
				</MotionButton>
			</DropdownMenuTrigger>

			<DropdownMenuContent
				side={mobile ? "top" : "right"}
				align={mobile ? "start" : "end"}
				sideOffset={8}
				className={cn(
					"pogpin-menu-morph rounded-xl border-[var(--pogpin-shell-border)] bg-[var(--pogpin-shell-panel)] p-1.5 text-[var(--pogpin-shell-text)] shadow-2xl backdrop-blur",
					mobile ? "w-[var(--radix-dropdown-menu-trigger-width)]" : "w-[13.5rem]",
				)}
			>
				<div className="mb-1.5 flex items-center gap-2.5 rounded-lg border border-[var(--pogpin-shell-border)] bg-[var(--pogpin-shell-fill-soft)] p-1.5">
					<Avatar className="size-8 border border-[var(--pogpin-shell-border)]">
						{image ? <AvatarImage src={image} alt={displayName} /> : null}
						<AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
							{initials(displayName)}
						</AvatarFallback>
					</Avatar>
					<div className="min-w-0">
						<div className="truncate text-[0.82rem] font-semibold tracking-[-0.025em] text-[var(--pogpin-shell-text)]">
							{displayName}
						</div>
						<div className="machine truncate text-[0.68rem] text-[var(--pogpin-shell-text-muted)]">
							{displayEmail}
						</div>
					</div>
				</div>

				<DropdownMenuItem asChild className="account-menu-item">
					<Link to="/settings/profile">
						<Settings2 className="size-3.5" />
						<span>Settings</span>
					</Link>
				</DropdownMenuItem>
				{isAdmin ? (
					<DropdownMenuItem asChild className="account-menu-item">
						<Link to="/admin/overview">
							<Shield className="size-3.5" />
							<span>Administration</span>
						</Link>
					</DropdownMenuItem>
				) : null}
				<DropdownMenuItem className="account-menu-item" onSelect={toggle}>
					<ActionSwapIcon
						value={mounted ? (isDark ? "light" : "dark") : "loading"}
						animation="blur"
						className="size-3.5"
					>
						{mounted ? <ThemeIcon className="size-3.5" /> : <span className="size-3.5" />}
					</ActionSwapIcon>
					<span>Theme</span>
				</DropdownMenuItem>
				<DropdownMenuItem
					className="account-menu-item text-destructive focus:text-destructive"
					onSelect={onSignOut}
				>
					<LogOut className="size-3.5" />
					<span>Sign out</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
