import { describe, expect, it } from "vitest";
import { parseIcs, toIcs } from "@/worker/calendar/ics";

const event = {
	id: "evt-1",
	title: "Standup, daily",
	description: "Line one\nLine two",
	location: "Room 2; upstairs",
	allDay: false,
	startsAt: new Date("2026-09-05T09:30:00.000Z"),
	endsAt: new Date("2026-09-05T10:00:00.000Z"),
	attendees: [{ address: "ana@example.test", name: "Ana" }],
};

describe("toIcs", () => {
	it("writes a calendar another client will accept", () => {
		const ics = toIcs([event], { host: "mail.example.test" });

		expect(ics).toContain("BEGIN:VCALENDAR");
		expect(ics).toContain("METHOD:PUBLISH");
		expect(ics).toContain("UID:evt-1@mail.example.test");
		expect(ics).toContain("DTSTART:20260905T093000Z");
		expect(ics).toContain("DTEND:20260905T100000Z");
		// Commas, semicolons and newlines are structural in iCalendar.
		expect(ics).toContain("SUMMARY:Standup\\, daily");
		expect(ics).toContain("LOCATION:Room 2\\; upstairs");
		expect(ics).toContain("DESCRIPTION:Line one\\nLine two");
		expect(ics).toContain("ATTENDEE;ROLE=REQ-PARTICIPANT");
		// Every line ends CRLF, which strict parsers do enforce.
		expect(ics.split("\r\n").length).toBeGreaterThan(10);
	});

	it("ends an all-day event on the next day, because a DATE end is exclusive", () => {
		const ics = toIcs(
			[
				{
					...event,
					allDay: true,
					startsAt: new Date("2026-09-05T00:00:00.000Z"),
					endsAt: new Date("2026-09-05T23:59:59.000Z"),
				},
			],
			{ host: "mail.example.test" },
		);

		expect(ics).toContain("DTSTART;VALUE=DATE:20260905");
		expect(ics).toContain("DTEND;VALUE=DATE:20260906");
	});

	it("names an organizer only for an invitation", () => {
		const invite = toIcs([event], {
			host: "mail.example.test",
			method: "REQUEST",
			organizer: { address: "hello@example.test", name: "Hello" },
		});

		expect(invite).toContain("METHOD:REQUEST");
		expect(invite).toContain("ORGANIZER;CN=Hello:mailto:hello@example.test");
		expect(toIcs([event], { host: "mail.example.test" })).not.toContain("ORGANIZER");
	});

	it("folds a long line so a strict parser does not reject it", () => {
		const ics = toIcs([{ ...event, description: "x".repeat(400) }], {
			host: "mail.example.test",
		});

		for (const line of ics.split("\r\n")) {
			expect(line.length).toBeLessThanOrEqual(75);
		}
	});
});

describe("parseIcs", () => {
	it("reads back what it wrote", () => {
		const [parsed] = parseIcs(toIcs([event], { host: "mail.example.test" }));

		expect(parsed?.title).toBe("Standup, daily");
		expect(parsed?.location).toBe("Room 2; upstairs");
		expect(parsed?.description).toBe("Line one\nLine two");
		expect(parsed?.allDay).toBe(false);
		expect(parsed?.startsAt).toBe(event.startsAt.getTime());
		expect(parsed?.endsAt).toBe(event.endsAt.getTime());
		expect(parsed?.attendees).toEqual([{ address: "ana@example.test", name: "Ana" }]);
	});

	it("turns an exclusive DATE end back into the last moment of the last day", () => {
		const [parsed] = parseIcs(
			[
				"BEGIN:VCALENDAR",
				"BEGIN:VEVENT",
				"SUMMARY:Away",
				"DTSTART;VALUE=DATE:20260905",
				"DTEND;VALUE=DATE:20260908",
				"END:VEVENT",
				"END:VCALENDAR",
			].join("\r\n"),
		);

		expect(parsed?.allDay).toBe(true);
		expect(parsed?.startsAt).toBe(Date.UTC(2026, 8, 5));
		// The 8th is exclusive, so the event owns the 5th, 6th and 7th.
		expect(parsed?.endsAt).toBe(Date.UTC(2026, 8, 8) - 1000);
	});

	it("unfolds continued lines", () => {
		const [parsed] = parseIcs(
			[
				"BEGIN:VEVENT",
				"SUMMARY:A very long title that a",
				"  strict writer folded in two",
				"DTSTART:20260905T090000Z",
				"END:VEVENT",
			].join("\r\n"),
		);

		expect(parsed?.title).toBe("A very long title that a strict writer folded in two");
	});

	it("skips components and properties it does not carry", () => {
		const parsed = parseIcs(
			[
				"BEGIN:VCALENDAR",
				"BEGIN:VTIMEZONE",
				"TZID:Europe/Berlin",
				"END:VTIMEZONE",
				"BEGIN:VEVENT",
				"SUMMARY:Repeats",
				"DTSTART:20260905T090000Z",
				"RRULE:FREQ=WEEKLY;COUNT=10",
				"BEGIN:VALARM",
				"TRIGGER:-PT15M",
				"END:VALARM",
				"END:VEVENT",
				"BEGIN:VTODO",
				"SUMMARY:Not an event",
				"END:VTODO",
				"END:VCALENDAR",
			].join("\r\n"),
		);

		// One event, and no invented recurrence: the repeats are dropped, not guessed.
		expect(parsed).toHaveLength(1);
		expect(parsed[0]?.title).toBe("Repeats");
		expect(parsed[0]?.endsAt).toBe(Date.UTC(2026, 8, 5, 10));
	});

	it("ignores an event with no title or no start", () => {
		expect(parseIcs("BEGIN:VEVENT\r\nDTSTART:20260905T090000Z\r\nEND:VEVENT")).toHaveLength(0);
		expect(parseIcs("BEGIN:VEVENT\r\nSUMMARY:No when\r\nEND:VEVENT")).toHaveLength(0);
	});
});
