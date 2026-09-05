import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Machine } from "@/client/components/app/primitives";
import { cn } from "@/client/lib/utils";

export type WeekEvent = {
	id: string;
	title: string;
	location: string;
	allDay: boolean;
	startsAt: string;
	endsAt: string;
};

/** One hour is 3rem tall: a 30-minute meeting is still a readable block. */
const HOUR = 48;
/** Everything snaps to the quarter hour, which is how meetings are actually set. */
const SNAP = 15;

const TIME = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const HOUR_LABEL = new Intl.DateTimeFormat(undefined, { hour: "numeric" });

function startOfDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function minutesInto(date: Date): number {
	return date.getHours() * 60 + date.getMinutes();
}

function snap(minutes: number): number {
	return Math.max(0, Math.min(24 * 60, Math.round(minutes / SNAP) * SNAP));
}

function sameDay(a: Date, b: Date): boolean {
	return startOfDay(a).getTime() === startOfDay(b).getTime();
}

/** A block, in the column it belongs to, with the geometry to draw it. */
type Block = {
	event: WeekEvent;
	day: number;
	top: number;
	height: number;
	/** Side-by-side position among the events it overlaps. */
	column: number;
	columns: number;
};

/**
 * Lays out one day's events.
 *
 * Overlapping events share the width of the column: two meetings at ten o'clock
 * are two halves, not one hiding the other. Clusters are computed by walking the
 * day in start order and closing a cluster whenever nothing is still running.
 */
function layoutDay(events: WeekEvent[], day: number): Block[] {
	const sorted = events.toSorted(
		(a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
	);

	const blocks: Block[] = [];
	let cluster: Block[] = [];
	let clusterEnd = -1;

	const close = () => {
		for (const block of cluster) block.columns = cluster.length;
		blocks.push(...cluster);
		cluster = [];
		clusterEnd = -1;
	};

	for (const event of sorted) {
		const start = new Date(event.startsAt);
		const end = new Date(event.endsAt);
		const top = minutesInto(start);
		// A block always has a hit area, however short the meeting.
		const height = Math.max(20, ((end.getTime() - start.getTime()) / 60_000 / 60) * HOUR);
		const bottom = top + (height / HOUR) * 60;

		if (top >= clusterEnd && cluster.length > 0) close();

		cluster.push({
			event,
			day,
			top: (top / 60) * HOUR,
			height,
			column: cluster.length,
			columns: 1,
		});
		clusterEnd = Math.max(clusterEnd, bottom);
	}

	if (cluster.length > 0) close();
	return blocks;
}

type Drag =
	| { kind: "create"; day: number; from: number; to: number }
	| { kind: "move"; event: WeekEvent; day: number; minutes: number; duration: number }
	| { kind: "resize"; event: WeekEvent; day: number; minutes: number };

/**
 * The week, with hours down the side.
 *
 * This is the view where a calendar stops being a list of dates and starts being
 * a day: an event has a length, two of them can collide, and moving one is a
 * gesture rather than a form. Dragging an empty stretch opens a new event over
 * exactly that stretch; dragging a block moves it, including to another day;
 * dragging its bottom edge changes when it ends. Everything lands on the quarter
 * hour, because nobody means 09:07.
 */
export function WeekGrid({
	days,
	events,
	onOpen,
	onCreate,
	onMove,
}: {
	days: Date[];
	events: WeekEvent[];
	onOpen: (event: WeekEvent) => void;
	onCreate: (start: Date, end: Date) => void;
	onMove: (event: WeekEvent, start: Date, end: Date) => void;
}) {
	const bodyRef = useRef<HTMLDivElement>(null);
	const [drag, setDrag] = useState<Drag | null>(null);
	const [now, setNow] = useState(() => new Date());

	// The line that says "now" is only honest if it moves.
	useEffect(() => {
		const timer = setInterval(() => setNow(new Date()), 60_000);
		return () => clearInterval(timer);
	}, []);

	const timed = useMemo(
		() =>
			days.map((day) =>
				events.filter((event) => !event.allDay && sameDay(new Date(event.startsAt), day)),
			),
		[days, events],
	);

	const allDay = useMemo(
		() =>
			days.map((day) =>
				events.filter((event) => {
					if (!event.allDay) return false;
					const start = startOfDay(new Date(event.startsAt)).getTime();
					const end = startOfDay(new Date(event.endsAt)).getTime();
					const target = startOfDay(day).getTime();
					return target >= start && target <= end;
				}),
			),
		[days, events],
	);

	const blocks = useMemo(() => timed.flatMap((list, day) => layoutDay(list, day)), [timed]);

	/** Where in the grid a pointer is, in day index and minutes past midnight. */
	const locate = useCallback(
		(event: PointerEvent | React.PointerEvent): { day: number; minutes: number } | null => {
			const body = bodyRef.current;
			if (!body) return null;
			const box = body.getBoundingClientRect();
			const columnWidth = box.width / days.length;
			const day = Math.max(
				0,
				Math.min(days.length - 1, Math.floor((event.clientX - box.left) / columnWidth)),
			);
			const minutes = snap(((event.clientY - box.top + body.scrollTop) / HOUR) * 60);
			return { day, minutes };
		},
		[days.length],
	);

	// The gesture is tracked on the document: a pointer that leaves the grid
	// mid-drag must not silently drop the event where it was.
	useEffect(() => {
		if (!drag) return;

		function onPointerMove(event: PointerEvent) {
			const spot = locate(event);
			if (!spot) return;
			setDrag((current) => {
				if (!current) return current;
				if (current.kind === "create") return { ...current, day: current.day, to: spot.minutes };
				if (current.kind === "move") return { ...current, day: spot.day, minutes: spot.minutes };
				return { ...current, minutes: Math.max(spot.minutes, 0) };
			});
		}

		function onPointerUp() {
			setDrag((current) => {
				if (!current) return null;
				const day = days[current.day];
				if (!day) return null;

				if (current.kind === "create") {
					const from = Math.min(current.from, current.to);
					const to = Math.max(current.from, current.to);
					// A click is a drag of no length; it still means "an hour here".
					const span = to - from < SNAP ? 60 : to - from;
					onCreate(at(day, from), at(day, from + span));
				} else if (current.kind === "move") {
					onMove(
						current.event,
						at(day, current.minutes),
						at(day, current.minutes + current.duration),
					);
				} else {
					const start = new Date(current.event.startsAt);
					const from = minutesInto(start);
					const end = Math.max(from + SNAP, current.minutes);
					onMove(current.event, start, at(startOfDay(start), end));
				}

				return null;
			});
		}

		document.addEventListener("pointermove", onPointerMove);
		document.addEventListener("pointerup", onPointerUp, { once: true });
		return () => {
			document.removeEventListener("pointermove", onPointerMove);
			document.removeEventListener("pointerup", onPointerUp);
		};
	}, [drag, days, locate, onCreate, onMove]);

	const preview =
		drag?.kind === "create"
			? {
					day: drag.day,
					top: (Math.min(drag.from, drag.to) / 60) * HOUR,
					height: Math.max(HOUR / 4, (Math.abs(drag.to - drag.from) / 60) * HOUR),
				}
			: null;

	return (
		<div className="flex flex-col overflow-hidden">
			{/* Weekday header, then the all-day band, then the hours. */}
			<div className="flex border-b border-border">
				<div className="w-14 shrink-0 border-r border-border" />
				{days.map((day) => {
					const isToday = sameDay(day, now);
					return (
						<div
							key={day.getTime()}
							className={cn(
								"flex-1 border-r border-border px-2 py-2 text-center last:border-r-0",
								(day.getDay() === 0 || day.getDay() === 6) &&
									"bg-[var(--pogpin-shell-fill-soft)]",
							)}
						>
							<div className="field-label">
								{day.toLocaleDateString(undefined, { weekday: "short" })}
							</div>
							<div
								className={cn(
									"machine mx-auto mt-1 grid size-6 place-items-center rounded-full text-xs tabular-nums",
									isToday
										? "bg-primary font-semibold text-primary-foreground"
										: "text-muted-foreground",
								)}
							>
								{day.getDate()}
							</div>
						</div>
					);
				})}
			</div>

			<div className="flex border-b border-border">
				<div className="field-label w-14 shrink-0 border-r border-border px-2 py-1.5 text-right">
					All day
				</div>
				{days.map((day, index) => (
					<div
						key={day.getTime()}
						className="min-h-9 flex-1 space-y-1 border-r border-border p-1 last:border-r-0"
					>
						{allDay[index]?.map((event) => (
							<button
								key={event.id}
								type="button"
								onClick={() => onOpen(event)}
								className="w-full truncate rounded bg-primary px-1.5 py-0.5 text-left text-[0.6875rem] text-primary-foreground"
							>
								{event.title}
							</button>
						))}
					</div>
				))}
			</div>

			<div ref={bodyRef} className="relative flex max-h-[32rem] overflow-y-auto">
				{/* The hour rail is a column of labels, not a table: the blocks are
				    positioned against the same 48px rhythm. */}
				<div className="w-14 shrink-0 border-r border-border">
					{Array.from({ length: 24 }, (_, hour) => (
						<div key={hour} className="relative" style={{ height: HOUR }}>
							<Machine className="absolute -top-2 right-2 text-[0.625rem]">
								{hour === 0 ? "" : HOUR_LABEL.format(new Date(2026, 0, 1, hour))}
							</Machine>
						</div>
					))}
				</div>

				<div className="relative flex flex-1">
					{days.map((day, index) => (
						<div
							key={day.getTime()}
							className={cn(
								"relative flex-1 border-r border-border last:border-r-0",
								(day.getDay() === 0 || day.getDay() === 6) &&
									"bg-[var(--pogpin-shell-fill-soft)]",
							)}
							onPointerDown={(event) => {
								// Only an empty stretch starts a new event; a block handles its
								// own pointer and stops this from firing.
								if (event.button !== 0) return;
								const spot = locate(event);
								if (!spot) return;
								setDrag({ kind: "create", day: index, from: spot.minutes, to: spot.minutes });
							}}
						>
							{Array.from({ length: 24 }, (_, hour) => (
								<div
									key={hour}
									className="border-b border-border/60"
									style={{ height: HOUR }}
								/>
							))}

							{preview?.day === index ? (
								<div
									aria-hidden
									className="pointer-events-none absolute inset-x-1 rounded border border-[var(--pogpin-brand-border)] bg-accent"
									style={{ top: preview.top, height: preview.height }}
								/>
							) : null}
						</div>
					))}

					{blocks.map((block) => {
						const dragging = drag?.kind !== "create" && drag?.event.id === block.event.id;
						const top =
							dragging && drag?.kind === "move" ? (drag.minutes / 60) * HOUR : block.top;
						const height =
							dragging && drag?.kind === "resize"
								? Math.max(
										HOUR / 4,
										((drag.minutes - minutesInto(new Date(block.event.startsAt))) / 60) * HOUR,
									)
								: block.height;
						const column = dragging && drag?.kind === "move" ? drag.day : block.day;

						return (
							<button
								key={block.event.id}
								type="button"
								onPointerDown={(event) => {
									if (event.button !== 0) return;
									event.stopPropagation();
									const start = new Date(block.event.startsAt);
									const end = new Date(block.event.endsAt);
									const spot = locate(event);
									if (!spot) return;

									// The bottom 8px of a block is its resize handle, the way every
									// calendar draws it.
									const box = event.currentTarget.getBoundingClientRect();
									const onEdge = event.clientY > box.bottom - 8;

									setDrag(
										onEdge
											? { kind: "resize", event: block.event, day: column, minutes: spot.minutes }
											: {
													kind: "move",
													event: block.event,
													day: column,
													minutes: minutesInto(start),
													duration: (end.getTime() - start.getTime()) / 60_000,
												},
									);
								}}
								onClick={() => {
									if (!drag) onOpen(block.event);
								}}
								className={cn(
									"absolute overflow-hidden rounded border border-[var(--pogpin-brand-border)] bg-accent px-1.5 py-0.5 text-left text-[0.6875rem] text-foreground",
									"cursor-grab touch-none select-none hover:bg-[var(--pogpin-brand-surface-hover)]",
									dragging && "z-20 cursor-grabbing shadow-lift",
								)}
								style={{
									top,
									height,
									left: `calc(${(column * 100) / days.length}% + ${(block.column * 100) / (block.columns * days.length)}%)`,
									width: `calc(${100 / days.length / block.columns}% - 4px)`,
								}}
							>
								<Machine className="text-[0.625rem] text-muted-foreground">
									{TIME.format(new Date(block.event.startsAt))}
								</Machine>{" "}
								<span className="font-medium">{block.event.title}</span>
								{block.height > 40 && block.event.location ? (
									<div className="truncate text-[0.625rem] text-muted-foreground">
										{block.event.location}
									</div>
								) : null}
								<span
									aria-hidden
									className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
								/>
							</button>
						);
					})}

					{/* Now, but only in the week that contains it. */}
					{days.some((day) => sameDay(day, now)) ? (
						<div
							aria-hidden
							className="pointer-events-none absolute inset-x-0 z-10 border-t border-[var(--pogpin-danger)]"
							style={{ top: (minutesInto(now) / 60) * HOUR }}
						>
							<span className="absolute -top-1 -left-1 size-2 rounded-full bg-[var(--pogpin-danger)]" />
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}

/** A wall-clock time on a given day. */
function at(day: Date, minutes: number): Date {
	return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);
}
