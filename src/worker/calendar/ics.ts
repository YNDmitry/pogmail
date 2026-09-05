import type { MailAddress } from "@/shared/contract/mail";

/**
 * iCalendar, by hand.
 *
 * RFC 5545 is large and almost none of it is needed to hand an event to another
 * calendar: a `VEVENT` with a summary, a start and an end covers every
 * invitation this product creates or accepts. Anything richer — recurrence,
 * alarms, time-zone definitions — is read past rather than guessed at, because a
 * wrong recurrence is worse than a missing one.
 */

export type IcsEvent = {
	id: string;
	title: string;
	description: string;
	location: string;
	allDay: boolean;
	startsAt: Date;
	endsAt: Date;
	attendees: MailAddress[];
};

/** RFC 5545 §3.3.11: commas, semicolons, backslashes and newlines are escaped. */
function escapeText(value: string): string {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll(";", "\\;")
		.replaceAll(",", "\\,")
		.replaceAll("\n", "\\n");
}

function unescapeText(value: string): string {
	return value
		.replaceAll("\\n", "\n")
		.replaceAll("\\N", "\n")
		.replaceAll("\\,", ",")
		.replaceAll("\\;", ";")
		.replaceAll("\\\\", "\\");
}

const pad = (value: number) => String(value).padStart(2, "0");

/** `19980118T230000Z` — the only form that needs no VTIMEZONE to be read right. */
function utcStamp(date: Date): string {
	return (
		`${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
		`T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
	);
}

function dateStamp(date: Date): string {
	return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

/**
 * Content lines are folded at 75 octets. Long descriptions and long addresses
 * are exactly what a strict parser on the other end rejects when they are not.
 */
function fold(line: string): string {
	if (line.length <= 75) return line;
	const parts: string[] = [line.slice(0, 75)];
	for (let index = 75; index < line.length; index += 74) {
		parts.push(` ${line.slice(index, index + 74)}`);
	}
	return parts.join("\r\n");
}

function vevent(event: IcsEvent, host: string, organizer?: MailAddress): string[] {
	const lines = [
		"BEGIN:VEVENT",
		`UID:${event.id}@${host}`,
		`DTSTAMP:${utcStamp(new Date())}`,
	];

	if (event.allDay) {
		// A DATE end is exclusive, so a single all-day event ends on the next day.
		const endExclusive = new Date(event.endsAt);
		endExclusive.setUTCHours(0, 0, 0, 0);
		endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
		lines.push(`DTSTART;VALUE=DATE:${dateStamp(event.startsAt)}`);
		lines.push(`DTEND;VALUE=DATE:${dateStamp(endExclusive)}`);
	} else {
		lines.push(`DTSTART:${utcStamp(event.startsAt)}`);
		lines.push(`DTEND:${utcStamp(event.endsAt)}`);
	}

	lines.push(`SUMMARY:${escapeText(event.title)}`);
	if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
	if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);

	if (organizer) {
		const name = organizer.name ? `;CN=${escapeText(organizer.name)}` : "";
		lines.push(`ORGANIZER${name}:mailto:${organizer.address}`);
	}

	for (const attendee of event.attendees) {
		const name = attendee.name ? `;CN=${escapeText(attendee.name)}` : "";
		lines.push(
			`ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE${name}:mailto:${attendee.address}`,
		);
	}

	lines.push("END:VEVENT");
	return lines;
}

/**
 * A calendar an operator can hand to anything else. `method` is `PUBLISH` for an
 * export and `REQUEST` for an invitation — the same bytes mean "here is my
 * calendar" or "please answer this" depending on it.
 */
export function toIcs(
	events: IcsEvent[],
	options: { host: string; method?: "PUBLISH" | "REQUEST"; organizer?: MailAddress },
): string {
	const lines = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Pogmail//Calendar//EN",
		"CALSCALE:GREGORIAN",
		`METHOD:${options.method ?? "PUBLISH"}`,
		...events.flatMap((event) => vevent(event, options.host, options.organizer)),
		"END:VCALENDAR",
	];

	return `${lines.map(fold).join("\r\n")}\r\n`;
}

export type ParsedIcsEvent = {
	title: string;
	description: string;
	location: string;
	allDay: boolean;
	startsAt: number;
	endsAt: number;
	attendees: MailAddress[];
};

/** Undoes the folding first: a value can be split across any number of lines. */
function unfold(text: string): string[] {
	return text
		.replace(/\r\n/g, "\n")
		.replace(/\n[ \t]/g, "")
		.split("\n")
		.filter((line) => line.trim().length > 0);
}

function parseStamp(value: string, isDate: boolean): number | null {
	const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
	if (!match) return null;

	const [, year, month, day, hour, minute, second] = match;
	const parts = [Number(year), Number(month) - 1, Number(day)] as const;

	if (isDate || hour === undefined) {
		// A date has no time zone to get wrong; midnight UTC keeps the day stable.
		return Date.UTC(parts[0], parts[1], parts[2]);
	}

	// With a trailing `Z` the value is UTC. Without one it is floating, or in a
	// TZID this parser deliberately does not carry — reading both as UTC is the
	// one choice that never silently moves an event to another day.
	const time = [Number(hour), Number(minute ?? 0), Number(second ?? 0)] as const;
	return Date.UTC(parts[0], parts[1], parts[2], time[0], time[1], time[2]);
}

/**
 * Reads the `VEVENT`s out of an iCalendar file. Unknown properties, other
 * components (`VTODO`, `VTIMEZONE`, `VALARM`) and recurrence rules are skipped:
 * an event that arrives without its repeats is honest, an event with invented
 * repeats is not.
 */
export function parseIcs(text: string): ParsedIcsEvent[] {
	const events: ParsedIcsEvent[] = [];
	let current: Partial<ParsedIcsEvent> & { attendees: MailAddress[] } = { attendees: [] };
	let inEvent = false;

	for (const line of unfold(text)) {
		if (line.startsWith("BEGIN:VEVENT")) {
			inEvent = true;
			current = { attendees: [] };
			continue;
		}

		if (line.startsWith("END:VEVENT")) {
			inEvent = false;
			if (current.title && current.startsAt !== undefined) {
				const startsAt = current.startsAt;
				const allDay = current.allDay ?? false;
				// An exclusive DATE end is stored as the last moment of the last day,
				// which is how the rest of this product keeps all-day events.
				const endsAt = current.endsAt ?? (allDay ? startsAt + 86_399_000 : startsAt + 3_600_000);

				events.push({
					title: current.title,
					description: current.description ?? "",
					location: current.location ?? "",
					allDay,
					startsAt,
					endsAt: allDay ? endsAt - 1000 : endsAt,
					attendees: current.attendees,
				});
			}
			continue;
		}

		if (!inEvent) continue;

		const colon = line.indexOf(":");
		if (colon < 0) continue;
		const rawName = line.slice(0, colon);
		const value = line.slice(colon + 1);
		const [name, ...params] = rawName.split(";");
		const isDate = params.some((param) => param.toUpperCase() === "VALUE=DATE");

		switch (name?.toUpperCase()) {
			case "SUMMARY":
				current.title = unescapeText(value).slice(0, 200);
				break;
			case "DESCRIPTION":
				current.description = unescapeText(value).slice(0, 5000);
				break;
			case "LOCATION":
				current.location = unescapeText(value).slice(0, 300);
				break;
			case "DTSTART": {
				const parsed = parseStamp(value, isDate);
				if (parsed !== null) {
					current.startsAt = parsed;
					current.allDay = isDate;
				}
				break;
			}
			case "DTEND": {
				const parsed = parseStamp(value, isDate);
				if (parsed !== null) current.endsAt = parsed;
				break;
			}
			case "ATTENDEE": {
				const address = value.replace(/^mailto:/i, "").trim();
				const common = params
					.find((param) => param.toUpperCase().startsWith("CN="))
					?.slice(3)
					.replaceAll('"', "");
				if (address.includes("@")) {
					current.attendees.push(
						common ? { address, name: unescapeText(common) } : { address },
					);
				}
				break;
			}
			default:
				break;
		}
	}

	return events;
}
