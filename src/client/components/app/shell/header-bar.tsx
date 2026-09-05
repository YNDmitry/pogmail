import { motion } from "motion/react";
import { PanelLeftClose, PanelLeftOpen, PenLine, Search } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { ActionSwapIcon } from "@/client/components/motion/action-swap";
import { AnimatedSidebarTrigger } from "@/client/components/motion/animated-sidebar";
import { Button as MotionButton } from "@/client/components/motion/button/base";
import { Button } from "@/client/components/ui";

/**
 * The one bar above the content panel. It carries where you are, the two ways
 * to reach navigation (the rail on desktop, the sheet below it), search, and
 * the single primary action this product has.
 */
export function HeaderBar({
	title,
	compact = false,
	showCompose = true,
	onToggleCompact,
	onOpenCommandPalette,
}: {
	title: string;
	compact?: boolean;
	/** Hidden on the compose screen: the action would lead where you already are. */
	showCompose?: boolean;
	onToggleCompact: () => void;
	onOpenCommandPalette: () => void;
}) {
	return (
		/*
		 * The bar closes with a seam. Screens that bleed to the panel edge — the mail
		 * list and its divider — need a line to meet, or their borders start in
		 * mid-air under a bar that has none.
		 */
		<header className="sticky top-0 z-20 border-b border-[var(--pogpin-shell-border)] bg-[var(--pogpin-shell-panel)]">
			<div className="flex min-h-16 items-center justify-between gap-2 px-3 py-2 sm:min-h-14 sm:px-5">
				<div className="flex min-w-0 items-center gap-2">
					<AnimatedSidebarTrigger
						className="shell-hover-trigger size-11 rounded-lg border border-[var(--pogpin-shell-border)] bg-[var(--pogpin-shell-panel-alt)] text-[var(--pogpin-shell-text)] hover:bg-[var(--pogpin-shell-fill-soft)] sm:size-9 xl:hidden"
						aria-label="Navigation"
						title="Navigation"
					>
						<PanelLeftOpen className="size-4" />
					</AnimatedSidebarTrigger>

					<MotionButton
						variant="ghost"
						size="icon"
						pressScale={0.94}
						className="shell-hover-trigger hidden size-9 shrink-0 rounded-lg text-[var(--pogpin-shell-text-muted)] hover:bg-[var(--pogpin-shell-fill-soft)] hover:text-[var(--pogpin-shell-text)] xl:inline-flex"
						aria-label={compact ? "Expand navigation" : "Collapse navigation"}
						title={compact ? "Expand navigation (⌘B)" : "Collapse navigation (⌘B)"}
						onClick={onToggleCompact}
					>
						<ActionSwapIcon
							value={compact ? "expand" : "collapse"}
							animation="roll"
							className="size-4"
						>
							{compact ? (
								<PanelLeftOpen className="size-4" />
							) : (
								<PanelLeftClose className="size-4" />
							)}
						</ActionSwapIcon>
					</MotionButton>

					<motion.div
						key={title}
						initial={{ opacity: 0, x: 4 }}
						animate={{ opacity: 1, x: 0 }}
						transition={{ duration: 0.12 }}
						className="truncate text-sm font-semibold tracking-[-0.02em] text-[var(--pogpin-shell-text)]"
					>
						{title}
					</motion.div>
				</div>

				<div className="ml-auto flex items-center gap-2 sm:gap-2.5">
					<MotionButton
						variant="outline"
						size="md"
						pressScale={0.98}
						className="hidden h-9 w-64 justify-start gap-2.5 rounded-lg border-[var(--pogpin-shell-border)] bg-[var(--pogpin-shell-panel-alt)] px-3 text-[var(--pogpin-shell-text-muted)] hover:bg-[var(--pogpin-shell-fill-soft)] hover:text-[var(--pogpin-shell-text)] xl:flex"
						aria-label="Search"
						onClick={onOpenCommandPalette}
					>
						<Search className="size-4 shrink-0" />
						<span className="truncate">Search…</span>
						<span className="ml-auto inline-flex items-center rounded-md border border-[var(--pogpin-shell-border)] bg-[var(--pogpin-shell-fill-soft)] px-1.5 py-0.5 text-[0.625rem] font-medium uppercase tracking-[0.14em]">
							⌘K
						</span>
					</MotionButton>

					<MotionButton
						variant="outline"
						size="icon"
						pressScale={0.94}
						className="shell-hover-trigger size-11 shrink-0 rounded-lg border-[var(--pogpin-shell-border)] bg-[var(--pogpin-shell-panel-alt)] text-[var(--pogpin-shell-text-muted)] shadow-none hover:bg-[var(--pogpin-shell-fill-soft)] hover:text-[var(--pogpin-shell-text)] sm:size-9 xl:hidden"
						aria-label="Search"
						title="Search"
						onClick={onOpenCommandPalette}
					>
						<Search className="size-4" />
					</MotionButton>

					{/* The one coral action in the shell: everything else is neutral. */}
					{showCompose ? (
						<Button asChild variant="brand" className="h-9 shrink-0 rounded-lg px-3">
							<Link to="/compose" aria-label="Write a message">
								<PenLine className="size-4 shrink-0" />
								<span className="hidden sm:inline">Write</span>
							</Link>
						</Button>
					) : null}
				</div>
			</div>
		</header>
	);
}
