type Event = {
	id: string;
	startsAt: Date;
	endsAt: Date;
	recurrenceRule: string | null;
};

/** Expand the common RFC 5545 frequencies that Pogmail can author safely. */
export function expandRecurrences<T extends Event>(
	events: T[],
	from: Date,
	to: Date,
): Array<T & { id: string; seriesId: string }> {
	return events.flatMap((event) => expand(event, from, to));
}

function expand<T extends Event>(
	event: T,
	from: Date,
	to: Date,
): Array<T & { id: string; seriesId: string }> {
	if (!event.recurrenceRule) return [{ ...event, seriesId: event.id }];
	const rule = Object.fromEntries(event.recurrenceRule.split(";").map((part) => part.split("=", 2)));
	const frequency = rule.FREQ;
	if (frequency !== "DAILY" && frequency !== "WEEKLY" && frequency !== "MONTHLY") return [{ ...event, seriesId: event.id }];
	const interval = Math.max(1, Number(rule.INTERVAL) || 1);
	const count = Math.min(10_000, Math.max(1, Number(rule.COUNT) || 10_000));
	const until = rule.UNTIL ? parseUntil(rule.UNTIL) : null;
	const duration = event.endsAt.getTime() - event.startsAt.getTime();
	const out: Array<T & { id: string; seriesId: string }> = [];
	let start = new Date(event.startsAt);
	for (let index = 0; index < count; index += 1) {
		if (start > to || (until && start > until)) break;
		const end = new Date(start.getTime() + duration);
		if (end >= from) out.push({ ...event, id: `${event.id}~${start.getTime()}`, seriesId: event.id, startsAt: new Date(start), endsAt: end });
		if (frequency === "DAILY") start.setDate(start.getDate() + interval);
		else if (frequency === "WEEKLY") start.setDate(start.getDate() + interval * 7);
		else start.setMonth(start.getMonth() + interval);
	}
	return out;
}

function parseUntil(value: string): Date | null {
	const match = value.match(/^(\d{4})(\d{2})(\d{2})/);
	return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59)) : null;
}
