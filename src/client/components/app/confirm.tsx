import { useState, type ReactNode } from "react";
import { Button } from "@/client/components/app/button";
import { Modal } from "@/client/components/app/modal";

type Ask = {
	title: string;
	description: string;
	/** The verb on the button that goes through with it. */
	confirmLabel: string;
	onConfirm: () => void;
};

/**
 * One dialog for "are you sure", asked where the damage is real.
 *
 * Deleting a domain takes its mailboxes and their mail with it, and deleting an
 * account takes everything that belonged to it — those were one stray click from
 * a row of icon buttons. The hook keeps the wording next to the action that
 * causes it rather than in a component per screen: `ask({...})` from the click,
 * and render `dialog` once.
 */
export function useConfirm(): { ask: (next: Ask) => void; dialog: ReactNode } {
	const [pending, setPending] = useState<Ask | null>(null);

	const dialog = (
		<Modal
			open={pending !== null}
			onClose={() => setPending(null)}
			title={pending?.title ?? ""}
			description={pending?.description}
		>
			<div className="flex justify-end gap-2">
				<Button type="button" variant="secondary" onClick={() => setPending(null)}>
					Cancel
				</Button>
				<Button
					type="button"
					className="bg-fail text-primary-foreground hover:bg-fail/90"
					onClick={() => {
						pending?.onConfirm();
						setPending(null);
					}}
				>
					{pending?.confirmLabel ?? "Delete"}
				</Button>
			</div>
		</Modal>
	);

	return { ask: setPending, dialog };
}
