import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createFileRoute, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
	Archive,
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
import { api, ApiError } from "@/client/lib/api";
import { useBranding, useCounts, useMailboxes, useSession } from "@/client/lib/queries";
import { qk } from "@/client/lib/queries/keys";
import { connectRealtime } from "@/client/lib/realtime";
import { AppSidebar } from "@/client/components/app/sidebar";
import { HeaderBar } from "@/client/components/app/shell/header-bar";
import { AppCommandPalette } from "@/client/components/app/command-palette";
import { ToastProvider } from "@/client/components/app/toast-host";
import { AnimatedSidebarProvider } from "@/client/components/motion/animated-sidebar";
import { ScrollFade, TooltipProvider } from "@/client/components/ui";
import { IdentityProvider } from "@/client/lib/identity-context";
import type { SessionUser } from "@/shared/contract/auth";

export const Route = createFileRoute("/_app")({
	/*
	 * The session cookie is HttpOnly, so the guard has to ask the server — but
	 * this runs on every navigation, and a raw fetch here made each one wait on a
	 * round-trip and duplicated the request `useSession` was already making.
	 * Going through the query cache makes the guard free once the answer is known.
	 */
	beforeLoad: async ({ context }) => {
		try {
			return {
				user: await context.queryClient.ensureQueryData({
					queryKey: qk.session,
					queryFn: () => api.get<SessionUser>("/api/auth/me"),
					staleTime: 5 * 60_000,
					retry: false,
				}),
			};
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) {
				// A rejected session must not stay cached, or the redirect loops.
				context.queryClient.removeQueries({ queryKey: qk.session });
				throw redirect({ to: "/login" });
			}
			throw error;
		}
	},
	component: AppLayout,
});

const SETTINGS_TITLES: Record<string, string> = {
	profile: "Profile",
	mailboxes: "Mailboxes",
	rules: "Filters",
	templates: "Templates",
	"api-keys": "API keys",
	"import-export": "Import and export",
};

const ADMIN_TITLES: Record<string, string> = {
	overview: "Overview",
	domains: "Domains",
	accounts: "Accounts",
	mailboxes: "Mailboxes",
	routing: "Routing",
	webhooks: "Webhooks",
	activity: "Activity",
	backups: "Backups",
	branding: "Branding",
};

const COMPACT_KEY = "postbox-shell-compact";

function readCompact(): boolean {
	if (typeof window === "undefined") return false;
	try {
		return localStorage.getItem(COMPACT_KEY) === "1";
	} catch {
		return false;
	}
}

export const MAIL_VIEWS = [
	{ slug: "inbox", label: "Inbox", icon: Inbox, status: "received" },
	{ slug: "starred", label: "Starred", icon: Star, status: null },
	{ slug: "snoozed", label: "Snoozed", icon: Timer, status: null },
	{ slug: "drafts", label: "Drafts", icon: FileText, status: "draft" },
	{ slug: "sent", label: "Sent", icon: Send, status: "sent" },
	{ slug: "archived", label: "Archive", icon: Archive, status: "archived" },
	{ slug: "spam", label: "Spam", icon: MailWarning, status: "spam" },
	{ slug: "trash", label: "Trash", icon: Trash2, status: "trash" },
] as const;

function AppLayout() {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	/*
	 * The mailbox filter lives in the URL, not in a store: the view it produces is
	 * shareable and survives a reload, and the sidebar reads it back from there
	 * rather than keeping a second copy that can disagree with the list.
	 */
	const mailboxId = useRouterState({
		select: (state) => (state.location.search as { mailboxId?: string }).mailboxId ?? null,
	});

	const session = useSession();
	const branding = useBranding();
	const mailboxes = useMailboxes();
	const counts = useCounts();

	/*
	 * Read from storage during the first render rather than in an effect: the
	 * panel animates its width, so a compact sidebar that starts expanded and
	 * corrects itself afterwards reads as a flash on every reload.
	 */
	const viewport = useRef<HTMLDivElement>(null);
	const [compact, setCompact] = useState(readCompact);
	const [mobileOpen, setMobileOpen] = useState(false);
	const [commandOpen, setCommandOpen] = useState(false);

	/*
	 * One scroll container serves every screen, so without this a long screen
	 * hands its scroll position to the short one that follows and the new screen
	 * opens halfway down — read as a jump, and the reason a tab switch never
	 * looked settled. The element remembers which screen it is showing, so a
	 * search param or a re-render never re-homes a screen the reader is already
	 * scrolled into. Layout effect, so it lands before the browser paints.
	 */
	useLayoutEffect(() => {
		const element = viewport.current;
		if (!element || element.dataset.screen === pathname) return;
		element.dataset.screen = pathname;
		element.scrollTo({ top: 0 });
	}, [pathname]);

	useEffect(() => {
		try {
			localStorage.setItem(COMPACT_KEY, compact ? "1" : "0");
		} catch {
			// Private mode and storage-blocked browsers simply forget the choice.
		}
	}, [compact]);

	// Live updates: the Durable Object pushes, the cache reacts. No polling.
	useEffect(
		() =>
			connectRealtime((event) => {
				if (event.type === "message.new" || event.type === "message.sent") {
					void queryClient.invalidateQueries({ queryKey: ["messages"] });
				}
				if (event.type === "domain.status") {
					void queryClient.invalidateQueries({ queryKey: ["domains"] });
				}
			}),
		[queryClient],
	);

	useEffect(() => {
		document.title = branding.data?.appName ?? "Pogmail";
	}, [branding.data?.appName]);

	const nav = useMemo(
		() => [
			{
				label: "Mail",
				items: MAIL_VIEWS.map((view) => ({
					key: view.slug,
					label: view.label,
					icon: view.icon,
					// Changing folder must not silently clear the mailbox filter.
					href: mailboxId ? `/mail/${view.slug}?mailboxId=${mailboxId}` : `/mail/${view.slug}`,
					badge:
						view.slug === "starred"
							? counts.data?.starred || undefined
							: view.status
								? counts.data?.byStatus[view.status] || undefined
								: undefined,
				})),
			},
			{
				label: "Workspace",
				items: [
					{ key: "compose", label: "Compose", icon: PenLine, href: "/compose" },
					{ key: "contacts", label: "Contacts", icon: Users, href: "/contacts" },
					{ key: "calendar", label: "Calendar", icon: CalendarDays, href: "/calendar" },
				],
			},
			{
				label: "Manage",
				items: [
					{ key: "settings", label: "Settings", icon: Settings, href: "/settings/profile" },
					...(session.data?.role === "admin"
						? [{ key: "admin", label: "Administration", icon: Shield, href: "/admin/overview" }]
						: []),
				],
			},
		],
		[counts.data, session.data?.role, mailboxId],
	);

	/* The header says where you are; the sidebar says where you could go. */
	const pageTitle = useMemo(() => {
		const [, section, rest] = pathname.split("/");
		if (section === "mail") {
			return MAIL_VIEWS.find((view) => view.slug === rest)?.label ?? "Mail";
		}
		if (section === "compose") return "Write a message";
		if (section === "contacts") return "Contacts";
		if (section === "calendar") return "Calendar";
		if (section === "settings") return SETTINGS_TITLES[rest ?? ""] ?? "Settings";
		if (section === "admin") return ADMIN_TITLES[rest ?? ""] ?? "Administration";
		return branding.data?.appName ?? "Pogmail";
	}, [pathname, branding.data?.appName]);

	return (
		<IdentityProvider appName={branding.data?.appName}>
		<ToastProvider>
		<TooltipProvider>
		<AnimatedSidebarProvider
			open={!compact}
			onOpenChange={(open) => setCompact(!open)}
			openMobile={mobileOpen}
			onOpenMobileChange={setMobileOpen}
			className="h-dvh min-h-0 overflow-hidden text-[var(--pogpin-shell-text)]"
			style={{ "--sidebar-width": "13rem", "--sidebar-width-icon": "4.25rem" } as CSSProperties}
		>
			{/*
			 * The shell is a gap, not a border: the sidebar sits on the page ground
			 * and the content is a panel floating on it, so navigation and content
			 * are two surfaces rather than two halves of one.
			 */}
			<div className="flex h-full w-full gap-0 p-0 sm:gap-3 sm:p-3">
				<AppSidebar
					nav={nav}
					pathname={pathname}
					appName={branding.data?.appName ?? "Pogmail"}
					iconUrl={branding.data?.iconUrl ?? null}
					user={session.data ?? null}
					mailboxes={mailboxes.data ?? []}
					mailboxCounts={counts.data?.byMailbox ?? {}}
					currentMailboxId={mailboxId}
					onSelectMailbox={(next) => {
						// Switching mailbox keeps the folder being read and drops the open
						// message, which belongs to the mailbox just left.
						const folder = pathname.startsWith("/mail/")
							? (pathname.split("/")[2] ?? "inbox")
							: "inbox";
						void navigate({
							to: "/mail/$folder",
							params: { folder },
							// The search term is the operator's, not the filter's; keep it.
							search: (prev: { q?: string }) => ({ q: prev.q, mailboxId: next ?? undefined }),
						});
					}}
					compact={compact}
				/>

				<div className="flex flex-1 flex-col overflow-hidden">
					<div className="flex h-full flex-col overflow-hidden rounded-none border-0 bg-[var(--pogpin-shell-panel)] sm:rounded-xl sm:border sm:border-[var(--pogpin-shell-border)]">
						<HeaderBar
							title={pageTitle}
							compact={compact}
							showCompose={!pathname.startsWith("/compose")}
							onToggleCompact={() => setCompact((value) => !value)}
							onOpenCommandPalette={() => setCommandOpen(true)}
						/>

						{/*
						 * Only this region takes part in a page transition. Naming it lifts
						 * it out of the root snapshot, so the sidebar never cross-fades
						 * against itself; nested moves inside a screen — opening a message —
						 * opt out simply by not asking the router for a transition.
						 */}
						<main className="min-h-0 min-w-0 flex-1" style={{ viewTransitionName: "page" }}>
							<ScrollFade
								className="h-full"
								viewportRef={viewport}
								viewportClassName="h-full px-3 py-3 sm:px-5 sm:py-5 lg:px-6"
								fadeColor="var(--pogpin-shell-panel)"
							>
								<Outlet />
							</ScrollFade>
						</main>
					</div>
				</div>
			</div>

			<AppCommandPalette
				open={commandOpen}
				onOpenChange={setCommandOpen}
				mailboxes={mailboxes.data ?? []}
				onNavigate={(to) => void navigate({ to })}
			/>
		</AnimatedSidebarProvider>
		</TooltipProvider>
		</ToastProvider>
		</IdentityProvider>
	);
}
