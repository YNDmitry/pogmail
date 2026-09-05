import { useId } from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/client/components/ui";
import { cn } from "@/client/lib/utils";

export type ChoiceOption = { value: string; label: string; disabled?: boolean };

/**
 * A `<select>` in the kit's clothes.
 *
 * Radix ships the popover, the keyboard behaviour and — when `name` is set — a
 * hidden native select, so a form still reads the value out of `FormData`. That
 * hidden field starts empty, though, which a native `<select>` never does: it
 * shows its first option and submits it. So an uncontrolled Choice falls back
 * to the first option, or the caller's `placeholder` marks the field as one the
 * operator has to answer.
 *
 * An option value may never be the empty string — Radix reserves it for "nothing
 * selected" and renders a blank trigger instead. Spell the empty case out (see
 * `EVERY_MAILBOX`) and translate it where the value is read.
 */
export function Choice({
	id,
	options,
	value,
	defaultValue,
	onChange,
	name,
	placeholder,
	required,
	disabled,
	className,
	size = "default",
	"aria-label": ariaLabel,
}: {
	id?: string;
	options: readonly ChoiceOption[];
	value?: string;
	defaultValue?: string;
	onChange?: (value: string) => void;
	name?: string;
	placeholder?: string;
	required?: boolean;
	disabled?: boolean;
	className?: string;
	size?: "sm" | "default";
	"aria-label"?: string;
}) {
	const generatedId = useId();
	const fieldId = id ?? generatedId;
	const fallback = placeholder ? undefined : (defaultValue ?? options[0]?.value);

	return (
		<Select
			{...(value === undefined ? { defaultValue: defaultValue ?? fallback } : { value })}
			onValueChange={onChange}
			name={name}
			required={required}
			disabled={disabled}
		>
			<SelectTrigger
				id={fieldId}
				size={size}
				aria-label={ariaLabel}
				className={cn("w-full", className)}
			>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent>
				{options.map((option) => (
					<SelectItem key={option.value} value={option.value} disabled={option.disabled}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
