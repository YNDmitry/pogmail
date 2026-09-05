import type { LucideIcon } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/client/lib/utils";

export type SectionLink = { to: string; label: string; icon: LucideIcon; description?: string };

/**
 * Sub-navigation for Settings and Administration. Deliberately a plain list of
 * links: these are destinations, not steps, so nothing here implies an order.
 */
export function SectionNav({ links }: { links: SectionLink[] }) {
	const pathname = useRouterState({ select: (state) => state.location.pathname });

	return (
		/*
		 * Named, so a view transition lifts the tabs out of the `page` snapshot and
		 * leaves them still: switching tab should move the panel it controls, not
		 * the control itself. `styles.css` stills the group.
		 */
		<nav
			aria-label="Section"
			style={{ viewTransitionName: "section-nav" }}
			className="lg:sticky lg:top-8 lg:self-start"
		>
			<ul className="pogpin-shell-tabs flex gap-1.5 overflow-x-auto rounded-xl p-1.5 lg:flex-col lg:overflow-visible">
				{links.map((link) => {
					const active = pathname === link.to;
					return (
						<li key={link.to} className="relative shrink-0">
							<Link
								to={link.to}
								viewTransition
								aria-current={active ? "page" : undefined}
								className={cn(
									"pogpin-shell-tab-trigger flex items-center gap-2.5 rounded-lg px-3 py-2 text-[0.82rem] transition-colors duration-150",
									active
										? "border-[var(--pogpin-brand-border)] bg-accent font-medium text-primary"
										: "text-[var(--pogpin-shell-text-muted)] hover:bg-[var(--pogpin-shell-fill-soft)] hover:text-[var(--pogpin-shell-text)]",
								)}
							>
								{/* The icon is the same one the sidebar uses for the section, so a
								    tab and its destination are recognisably the same place. */}
								<link.icon aria-hidden className="size-3.5 shrink-0" />
								<span className="truncate">{link.label}</span>
							</Link>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
