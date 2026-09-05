import type { ReactNode } from "react";
import { toast as sonner } from "sonner";
import { Toaster } from "@/client/components/ui";

type ToastApi = {
	/** Confirms an action in the same words its button used. */
	ok: (title: string, description?: string) => void;
	/** States what went wrong and, where possible, what to do about it. */
	fail: (title: string, description?: string) => void;
};

const api: ToastApi = {
	ok: (title, description) => void sonner.success(title, { description }),
	// Failures stay up longer: they usually contain an instruction.
	fail: (title, description) => void sonner.error(title, { description, duration: 8000 }),
};

/**
 * Sonner keeps its own store outside React, so this is a mount point rather
 * than a context — `useToast` works anywhere under it, including callbacks that
 * outlive the component that fired them.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
	return (
		<>
			{children}
			<Toaster />
		</>
	);
}

export function useToast(): ToastApi {
	return api;
}
