import type { ReactNode } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/client/components/ui";
import { cn } from "@/client/lib/utils";

/**
 * Every dialog in this product is a single form that is either open or closed,
 * so this adapts the kit's controlled `Dialog` to that shape once instead of at
 * a dozen call sites — and gives each one the heading its title bar needs
 * without the form having to repeat it.
 */
export function Modal({
	open,
	onClose,
	title,
	description,
	children,
	className,
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	description?: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<DialogContent className={cn("sm:max-w-md", className)}>
				<DialogHeader>
					<DialogTitle className="display text-lg">{title}</DialogTitle>
					{description ? <DialogDescription>{description}</DialogDescription> : null}
				</DialogHeader>
				{children}
			</DialogContent>
		</Dialog>
	);
}
