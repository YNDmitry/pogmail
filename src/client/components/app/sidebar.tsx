import { useMemo } from "react";
import type { LucideIcon } from "lucide-react";
import { Link, useRouter } from "@tanstack/react-router";
import { motion } from "motion/react";
import { X } from "lucide-react";
import {
	AnimatedSidebar,
	AnimatedSidebarClose,
	AnimatedSidebarContent,
	AnimatedSidebarFooter,
	AnimatedSidebarGroup,
	AnimatedSidebarGroupContent,
	AnimatedSidebarGroupLabel,
	AnimatedSidebarHeader,
	AnimatedSidebarMenu,
	AnimatedSidebarMenuButton,
	AnimatedSidebarMenuItem,
	AnimatedSidebarRail,
	useAnimatedSidebar,
} from "@/client/components/motion/animated-sidebar";
import { ScrollFade } from "@/client/components/ui";
import { Mark } from "@/client/components/app/mark";
import { AccountCard } from "@/client/components/app/shell/account-card";
import { MailboxSwitcher } from "@/client/components/app/shell/mailbox-switcher";
import { useInstanceIdentity } from "@/client/lib/identity-context";
import { useLogout } from "@/client/lib/queries";
import { interceptRouterLinks } from "@/client/lib/route-links";
import { cn } from "@/client/lib/utils";
import type { SessionUser } from "@/shared/contract/auth";
import type { MailboxSummary } from "@/shared/contract/mail";

export type NavItem = {
	key: string;
	label: string;
	icon: LucideIcon;
	href: string;
	badge?: number | undefined;
};

export type NavGroup = { label: string; items: NavItem[] };

/**
 * beUI draws its own active pill — a shared-layout span that slides between
 * items — in `bg-muted`. The where-am-I marker belongs to the brand channel, so
 * the pill is recoloured from outside rather than by forking the component,
 * which keeps the animation and survives the next install.
 */
const ACTIVE = "text-primary [&>span:first-child]:rounded-md [&>span:first-child]:bg-accent";

function ProductBrand({
	appName,
	iconUrl,
	compact,
}: {
	appName: string;
	iconUrl: string | null;
	compact: boolean;
}) {
	const identity = useInstanceIdentity();

	return (
		<Link
			to="/mail/$folder"
			params={{ folder: "inbox" }}
			aria-label={`${appName} home`}
			className="group flex h-11 w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-xl px-1.5 text-[var(--pogpin-shell-text)] transition-colors hover:bg-[var(--pogpin-shell-fill-soft)]"
		>
			<span className="grid size-8 shrink-0 place-items-center rounded-md border border-[var(--pogpin-shell-border)] bg-[var(--pogpin-shell-panel-alt)]">
				{iconUrl ? (
					<img src={iconUrl} alt="" aria-hidden className="size-4.5 rounded-sm object-cover" />
				) : (
					/* No logo uploaded: the instance wears the mark its own seed drew. */
					<Mark identity={identity} className="size-4.5" animate />
				)}
			</span>
			<motion.span
				initial={false}
				animate={{ opacity: compact ? 0 : 1, x: compact ? -4 : 0 }}
				transition={compact ? { duration: 0.12 } : { duration: 0.2, delay: 0.08 }}
				aria-hidden={compact}
				className={cn(
					"min-w-0 flex-1 truncate text-[0.82rem] font-semibold tracking-[-0.03em]",
					compact && "w-0 flex-none",
				)}
			>
				{appName}
			</motion.span>
		</Link>
	);
}

export function AppSidebar({
	nav,
	pathname,
	appName,
	iconUrl,
	user,
	mailboxes,
	mailboxCounts,
	currentMailboxId,
	onSelectMailbox,
	compact,
}: {
	nav: NavGroup[];
	pathname: string;
	appName: string;
	iconUrl: string | null;
	user: SessionUser | null;
	mailboxes: MailboxSummary[];
	mailboxCounts: Record<string, number>;
	currentMailboxId: string | null;
	onSelectMailbox: (mailboxId: string | null) => void;
	compact: boolean;
}) {
	const logout = useLogout();
	const router = useRouter();
	const navigateInApp = useMemo(() => interceptRouterLinks(router), [router]);
	const { isMobile } = useAnimatedSidebar();
	const navCompact = compact && !isMobile;

	return (
		<AnimatedSidebar
			collapsible="icon"
			ariaLabel="Primary"
			className="text-[var(--pogpin-shell-text)]"
			panelClassName="h-full border-0 bg-transparent"
		>
			<AnimatedSidebarHeader
				className={cn(
					"gap-2 pb-3",
					isMobile && "border-b border-[var(--pogpin-shell-border)] px-4 py-4",
				)}
			>
				<div className="flex items-center justify-between gap-3">
					<ProductBrand appName={appName} iconUrl={iconUrl} compact={navCompact} />
					{/* The sheet needs its own way out; Escape alone is not an affordance. */}
					{isMobile ? (
						<AnimatedSidebarClose
							className="size-9 border border-[var(--pogpin-shell-border)] text-[var(--pogpin-shell-text-muted)] hover:bg-[var(--pogpin-shell-fill-soft)] hover:text-[var(--pogpin-shell-text)]"
							aria-label="Close navigation"
							title="Close navigation"
						>
							<X className="size-4" />
						</AnimatedSidebarClose>
					) : null}
				</div>

				{mailboxes.length > 1 ? (
					<MailboxSwitcher
						mailboxes={mailboxes}
						counts={mailboxCounts}
						currentId={currentMailboxId}
						compact={navCompact}
						mobile={isMobile}
						onSelect={onSelectMailbox}
					/>
				) : null}
			</AnimatedSidebarHeader>

			{/*
			 * Every menu anchor beUI renders is caught here and routed client-side;
			 * see `interceptRouterLinks` for why this is not a fork of the component.
			 */}
			<AnimatedSidebarContent className="overflow-hidden p-0" onClickCapture={navigateInApp}>
				{/* Fixed group padding keeps every icon on the same axis while the
				    sidebar width animates. */}
				<ScrollFade
					className="min-h-0 flex-1"
					viewportClassName={cn("h-full scrollbar-none", isMobile && "px-2 py-3")}
					viewportProps={{ tabIndex: 0, "aria-label": "Navigation" }}
					fadeColor="var(--background)"
				>
					{nav.map((group) => (
						<AnimatedSidebarGroup key={group.label} className="px-3">
							{/* beUI already holds this at a fixed height and fades it when
							    collapsed, so it must not be given a display rule of its own. */}
							<AnimatedSidebarGroupLabel className="field-label">
								{group.label}
							</AnimatedSidebarGroupLabel>
							<AnimatedSidebarGroupContent>
								<nav aria-label={group.label}>
									<AnimatedSidebarMenu>
										{group.items.map((item) => {
											const active = pathname.startsWith(item.href.split("?")[0] ?? item.href);
											return (
												<AnimatedSidebarMenuItem key={item.key}>
													<AnimatedSidebarMenuButton
														href={item.href}
														isActive={active}
														icon={<item.icon className="size-4" />}
														badge={item.badge ? <Count value={item.badge} /> : undefined}
														className={cn(
															"rounded-md px-3",
															navCompact &&
																"gap-0 [&>span:last-child]:w-0 [&>span:last-child]:flex-none",
															active && ACTIVE,
														)}
													>
														{item.label}
													</AnimatedSidebarMenuButton>
												</AnimatedSidebarMenuItem>
											);
										})}
									</AnimatedSidebarMenu>
								</nav>
							</AnimatedSidebarGroupContent>
						</AnimatedSidebarGroup>
					))}

				</ScrollFade>
			</AnimatedSidebarContent>

			<AnimatedSidebarFooter
				className={cn(
					"relative z-20 flex justify-center border-0 pt-3",
					isMobile && "border-t border-[var(--pogpin-shell-border)] p-3.5",
				)}
			>
				<AccountCard
					name={user?.name}
					email={user?.email}
					isAdmin={user?.role === "admin"}
					compact={navCompact}
					mobile={isMobile}
					onSignOut={() =>
						logout.mutate(undefined, { onSuccess: () => location.assign("/login") })
					}
				/>
			</AnimatedSidebarFooter>

			{/* Pointer affordance at the panel edge; pairs with the header trigger. */}
			<AnimatedSidebarRail className="hover:after:bg-[var(--pogpin-shell-border-strong)]" />
		</AnimatedSidebar>
	);
}

/** Unread counts are data, so they are set in mono with locked-width figures. */
function Count({ value }: { value: number }) {
	return (
		<span className="machine rounded-full bg-[var(--pogpin-shell-fill-soft)] px-1.5 py-0.5 text-[0.6875rem] text-[var(--pogpin-shell-text-soft)]">
			{value > 999 ? "999+" : value}
		</span>
	);
}
