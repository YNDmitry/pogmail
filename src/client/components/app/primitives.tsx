import type { ReactNode } from "react";
import { AlertTriangle, Check, CircleDashed, Minus } from "lucide-react";
import { Badge } from "@/client/components/ui";
import { cn } from "@/client/lib/utils";

/**
 * Machine-assigned values — addresses, hostnames, DNS records, Message-IDs, key
 * prefixes, byte counts, timings. They are read a character at a time and often
 * copied into another tool, so they get the mono face and locked-width figures.
 * Prose a person wrote never does.
 */
export function Machine({ children, className }: { children: ReactNode; className?: string }) {
	return <span className={cn("machine text-muted-foreground", className)}>{children}</span>;
}

/**
 * The signal channel. Coral is the brand and never doubles as an error, so
 * delivery states keep their own fixed statuses — green delivered, amber
 * queued, red failed — in both themes. Each carries a glyph as well as a
 * colour, so nothing here depends on hue alone.
 */
const TONES = {
	neutral: { class: "bg-secondary text-secondary-foreground", icon: Minus },
	ok: { class: "bg-[var(--pogpin-success-surface)] text-[var(--pogpin-success)]", icon: Check },
	wait: {
		class: "bg-[var(--pogpin-warning-surface)] text-[var(--pogpin-warning)]",
		icon: CircleDashed,
	},
	fail: {
		class: "bg-[var(--pogpin-danger-surface)] text-[var(--pogpin-danger)]",
		icon: AlertTriangle,
	},
	/** Brand, not signal: for things that belong to *this* instance. */
	accent: { class: "bg-accent text-primary", icon: null },
} as const;

export type Tone = keyof typeof TONES;

export function Tag({
	tone = "neutral",
	glyph = true,
	children,
	className,
}: {
	tone?: Tone;
	glyph?: boolean;
	children: ReactNode;
	className?: string;
}) {
	const { class: toneClass, icon: Icon } = TONES[tone];

	return (
		<Badge variant="ghost" className={cn("gap-1.5 border-transparent", toneClass, className)}>
			{glyph && Icon ? <Icon aria-hidden className="size-3 shrink-0" /> : null}
			{children}
		</Badge>
	);
}

export function PageHeader({
	title,
	description,
	actions,
	/**
	 * A view-transition name, for a heading that stays put while the screen under
	 * it changes — the section layouts pass one so their tabs and title do not
	 * animate along with the panel they control.
	 */
	transitionName,
}: {
	title: string;
	description?: string;
	actions?: ReactNode;
	transitionName?: string;
}) {
	return (
		<header
			style={transitionName ? { viewTransitionName: transitionName } : undefined}
			className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4"
		>
			<div className="min-w-0">
				<h1 className="display text-[1.375rem] text-foreground">{title}</h1>
				{description ? (
					<p className="mt-1.5 max-w-[68ch] text-sm text-muted-foreground">{description}</p>
				) : null}
			</div>
			{actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
		</header>
	);
}

/** Empty states name the next step rather than describing the absence. */
export function Empty({
	title,
	body,
	action,
}: {
	title: string;
	body?: string;
	action?: ReactNode;
}) {
	return (
		<div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
			<p className="display text-[0.9375rem] text-foreground">{title}</p>
			{body ? <p className="max-w-[44ch] text-sm text-muted-foreground">{body}</p> : null}
			{action ? <div className="mt-1">{action}</div> : null}
		</div>
	);
}

export function Field({
	label,
	hint,
	error,
	children,
	className,
}: {
	label: string;
	hint?: string;
	error?: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<label className={cn("block space-y-2", className)}>
			{/* Sentence case, like the rest of the kit: the shouty label belongs to a
			    column header, not to a field the operator is filling in. */}
			<span className="pogpin-shell-copy block text-sm leading-none font-medium">{label}</span>
			{children}
			{error ? (
				<span className="flex items-center gap-1.5 text-xs text-destructive">
					<AlertTriangle aria-hidden className="size-3 shrink-0" />
					{error}
				</span>
			) : hint ? (
				<span className="block text-xs text-muted-foreground">{hint}</span>
			) : null}
		</label>
	);
}

/**
 * A panel is a surface, and a surface declares its edge once. Only things that
 * genuinely float — popovers, modals, toasts, the command palette — carry a
 * shadow heavier than the card's own hairline.
 */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<section className={cn("rounded-lg border border-border bg-card shadow-sm", className)}>
			{children}
		</section>
	);
}

export function Rows({ children }: { children: ReactNode }) {
	return <div className="divide-y divide-border">{children}</div>;
}
