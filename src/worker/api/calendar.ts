import { Hono } from "hono";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { calendarEvents, messageAttachments, messages, outboundJobs } from "@/db/schema";
import { audit } from "../audit";
import { parseIcs, toIcs } from "../calendar/ics";
import { sendableMailbox } from "./send";
import type { OutboundSendMessage } from "../email/types";
import type { AppBindings } from "../middleware/context";
import { notFound, parseBody, parseQuery } from "./_util";

const rangeQuery = z.object({
	/** Epoch milliseconds; the UI sends the visible month's bounds. */
	from: z.coerce.number().int(),
	to: z.coerce.number().int(),
});

const importInput = z.object({
	ics: z.string().min(1).max(2_000_000),
	/** Imported events can be filed against a mailbox, the same as authored ones. */
	mailboxId: z.string().nullable().optional(),
});

const eventInput = z
	.object({
		title: z.string().min(1).max(200),
		description: z.string().max(5000).default(""),
		location: z.string().max(300).default(""),
		mailboxId: z.string().nullable().optional(),
		/** Set when the event was made from a message, so the two stay findable. */
		messageId: z.string().nullable().optional(),
		attendees: z.array(z.object({ address: z.email(), name: z.string().optional() })).default([]),
		allDay: z.boolean().default(false),
		startsAt: z.number().int(),
		endsAt: z.number().int(),
	})
	.refine((value) => value.endsAt >= value.startsAt, {
		message: "An event cannot end before it starts",
		path: ["endsAt"],
	});

export const calendarRoutes = new Hono<AppBindings>()
	.get("/events", async (c) => {
		const range = await parseQuery(c, rangeQuery);

		const rows = await c
			.get("db")
			.select()
			.from(calendarEvents)
			.where(
				and(
					eq(calendarEvents.userId, c.get("user").id),
					// Overlap, not containment: a multi-day event straddling the window counts.
					lte(calendarEvents.startsAt, new Date(range.to)),
					gte(calendarEvents.endsAt, new Date(range.from)),
				),
			)
			.orderBy(asc(calendarEvents.startsAt))
			.all();

		return c.json({ items: rows });
	})

	.post("/events", async (c) => {
		const input = await parseBody(c, eventInput);

		const row = await c
			.get("db")
			.insert(calendarEvents)
			.values({
				...input,
				mailboxId: input.mailboxId ?? null,
				messageId: input.messageId ?? null,
				userId: c.get("user").id,
				startsAt: new Date(input.startsAt),
				endsAt: new Date(input.endsAt),
			})
			.returning()
			.get();

		return c.json(row, 201);
	})

	.patch("/events/:id", async (c) => {
		const { startsAt, endsAt, ...rest } = await parseBody(c, eventInput.partial());

		const row = await c
			.get("db")
			.update(calendarEvents)
			.set({
				...rest,
				...(startsAt !== undefined ? { startsAt: new Date(startsAt) } : {}),
				...(endsAt !== undefined ? { endsAt: new Date(endsAt) } : {}),
			})
			.where(
				and(eq(calendarEvents.id, c.req.param("id")), eq(calendarEvents.userId, c.get("user").id)),
			)
			.returning()
			.get();

		if (!row) notFound("Event");
		return c.json(row);
	})

	.delete("/events/:id", async (c) => {
		const row = await c
			.get("db")
			.delete(calendarEvents)
			.where(
				and(eq(calendarEvents.id, c.req.param("id")), eq(calendarEvents.userId, c.get("user").id)),
			)
			.returning({ id: calendarEvents.id })
			.get();

		if (!row) notFound("Event");
		return c.json({ ok: true });
	});

/**
 * Everything below moves events between this calendar and the rest of the world:
 * iCalendar out, iCalendar in, and an invitation posted as real mail.
 */
export const calendarInteropRoutes = new Hono<AppBindings>()
	/** The visible range, or everything, as an .ics file. */
	.get("/events.ics", async (c) => {
		const from = Number(c.req.query("from"));
		const to = Number(c.req.query("to"));
		const bounded = Number.isFinite(from) && Number.isFinite(to);

		const rows = await c
			.get("db")
			.select()
			.from(calendarEvents)
			.where(
				bounded
					? and(
							eq(calendarEvents.userId, c.get("user").id),
							lte(calendarEvents.startsAt, new Date(to)),
							gte(calendarEvents.endsAt, new Date(from)),
						)
					: eq(calendarEvents.userId, c.get("user").id),
			)
			.orderBy(asc(calendarEvents.startsAt))
			.all();

		const body = toIcs(
			rows.map((row) => ({
				id: row.id,
				title: row.title,
				description: row.description,
				location: row.location,
				allDay: row.allDay,
				startsAt: row.startsAt,
				endsAt: row.endsAt,
				attendees: row.attendees,
			})),
			{ host: new URL(c.req.url).host },
		);

		return new Response(body, {
			headers: {
				"content-type": "text/calendar; charset=utf-8",
				"content-disposition": `attachment; filename="pogmail-calendar.ics"`,
			},
		});
	})

	/**
	 * Reads an .ics file into the calendar. An event already stored with the same
	 * title at the same instant is skipped, so importing the same file twice is
	 * safe — the same rule the mail importer follows.
	 */
	.post("/import", async (c) => {
		const input = await parseBody(c, importInput);
		const parsed = parseIcs(input.ics);
		if (parsed.length === 0) {
			throw new HTTPException(422, { message: "No events found in that file" });
		}

		const existing = await c
			.get("db")
			.select({ title: calendarEvents.title, startsAt: calendarEvents.startsAt })
			.from(calendarEvents)
			.where(eq(calendarEvents.userId, c.get("user").id))
			.all();

		const seen = new Set(existing.map((row) => `${row.title}@${row.startsAt.getTime()}`));

		let imported = 0;
		for (const event of parsed.slice(0, 500)) {
			if (seen.has(`${event.title}@${event.startsAt}`)) continue;
			seen.add(`${event.title}@${event.startsAt}`);

			await c
				.get("db")
				.insert(calendarEvents)
				.values({
					userId: c.get("user").id,
					mailboxId: input.mailboxId ?? null,
					title: event.title,
					description: event.description,
					location: event.location,
					attendees: event.attendees,
					allDay: event.allDay,
					startsAt: new Date(event.startsAt),
					endsAt: new Date(event.endsAt),
				});
			imported += 1;
		}

		audit(c, { action: "calendar.import", metadata: { imported, found: parsed.length } });
		return c.json({ imported, skipped: parsed.length - imported });
	})

	/**
	 * Mails the event to its attendees as an invitation.
	 *
	 * It goes out as an ordinary outbound message — a row in `messages` with the
	 * `.ics` as its attachment, queued on `OUTBOUND_QUEUE` — so it inherits the
	 * retries, the audit trail and the Sent folder rather than growing a second
	 * delivery path. Cloudflare only sends to verified destination addresses, so
	 * an invitation to an unverified one fails on the queue, not here.
	 */
	.post("/events/:id/invite", async (c) => {
		const event = await c
			.get("db")
			.select()
			.from(calendarEvents)
			.where(
				and(eq(calendarEvents.id, c.req.param("id")), eq(calendarEvents.userId, c.get("user").id)),
			)
			.get();
		if (!event) notFound("Event");

		if (!event.mailboxId) {
			throw new HTTPException(422, {
				message: "Pick the mailbox this event belongs to before inviting anyone",
			});
		}
		if (event.attendees.length === 0) {
			throw new HTTPException(422, { message: "Add at least one attendee" });
		}

		const mailbox = await sendableMailbox(c, event.mailboxId);
		const host = new URL(c.req.url).host;
		const ics = toIcs(
			[
				{
					id: event.id,
					title: event.title,
					description: event.description,
					location: event.location,
					allDay: event.allDay,
					startsAt: event.startsAt,
					endsAt: event.endsAt,
					attendees: event.attendees,
				},
			],
			{
				host,
				method: "REQUEST",
				organizer: { address: mailbox.address, ...(mailbox.displayName ? { name: mailbox.displayName } : {}) },
			},
		);

		const when = event.allDay
			? event.startsAt.toISOString().slice(0, 10)
			: `${event.startsAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;

		const message = await c
			.get("db")
			.insert(messages)
			.values({
				mailboxId: mailbox.id,
				authorUserId: c.get("user").id,
				direction: "outbound",
				status: "sent",
				threadId: crypto.randomUUID(),
				subject: `Invitation: ${event.title}`,
				fromAddress: mailbox.address,
				fromName: mailbox.displayName,
				toAddresses: event.attendees,
				ccAddresses: [],
				bccAddresses: [],
				bodyText: [
					event.title,
					`When: ${when}`,
					...(event.location ? [`Where: ${event.location}`] : []),
					...(event.description ? ["", event.description] : []),
				].join("\n"),
				snippet: `Invitation: ${event.title}`,
				hasAttachments: true,
				read: true,
				receivedAt: new Date(),
			})
			.returning()
			.get();

		const key = `attachments/${crypto.randomUUID()}`;
		await c.env.MAIL_BUCKET.put(key, ics, {
			httpMetadata: { contentType: "text/calendar; charset=utf-8" },
		});

		await c
			.get("db")
			.insert(messageAttachments)
			.values({
				messageId: message.id,
				filename: "invite.ics",
				// The method belongs on the part: it is what tells a mail client to
				// offer Accept and Decline instead of a file to download.
				contentType: 'text/calendar; charset=utf-8; method=REQUEST; name="invite.ics"',
				sizeBytes: new TextEncoder().encode(ics).byteLength,
				disposition: "attachment",
				r2Key: key,
			});

		const job = await c
			.get("db")
			.insert(outboundJobs)
			.values({ messageId: message.id })
			.returning()
			.get();

		const payload: OutboundSendMessage = { kind: "outbound", jobId: job.id };
		await c.env.OUTBOUND_QUEUE.send(payload);

		audit(c, {
			action: "calendar.invite",
			mailboxId: mailbox.id,
			messageId: message.id,
			metadata: { attendees: event.attendees.length },
		});
		return c.json({ invited: event.attendees.length, messageId: message.id }, 202);
	});
