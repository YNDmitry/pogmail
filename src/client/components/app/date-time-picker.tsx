import { useState, type ChangeEvent } from "react";
import { CalendarDays } from "lucide-react";
import type { DropdownProps } from "react-day-picker";
import { Choice } from "@/client/components/app/choice";
import { Calendar } from "@/client/components/ui/calendar";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/client/components/ui/popover";
import { cn } from "@/client/lib/utils";

const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const CALENDAR_END = new Date(new Date().getFullYear() + 20, 11);
const EMPTY_DROPDOWN_OPTIONS: NonNullable<DropdownProps["options"]> = [];

function timeValue(date: Date): string {
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function CalendarDropdown({
	options = EMPTY_DROPDOWN_OPTIONS,
	value,
	disabled,
	onChange,
	"aria-label": ariaLabel,
}: DropdownProps) {
	return (
		<Choice
			value={String(value)}
			disabled={disabled}
			size="sm"
			aria-label={ariaLabel}
			className="relative z-10 w-auto min-w-[5rem]"
			options={options.map((option) => ({
				value: String(option.value),
				label: option.label,
				disabled: option.disabled,
			}))}
			onChange={(next) =>
				onChange?.({ target: { value: next } } as ChangeEvent<HTMLSelectElement>)
			}
		/>
	);
}

export function DateTimePicker({
	value,
	onChange,
	allDay,
	label,
	invalid,
}: {
	value: Date;
	onChange: (value: Date) => void;
	allDay: boolean;
	label: string;
	invalid?: boolean;
}) {
	const [open, setOpen] = useState(false);

	return (
		<div className="flex min-w-0 gap-2">
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						type="button"
						variant="outline"
						aria-label={`${label} date`}
						aria-invalid={invalid || undefined}
						className="min-w-0 flex-1 justify-between px-3 font-normal"
					>
						<span className="truncate">{DATE.format(value)}</span>
						<CalendarDays className="size-4 text-muted-foreground" />
					</Button>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-auto p-0">
					<Calendar
						mode="single"
						selected={value}
						defaultMonth={value}
						captionLayout="dropdown"
						endMonth={CALENDAR_END}
						components={{ Dropdown: CalendarDropdown }}
						onSelect={(date) => {
							if (!date) return;
							const next = new Date(value);
							next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
							onChange(next);
							setOpen(false);
						}}
					/>
				</PopoverContent>
			</Popover>

			{allDay ? null : (
				<Input
					type="time"
					step={60}
					value={timeValue(value)}
					aria-label={`${label} time`}
					aria-invalid={invalid || undefined}
					className={cn(
						"w-[6.75rem] shrink-0 px-2 tabular-nums",
						"[&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none",
					)}
					onChange={(event) => {
						const [hours, minutes] = event.target.value.split(":").map(Number);
						if (hours === undefined || minutes === undefined) return;
						const next = new Date(value);
						next.setHours(hours, minutes, 0, 0);
						onChange(next);
					}}
				/>
			)}
		</div>
	);
}
