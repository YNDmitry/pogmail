/**
 * The dim behind an open shell menu.
 *
 * Shell menus (account, mailboxes) drop the rest of the app back rather than
 * opening a floating panel over a fully lit page, so the menu reads as the
 * thing in focus. The trigger itself stays above the dim — see
 * `shellMenuTriggerLift` — which is what connects the open menu to the control
 * it came from.
 */
export function ShellMenuDim({ open }: { open: boolean }) {
	if (!open) return null;
	return (
		<div
			className="fixed inset-0 z-30 bg-[var(--pogpin-shell-hero-outer)]/70 backdrop-blur-[1px]"
			aria-hidden="true"
		/>
	);
}

/**
 * Applied to a menu's trigger *only while that menu is open*: a permanent lift
 * would keep the control bright under some other menu's dim.
 */
export const shellMenuTriggerLift = "relative z-40";
