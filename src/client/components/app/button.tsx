import type { ComponentProps, Ref } from "react";
import { Button as KitButton } from "@/client/components/ui";
import {
	StatefulButton as BeStatefulButton,
	type StatefulButtonProps,
} from "@/client/components/motion/button/stateful";
import { cn } from "@/client/lib/utils";

/**
 * The app's button is the kit's button; this file only keeps the older call
 * sites speaking their own vocabulary.
 *
 * Coral is the primary action, one per view — so `primary` maps to the kit's
 * `brand` and everything else stays on the neutral surface. Sizes translate
 * because the kit calls the default height `default` and the old markup calls
 * it `md`.
 */
export type AppButtonVariant =
	| "primary"
	| "brand"
	| "secondary"
	| "ghost"
	| "outline"
	| "destructive";
export type AppButtonSize = "sm" | "md" | "lg" | "icon";

const VARIANT = {
	primary: "brand",
	brand: "brand",
	secondary: "default",
	ghost: "ghost",
	outline: "outline",
	destructive: "destructive",
} as const;

const SIZE = { sm: "sm", md: "default", lg: "lg", icon: "icon" } as const;

export type ButtonProps = Omit<ComponentProps<typeof KitButton>, "variant" | "size"> & {
	variant?: AppButtonVariant;
	size?: AppButtonSize;
	ref?: Ref<HTMLButtonElement>;
};

export function Button({ variant = "primary", size = "md", ...props }: ButtonProps) {
	return <KitButton variant={VARIANT[variant]} size={SIZE[size]} {...props} />;
}

/**
 * The submit button keeps beUI's state machine — idle, loading, success, error
 * — and wears the kit's geometry rather than beUI's pill.
 */
export function SubmitButton({ className, ...props }: StatefulButtonProps) {
	return (
		<BeStatefulButton
			className={cn("h-9 rounded-md px-4 text-sm font-medium", className)}
			{...props}
		/>
	);
}

export type { StatefulButtonProps };
