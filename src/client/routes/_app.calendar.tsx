import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CalendarDays,
	ChevronLeft,
	ChevronRight,
	Download,
	MapPin,
	Plus,
	Send,
	Trash2,
	Upload,
	Users,
} from "lucide-react";
import { Button } from "@/client/components/app/button";
import { Input, Switch, Tabs, TabsList, TabsTrigger, Textarea } from "@/client/components/ui";
import { Choice } from "@/client/components/app/choice";
import { Card, Empty, Field, Machine, PageHeader } from "@/client/components/app/primitives";
import { useToast } from "@/client/components/app/toast-host";
import { Modal } from "@/client/components/app/modal";
import { api, ApiError } from "@/client/lib/api";
import { useMailboxes } from "@/client/lib/queries";
import { qk } from "@/client/lib/queries/keys";
import { z } from "zod";
import { cn } from "@/client/lib/utils";
import { WeekGrid } from "@/client/components/app/week-grid";

const searchSchema = z.object({
	/** `YYYY-MM`, so a link to a month opens on that month. */
	month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
	view: z.enum(["month", "week", "agenda"]).optional(),
	/** `YYYY-MM-DD`; the week view needs a day, not just a month. */
	day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const Route = createFileRoute("/_app/calendar")({
	validateSearch: searchSchema,
	component: Calendar,
});

type CalendarEvent = {
	id: string;
	title: string;
	description: string;
	location: string;
	allDay: boolean;
	attendees: { address: string; name?: string }[];
	/** The mailbox this event is filed against; also who invitations come from. */
	mailboxId: string | null;
	startsAt: string;
	endsAt: string;
};

/*
 * Everything below is local time.
 *
 * The month an operator is looking at is the month on their wall, and an event
 * at 23:30 belongs to the day it is on for them — reading the grid out of
 * `getUTC*` put those events on tomorrow for anyone east of Greenwich and on
 * yesterday for anyone west of it.
 */
function startOfDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function sameDay(a: Date, b: Date): boolean {
	return startOfDay(a).getTime() === startOfDay(b).getTime();
}

/**
 * Six weeks, always, starting on Monday. A grid that changes height between
 * months makes everything under it jump, and the last row of a 5-week month is
 * not a reason to move the page.
 */
function monthMatrix(cursor: Date): Date[] {
	const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
	const lead = (first.getDay() + 6) % 7;
	const start = addDays(first, -lead);
	return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

const TIME = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const DAY_LONG = new Intl.DateTimeFormat(undefined, {
	weekday: "long",
	day: "numeric",
	month: "long",
});
const MONTH_LABEL = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const DAY_SHORT = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

/** A week can straddle two months, so it says both ends. */
function WEEK_LABEL(days: Date[]): string {
	const first = days[0];
	const last = days.at(-1);
	if (!first || !last) return "";
	return `${DAY_SHORT.format(first)} – ${DAY_SHORT.format(last)}, ${last.getFullYear()}`;
}
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type CalendarView = "month" | "week" | "agenda";

/** Radix refuses an empty item value, so "filed against nothing" is spelled out. */
const NO_MAILBOX = "__none";

/** Monday of the week a day falls in. */
function startOfWeek(day: Date): Date {
	return addDays(day, -((day.getDay() + 6) % 7));
}

function dayParam(date: Date): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayFromParam(value: string | undefined, fallback: Date): Date {
	const [year, month, day] = (value ?? "").split("-").map(Number);
	if (!year || !month || !day) return fallback;
	return new Date(year, month - 1, day);
}

function monthParam(date: Date): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/** An unparseable or absent month means this one. */
function monthFromParam(value: string | undefined): Date {
	const [year, month] = (value ?? "").split("-").map(Number);
	if (!year || !month || month < 1 || month > 12) return startOfDay(new Date());
	return new Date(year, month - 1, 1);
}

function pad(value: number): string {
	return String(value).padStart(2, "0");
}

/** `datetime-local` and `date` want a local wall-clock string, not an ISO one. */
function toInput(date: Date, allDay: boolean): string {
	const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
	return allDay ? day : `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function spansDay(event: CalendarEvent, day: Date): boolean {
	const start = startOfDay(new Date(event.startsAt)).getTime();
	// An all-day event stored to 23:59 ends on its own day, not the next one.
	const end = startOfDay(new Date(event.endsAt)).getTime();
	const target = startOfDay(day).getTime();
	return target >= start && target <= end;
}

type Draft = {
	id?: string;
	title: string;
	location: string;
	description: string;
	allDay: boolean;
	attendees: string;
	mailboxId: string | null;
	startsAt: Date;
	endsAt: Date;
};

/** Addresses are typed as one line and stored as a list, like a To field. */
function parseAttendees(value: string): { address: string }[] {
	return value
		.split(/[,;\s]+/)
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((address) => ({ address }));
}

/** A new event starts on the hour the operator is most likely to mean. */
function draftForDay(day: Date): Draft {
	const now = new Date();
	const start = sameDay(day, now)
		? new Date(day.getFullYear(), day.getMonth(), day.getDate(), now.getHours() + 1)
		: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9);

	return {
		title: "",
		location: "",
		description: "",
		allDay: false,
		attendees: "",
		mailboxId: null,
		startsAt: start,
		endsAt: new Date(start.getTime() + 60 * 60 * 1000),
	};
}

function draftFromEvent(event: CalendarEvent): Draft {
	return {
		id: event.id,
		title: event.title,
		location: event.location,
		description: event.description,
		allDay: event.allDay,
		attendees: (event.attendees ?? []).map((entry) => entry.address).join(", "),
		mailboxId: event.mailboxId,
		startsAt: new Date(event.startsAt),
		endsAt: new Date(event.endsAt),
	};
}

function Calendar() {
	const toast = useToast();
	const client = useQueryClient();
	const navigate = useNavigate({ from: "/calendar" });
	const search = useSearch({ from: "/_app/calendar" });
	const [draft, setDraft] = useState<Draft | null>(null);
	const [openDay, setOpenDay] = useState<Date | null>(null);
	const mailboxes = useMailboxes();
	const [dragging, setDragging] = useState<{ event: CalendarEvent; from: Date } | null>(null);
	const [dragOverDay, setDragOverDay] = useState<number | null>(null);
	const [importing, setImporting] = useState(false);
	const icsRef = useRef<HTMLInputElement>(null);

	/*
	 * Which month and which shape live in the URL: a calendar someone sends you
	 * should open where they were looking, and a reload should not throw the
	 * reader back to today.
	 */
	const cursor = useMemo(() => monthFromParam(search.month), [search.month]);
	const view = search.view ?? "month";

	const show = useCallback(
		(next: { month?: Date; day?: Date; view?: CalendarView }) => {
			void navigate({
				search: (prev) => ({
					...prev,
					...(next.month ? { month: monthParam(next.month) } : {}),
					...(next.day ? { day: dayParam(next.day), month: monthParam(next.day) } : {}),
					...(next.view ? { view: next.view } : {}),
				}),
				replace: true,
			});
		},
		[navigate],
	);

	const cells = useMemo(() => monthMatrix(cursor), [cursor]);
	const week = useMemo(
		() => {
			const anchor = dayFromParam(search.day, cursor);
			const monday = startOfWeek(anchor);
			return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
		},
		[search.day, cursor],
	);

	/*
	 * The window is what is on screen, not the calendar month: the month grid
	 * shows the days either side of it, and the week view can straddle two
	 * months, so both are loaded or the edges look empty.
	 */
	const visible = view === "week" ? week : cells;
	const from = visible[0]?.getTime() ?? 0;
	const to = addDays(visible.at(-1) ?? cursor, 1).getTime() - 1;

	const events = useQuery({
		queryKey: qk.calendar(from, to),
		queryFn: async () =>
			(await api.get<{ items: CalendarEvent[] }>("/api/calendar/events", { query: { from, to } }))
				.items,
	});

	const byDay = useMemo(() => {
		const map = new Map<number, CalendarEvent[]>();
		for (const day of cells) {
			// A multi-day event belongs to every day it covers, not only the one it
			// starts on — otherwise a week away from the desk shows as one square.
			const forDay = (events.data ?? [])
				.filter((event) => spansDay(event, day))
				.toSorted((a, b) => {
					if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
					return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
				});
			if (forDay.length) map.set(startOfDay(day).getTime(), forDay);
		}
		return map;
	}, [events.data, cells]);

	const today = startOfDay(new Date());

	/** ‹ and › move by whatever is on screen: a week in the week view, else a month. */
	const step = useCallback(
		(direction: -1 | 1) => {
			if (view === "week") {
				show({ day: addDays(week[0] ?? startOfDay(new Date()), direction * 7) });
				return;
			}
			show({ month: new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1) });
		},
		[cursor, show, view, week],
	);

	const save = useCallback(async (next: Draft) => {
		const payload = {
			title: next.title,
			location: next.location,
			description: next.description,
			allDay: next.allDay,
			attendees: parseAttendees(next.attendees),
			mailboxId: next.mailboxId,
			startsAt: next.startsAt.getTime(),
			endsAt: next.endsAt.getTime(),
		};

		try {
			if (next.id) {
				await api.patch(`/api/calendar/events/${next.id}`, payload);
				toast.ok("Event saved");
			} else {
				await api.post("/api/calendar/events", payload);
				toast.ok("Event added");
			}
			await client.invalidateQueries({ queryKey: ["calendar"] });
			setDraft(null);
		} catch (error) {
			toast.fail(
				"Could not save the event",
				error instanceof ApiError ? error.message : undefined,
			);
		}
	}, [client, toast]);

	/*
	 * Dragging a chip in the month grid moves the event by whole days: the pointer
	 * is asked what is under it rather than every cell listening, and the drop only
	 * counts if it landed on a day. The time of day is left exactly as it was —
	 * a month cell has no hours to read a new one from.
	 */
	useEffect(() => {
		if (!dragging) return;

		function dayUnder(event: PointerEvent): number | null {
			const element = document.elementFromPoint(event.clientX, event.clientY);
			const cell = element?.closest<HTMLElement>("[data-day]");
			const value = Number(cell?.dataset.day);
			return Number.isFinite(value) && value > 0 ? value : null;
		}

		function onPointerMove(event: PointerEvent) {
			setDragOverDay(dayUnder(event));
		}

		function onPointerUp(event: PointerEvent) {
			const target = dayUnder(event);
			setDragOverDay(null);
			setDragging(null);
			if (target === null || !dragging) return;

			const shift = Math.round((target - dragging.from.getTime()) / 86_400_000);
			if (shift === 0) return;

			const start = new Date(dragging.event.startsAt);
			const end = new Date(dragging.event.endsAt);
			void save({
				...draftFromEvent(dragging.event),
				startsAt: addDays(start, shift),
				endsAt: addDays(end, shift),
			});
		}

		document.addEventListener("pointermove", onPointerMove);
		document.addEventListener("pointerup", onPointerUp, { once: true });
		return () => {
			document.removeEventListener("pointermove", onPointerMove);
			document.removeEventListener("pointerup", onPointerUp);
		};
	}, [dragging, save]);

	/*
	 * The shortcuts every calendar has: arrows walk the months, `t` comes home,
	 * `n` opens a new event, `m`/`a` swap the view. They stay out of the way of
	 * anyone typing, and out of the way of an open dialog, which owns the keyboard
	 * while it is up.
	 */
	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if (draft || openDay) return;

			const target = event.target as HTMLElement | null;
			if (target?.closest("input, textarea, select, [contenteditable=true]")) return;

			if (event.key === "ArrowLeft") {
				step(-1);
			} else if (event.key === "ArrowRight") {
				step(1);
			} else if (event.key.toLowerCase() === "t") {
				show({ day: startOfDay(new Date()) });
			} else if (event.key.toLowerCase() === "m") {
				show({ view: "month" });
			} else if (event.key.toLowerCase() === "w") {
				show({ view: "week" });
			} else if (event.key.toLowerCase() === "a") {
				show({ view: "agenda" });
			} else if (event.key.toLowerCase() === "n") {
				setDraft(draftForDay(startOfDay(new Date())));
			} else {
				return;
			}

			event.preventDefault();
		}

		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [draft, openDay, show, step]);
	const monthEvents = (events.data ?? [])
		.filter((event) => new Date(event.startsAt).getMonth() === cursor.getMonth())
		.toSorted((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());


	async function importIcs(file: File | null) {
		if (!file) return;
		setImporting(true);
		try {
			const result = await api.post<{ imported: number; skipped: number }>(
				"/api/calendar/import",
				{ ics: await file.text() },
			);
			await client.invalidateQueries({ queryKey: ["calendar"] });
			toast.ok(
				`Imported ${result.imported} event${result.imported === 1 ? "" : "s"}`,
				result.skipped ? `${result.skipped} were already here.` : undefined,
			);
		} catch (error) {
			toast.fail("Could not import that file", error instanceof ApiError ? error.message : undefined);
		} finally {
			setImporting(false);
			// Without this, picking the same file twice in a row fires no change event.
			if (icsRef.current) icsRef.current.value = "";
		}
	}

	async function invite(id: string) {
		try {
			const result = await api.post<{ invited: number }>(`/api/calendar/events/${id}/invite`);
			toast.ok(
				`Invited ${result.invited} attendee${result.invited === 1 ? "" : "s"}`,
				// Cloudflare only delivers to verified destination addresses, so an
				// invitation can still bounce after this point.
				"The invitation is queued; check Sent for how it went.",
			);
		} catch (error) {
			toast.fail("Could not send the invitation", error instanceof ApiError ? error.message : undefined);
		}
	}


	async function remove(id: string) {
		try {
			await api.delete(`/api/calendar/events/${id}`);
			await client.invalidateQueries({ queryKey: ["calendar"] });
			toast.ok("Event deleted");
			setDraft(null);
		} catch (error) {
			toast.fail("Could not delete the event", error instanceof ApiError ? error.message : undefined);
		}
	}

	return (
		<div className="mx-auto max-w-5xl space-y-5 px-6 py-8">
			<PageHeader
				title="Calendar"
				description="Events you keep alongside your mail. Invitations you accept land here too."
				actions={
					<Button size="sm" title="New event (N)" onClick={() => setDraft(draftForDay(today))}>
						<Plus className="size-3.5" />
						New event
					</Button>
				}
			/>

			{/* Where you are, how to move, and which shape you are reading it in. */}
			<div className="flex flex-wrap items-center gap-3">
				<div className="flex items-center gap-1">
					<Button
						size="icon"
						variant="ghost"
						aria-label={view === "week" ? "Previous week" : "Previous month"}
						title={view === "week" ? "Previous week (←)" : "Previous month (←)"}
						onClick={() => step(-1)}
					>
						<ChevronLeft className="size-4" />
					</Button>
					<Button
						size="icon"
						variant="ghost"
						aria-label={view === "week" ? "Next week" : "Next month"}
						title={view === "week" ? "Next week (→)" : "Next month (→)"}
						onClick={() => step(1)}
					>
						<ChevronRight className="size-4" />
					</Button>
				</div>

				<h2 className="display text-base">
					{view === "week" ? WEEK_LABEL(week) : MONTH_LABEL.format(cursor)}
				</h2>

				<Button size="sm" variant="secondary" title="Today (T)" onClick={() => show({ day: today })}>
					Today
				</Button>

				<Tabs
					value={view}
					onValueChange={(next) => show({ view: next as CalendarView })}
					className="ml-auto"
				>
					<TabsList className="pogpin-shell-tabs rounded-lg p-1">
						<TabsTrigger value="month" title="Month (M)" className="pogpin-shell-tab-trigger rounded-md px-3">
							Month
						</TabsTrigger>
						<TabsTrigger value="week" title="Week (W)" className="pogpin-shell-tab-trigger rounded-md px-3">
							Week
						</TabsTrigger>
						<TabsTrigger value="agenda" title="Agenda (A)" className="pogpin-shell-tab-trigger rounded-md px-3">
							Agenda
						</TabsTrigger>
					</TabsList>
				</Tabs>

				<div className="flex items-center gap-1">
					<input
						ref={icsRef}
						type="file"
						accept=".ics,text/calendar"
						className="hidden"
						aria-hidden
						tabIndex={-1}
						onChange={(event) => void importIcs(event.target.files?.[0] ?? null)}
					/>
					<Button
						size="sm"
						variant="ghost"
						title="Import an .ics file"
						disabled={importing}
						onClick={() => icsRef.current?.click()}
					>
						<Upload className="size-3.5" />
						{importing ? "Importing…" : "Import"}
					</Button>
					<Button asChild size="sm" variant="ghost" title="Download this range as .ics">
						{/* A download is a real navigation, not a fetch. */}
						<a href={`/api/calendar/events.ics?from=${from}&to=${to}`}>
							<Download className="size-3.5" />
							Export
						</a>
					</Button>
				</div>
			</div>

			{view === "week" ? (
				<Card className="overflow-hidden">
					<WeekGrid
						days={week}
						events={events.data ?? []}
						onOpen={(event) => {
							const full = (events.data ?? []).find((entry) => entry.id === event.id);
							if (full) setDraft(draftFromEvent(full));
						}}
						onCreate={(start, end) => setDraft({ ...draftForDay(start), startsAt: start, endsAt: end })}
						onMove={(event, start, end) => {
							const full = (events.data ?? []).find((entry) => entry.id === event.id);
							if (full) void save({ ...draftFromEvent(full), startsAt: start, endsAt: end });
						}}
					/>
				</Card>
			) : view === "month" ? (
				<Card className="overflow-hidden">
					<div className="grid grid-cols-7 border-b border-border bg-[var(--pogpin-shell-panel-alt)]">
						{WEEKDAYS.map((day) => (
							<div key={day} className="field-label px-2 py-2 text-center">
								{day}
							</div>
						))}
					</div>

					<div className="grid grid-cols-7">
						{cells.map((day) => {
							const dayEvents = byDay.get(startOfDay(day).getTime()) ?? [];
							const outside = day.getMonth() !== cursor.getMonth();
							const isToday = sameDay(day, today);
							const weekend = day.getDay() === 0 || day.getDay() === 6;

							return (
								<div
									key={day.getTime()}
									data-day={day.getTime()}
									/*
									 * The whole empty part of a day opens a new event, the way
									 * dragging empty space does in the week view — the date alone
									 * was a 20px target for the commonest action on the screen.
									 */
									onClick={(event) => {
										if ((event.target as HTMLElement).closest("button, a")) return;
										setDraft(draftForDay(day));
									}}
									className={cn(
										"min-h-24 border-r border-b border-border p-1.5 text-left transition-colors last:border-r-0",
										dragOverDay === startOfDay(day).getTime() && "bg-accent",
										weekend && "bg-[var(--pogpin-shell-fill-soft)]",
										outside && "opacity-45",
									)}
								>
									{/* The date opens a new event on that day — the click every
									    calendar has trained people to expect. */}
									<button
										type="button"
										className="flex w-full items-center justify-between rounded px-0.5 hover:text-foreground"
										aria-label={`New event on ${DAY_LONG.format(day)}`}
										onClick={() => setDraft(draftForDay(day))}
									>
										<span
											className={cn(
												"machine grid size-5 place-items-center rounded-full text-[0.6875rem] tabular-nums",
												isToday
													? "bg-primary font-semibold text-primary-foreground"
													: "text-muted-foreground",
											)}
										>
											{day.getDate()}
										</span>
									</button>

									<ul className="mt-1 space-y-1">
										{dayEvents.slice(0, 3).map((event) => (
											<li key={event.id}>
												<EventChip
													event={event}
													day={day}
													dragging={dragging?.event.id === event.id}
													onOpen={() => setDraft(draftFromEvent(event))}
													onPickUp={() => setDragging({ event, from: startOfDay(day) })}
												/>
											</li>
										))}

										{dayEvents.length > 3 ? (
											<li>
												<button
													type="button"
													className="w-full rounded px-1.5 py-0.5 text-left text-[0.6875rem] text-muted-foreground hover:text-foreground"
													onClick={() => setOpenDay(day)}
												>
													{dayEvents.length - 3} more
												</button>
											</li>
										) : null}
									</ul>
								</div>
							);
						})}
					</div>
				</Card>
			) : (
				<Card>
					{monthEvents.length ? (
						<ul className="divide-y divide-border">
							{monthEvents.map((event) => (
								<li key={event.id}>
									<AgendaRow event={event} onOpen={() => setDraft(draftFromEvent(event))} />
								</li>
							))}
						</ul>
					) : (
						<Empty
							title="Nothing this month"
							body="Add an event to keep it beside the mail it came from."
							action={
								<Button size="sm" onClick={() => setDraft(draftForDay(today))}>
									<Plus className="size-3.5" />
									New event
								</Button>
							}
						/>
					)}
				</Card>
			)}

			<EventDialog
				draft={draft}
				mailboxes={mailboxes.data ?? []}
				onClose={() => setDraft(null)}
				onSave={save}
				onDelete={remove}
				onInvite={invite}
			/>

			<Modal
				open={openDay !== null}
				onClose={() => setOpenDay(null)}
				title={openDay ? DAY_LONG.format(openDay) : ""}
			>
				<ul className="divide-y divide-border">
					{(openDay ? (byDay.get(startOfDay(openDay).getTime()) ?? []) : []).map((event) => (
						<li key={event.id}>
							<AgendaRow
								event={event}
								onOpen={() => {
									setOpenDay(null);
									setDraft(draftFromEvent(event));
								}}
							/>
						</li>
					))}
				</ul>
			</Modal>
		</div>
	);
}

/**
 * All-day events read as a filled bar and timed ones as a dot and a time, which
 * is how every calendar people already use draws the difference.
 *
 * An event that runs over several days is one bar, not the same title stamped
 * into every square: only the day it starts on carries the words, the days after
 * it carry the bar, and the rounded ends mark where it actually begins and ends.
 */
function EventChip({
	event,
	day,
	dragging = false,
	onOpen,
	onPickUp,
}: {
	event: CalendarEvent;
	day: Date;
	dragging?: boolean;
	onOpen: () => void;
	onPickUp?: () => void;
}) {
	const start = new Date(event.startsAt);
	const end = new Date(event.endsAt);
	const isStart = sameDay(start, day);
	const isEnd = sameDay(end, day);
	const multiDay = !sameDay(start, end);
	// A bar that carries on into next week says so again on Monday, or the title
	// would be lost above the fold of the row.
	const labelled = isStart || day.getDay() === 1;

	return (
		<button
			type="button"
			onClick={onOpen}
			onPointerDown={(pointer) => {
				// A drag is a move, a click is a read; the pointer decides which.
				if (pointer.button === 0) onPickUp?.();
			}}
			title={event.title}
			aria-label={`${event.title}, ${event.allDay ? "all day" : TIME.format(start)}`}
			className={cn(
				"flex w-full cursor-grab touch-none items-center gap-1.5 truncate px-1.5 py-0.5 text-left text-[0.6875rem] transition-colors",
				dragging && "cursor-grabbing opacity-50",
				event.allDay || multiDay
					? "bg-primary text-primary-foreground"
					: "bg-accent text-foreground hover:bg-[var(--pogpin-brand-surface-hover)]",
				multiDay
					? cn(
							"rounded-none",
							isStart && "rounded-l",
							isEnd && "rounded-r",
							!labelled && "h-[1.125rem]",
						)
					: "rounded",
			)}
		>
			{event.allDay || multiDay ? null : (
				<span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
			)}
			{event.allDay || multiDay ? null : (
				<Machine className="shrink-0 text-[0.625rem] text-muted-foreground">
					{TIME.format(start)}
				</Machine>
			)}
			{labelled ? <span className="truncate">{event.title}</span> : null}
		</button>
	);
}

function AgendaRow({ event, onOpen }: { event: CalendarEvent; onOpen: () => void }) {
	const start = new Date(event.startsAt);
	const end = new Date(event.endsAt);

	return (
		<button
			type="button"
			onClick={onOpen}
			className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-[var(--pogpin-shell-fill-soft)]"
		>
			<div className="w-24 shrink-0">
				<div className="text-sm font-medium text-foreground">{DAY_LONG.format(start)}</div>
				<Machine className="text-xs">
					{event.allDay ? "All day" : `${TIME.format(start)}–${TIME.format(end)}`}
				</Machine>
			</div>

			<div className="min-w-0 flex-1">
				<div className="truncate text-sm text-foreground">{event.title}</div>
				<div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
					{event.location ? (
						<span className="flex min-w-0 items-center gap-1.5">
							<MapPin aria-hidden className="size-3 shrink-0" />
							<span className="truncate">{event.location}</span>
						</span>
					) : null}
					{event.attendees?.length ? (
						<span className="flex items-center gap-1.5">
							<Users aria-hidden className="size-3 shrink-0" />
							{event.attendees.length} attendee{event.attendees.length === 1 ? "" : "s"}
						</span>
					) : null}
				</div>
			</div>
		</button>
	);
}

/**
 * One dialog for both jobs. An event that exists can be changed or deleted from
 * the same place it is read, rather than being write-once the way the create-only
 * form left it.
 */
function EventDialog({
	draft,
	mailboxes,
	onClose,
	onSave,
	onDelete,
	onInvite,
}: {
	draft: Draft | null;
	mailboxes: { id: string; address: string }[];
	onClose: () => void;
	onSave: (draft: Draft) => Promise<void>;
	onDelete: (id: string) => Promise<void>;
	onInvite: (id: string) => Promise<void>;
}) {
	if (!draft) return null;
	return (
		<EventForm
			key={draft.id ?? draft.startsAt.getTime()}
			draft={draft}
			mailboxes={mailboxes}
			onClose={onClose}
			onSave={onSave}
			onDelete={onDelete}
			onInvite={onInvite}
		/>
	);
}

function EventForm({
	draft,
	mailboxes,
	onClose,
	onSave,
	onDelete,
	onInvite,
}: {
	draft: Draft;
	mailboxes: { id: string; address: string }[];
	onClose: () => void;
	onSave: (draft: Draft) => Promise<void>;
	onDelete: (id: string) => Promise<void>;
	onInvite: (id: string) => Promise<void>;
}) {
	const [title, setTitle] = useState(draft.title);
	const [location, setLocation] = useState(draft.location);
	const [description, setDescription] = useState(draft.description);
	const [allDay, setAllDay] = useState(draft.allDay);
	const [attendees, setAttendees] = useState(draft.attendees);
	const [mailboxId, setMailboxId] = useState(draft.mailboxId ?? NO_MAILBOX);
	const [inviting, setInviting] = useState(false);
	const [startsAt, setStartsAt] = useState(draft.startsAt);
	const [endsAt, setEndsAt] = useState(draft.endsAt);
	const [saving, setSaving] = useState(false);

	const invalid = endsAt.getTime() < startsAt.getTime();

	function parse(value: string, endOfDay: boolean): Date | null {
		if (!value) return null;
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return null;
		// A date input carries no time, so an all-day event owns the whole day.
		return allDay && endOfDay
			? new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 23, 59, 59)
			: parsed;
	}

	return (
		<Modal open onClose={onClose} title={draft.id ? "Event" : "New event"}>
			<form
				className="space-y-4"
				onSubmit={async (event) => {
					event.preventDefault();
					setSaving(true);
					await onSave({
						...draft,
						title,
						location,
						description,
						allDay,
						attendees,
						mailboxId: mailboxId === NO_MAILBOX ? null : mailboxId,
						startsAt,
						endsAt,
					});
					setSaving(false);
				}}
			>
				<Field label="Title">
					<Input
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						required
						autoFocus
						maxLength={200}
						placeholder="Standup"
					/>
				</Field>

				<label className="flex items-center gap-2.5 text-sm">
					<Switch
						checked={allDay}
						onCheckedChange={(next) => {
							setAllDay(next);
							// Switching to all-day keeps the days and drops the clock.
							if (next) {
								setStartsAt(startOfDay(startsAt));
								setEndsAt(
									new Date(
										endsAt.getFullYear(),
										endsAt.getMonth(),
										endsAt.getDate(),
										23,
										59,
										59,
									),
								);
							}
						}}
					/>
					All day
				</label>

				<div className="grid gap-3 sm:grid-cols-2">
					<Field label="Starts">
						<Input
							type={allDay ? "date" : "datetime-local"}
							value={toInput(startsAt, allDay)}
							required
							onChange={(event) => {
								const next = parse(event.target.value, false);
								if (!next) return;
								setStartsAt(next);
								// Dragging the start past the end moves the end with it, which
								// is less annoying than a validation error.
								if (next.getTime() > endsAt.getTime()) {
									setEndsAt(new Date(next.getTime() + 60 * 60 * 1000));
								}
							}}
						/>
					</Field>

					<Field
						label="Ends"
						error={invalid ? "An event cannot end before it starts." : undefined}
					>
						<Input
							type={allDay ? "date" : "datetime-local"}
							value={toInput(endsAt, allDay)}
							required
							aria-invalid={invalid}
							onChange={(event) => {
								const next = parse(event.target.value, true);
								if (next) setEndsAt(next);
							}}
						/>
					</Field>
				</div>

				<Field label="Location">
					<Input
						value={location}
						onChange={(event) => setLocation(event.target.value)}
						maxLength={300}
						placeholder="Meeting room, or a link"
					/>
				</Field>

				{/*
				 * The mailbox is what files the event beside its mail — and it is the
				 * address an invitation is sent from, which is why inviting anyone
				 * without one is refused rather than guessed at.
				 */}
				<Field label="Mailbox" hint="Invitations are sent from this address.">
					<Choice
						value={mailboxId}
						onChange={setMailboxId}
						aria-label="Mailbox"
						options={[
							{ value: NO_MAILBOX, label: "Not filed against a mailbox" },
							...mailboxes.map((mailbox) => ({ value: mailbox.id, label: mailbox.address })),
						]}
					/>
				</Field>

				<Field label="Attendees" hint="Separate addresses with commas.">
					<Input
						value={attendees}
						onChange={(event) => setAttendees(event.target.value)}
						autoComplete="off"
						className="machine"
						placeholder="name@example.com"
					/>
				</Field>

				<Field label="Notes">
					<Textarea
						value={description}
						onChange={(event) => setDescription(event.target.value)}
						rows={3}
					/>
				</Field>

				{draft.id && parseAttendees(attendees).length > 0 ? (
					<div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2">
						<Button
							type="button"
							size="sm"
							variant="secondary"
							disabled={inviting || mailboxId === NO_MAILBOX}
							onClick={async () => {
								if (!draft.id) return;
								setInviting(true);
								await onInvite(draft.id);
								setInviting(false);
							}}
						>
							<Send className="size-3.5" />
							{inviting ? "Sending…" : `Invite ${parseAttendees(attendees).length}`}
						</Button>
						<p className="text-xs text-muted-foreground">
							{mailboxId === NO_MAILBOX
								? "Pick a mailbox first — an invitation has to come from an address."
								: "Sends an .ics invitation, saved to that mailbox's Sent folder. Save your edits first."}
						</p>
					</div>
				) : null}

				<div className="flex items-center justify-end gap-2 pt-2">
					{draft.id ? (
						<Button
							type="button"
							variant="ghost"
							className="mr-auto text-muted-foreground hover:text-fail"
							onClick={() => draft.id && void onDelete(draft.id)}
						>
							<Trash2 className="size-3.5" />
							Delete
						</Button>
					) : null}

					<Button type="button" variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button type="submit" disabled={saving || invalid}>
						<CalendarDays className="size-3.5" />
						{draft.id ? "Save event" : "Add event"}
					</Button>
				</div>
			</form>
		</Modal>
	);
}
