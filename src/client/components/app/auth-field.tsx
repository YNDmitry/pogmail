import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/client/lib/utils";

/**
 * The signed-out surface is dark in both themes, so it cannot borrow the app's
 * field and label colours — those follow the theme and would vanish against the
 * card. These are the auth palette's own.
 */
export const authInputClass =
	"pogpin-auth-input h-11 rounded-lg text-sm shadow-none " +
	"placeholder:text-[var(--pogpin-auth-muted)] focus-visible:ring-0";

export function AuthField({
	label,
	hint,
	children,
	className,
}: {
	label: string;
	hint?: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<label className={cn("block space-y-2 text-left", className)}>
			<span className="block text-sm leading-none font-medium text-[var(--pogpin-auth-copy)]">
				{label}
			</span>
			{children}
			{hint ? (
				<span className="block text-xs text-[var(--pogpin-auth-muted)]">{hint}</span>
			) : null}
		</label>
	);
}

/** One place for a failed sign-in to say what happened. */
export function AuthError({ children }: { children: ReactNode }) {
	return (
		<p
			role="alert"
			className="flex items-center gap-2 rounded-lg border border-[var(--pogpin-danger)]/30 bg-[var(--pogpin-danger-surface)] px-3 py-2 text-sm text-[var(--pogpin-danger)]"
		>
			<AlertTriangle aria-hidden className="size-3.5 shrink-0" />
			{children}
		</p>
	);
}
