import { Hono, type Context } from "hono";
import { and, asc, eq, gte, isNotNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { calendarConnections, calendarEventLinks, calendarEvents, calendarOAuthStates, messageAttachments, messages, outboundJobs } from "@/db/schema";
import { audit } from "../audit";
import { parseIcs, toIcs } from "../calendar/ics";
import { decryptSecret, encryptSecret, SecretKeyMissing } from "../auth/secrets";
import { deleteCalendarEventFromConnection, syncCalendarConnection } from "../calendar/sync";
import { expandRecurrences } from "../calendar/recurrence";
import { sendableMailbox } from "./send";
import type { OutboundSendMessage } from "../email/types";
import type { AppBindings } from "../middleware/context";
import { notFound, parseBody, parseQuery } from "./_util";
import { notifyMailbox, notifyUser } from "../realtime/notify";

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
		recurrenceRule: z.enum(["FREQ=DAILY", "FREQ=WEEKLY", "FREQ=MONTHLY"]).nullable().optional(),
		timeZone: z.string().min(1).max(100).refine((value) => {
			try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; }
			catch { return false; }
		}, "Use an IANA time zone such as Europe/Berlin").nullable().optional(),
		startsAt: z.number().int(),
		endsAt: z.number().int(),
	})
	.refine((value) => value.endsAt >= value.startsAt, {
		message: "An event cannot end before it starts",
		path: ["endsAt"],
	});

const caldavInput = z.object({
	name: z.string().trim().min(1).max(120),
	calendarUrl: z.url().refine((value) => new URL(value).protocol === "https:", "Use an HTTPS CalDAV URL"),
	username: z.string().trim().min(1).max(320),
	password: z.string().min(1).max(2000),
});
const googleStartInput = z.object({ clientId: z.string().trim().min(10).max(500), clientSecret: z.string().min(1).max(2000) });

/** Expanded occurrences share a series; editing one edits the series. */
function seriesId(value: string): string {
	return value.split("~", 1)[0] ?? value;
}

export const calendarRoutes = new Hono<AppBindings>()
	.get("/connections", async (c) => c.json(await c.get("db").select({ id: calendarConnections.id, provider: calendarConnections.provider, name: calendarConnections.name, calendarUrl: calendarConnections.calendarUrl, lastSyncedAt: calendarConnections.lastSyncedAt, lastError: calendarConnections.lastError }).from(calendarConnections).where(eq(calendarConnections.userId, c.get("user").id)).all()))
	.post("/connections/caldav", async (c) => {
		const input = await parseBody(c, caldavInput);
		let secret: string;
		try { secret = await encryptSecret(c.env, input.password); } catch (error) {
			if (error instanceof SecretKeyMissing) throw new HTTPException(409, { message: error.message });
			throw error;
		}
		const connection = await c.get("db").insert(calendarConnections).values({ userId: c.get("user").id, provider: "caldav", name: input.name, calendarUrl: input.calendarUrl, username: input.username, secret }).returning().get();
		return syncConnection(c, connection);
	})
	.post("/connections/google/start", async (c) => {
		const input = await parseBody(c, googleStartInput);
		const origin = new URL(c.req.url).origin;
		const redirectUri = `${origin}/api/calendar/connections/google/callback`;
		const connection = await c.get("db").insert(calendarConnections).values({ userId: c.get("user").id, provider: "google", name: "Google Calendar", calendarUrl: "primary", username: input.clientId, secret: await encryptSecret(c.env, JSON.stringify({ clientSecret: input.clientSecret })) }).returning().get();
		const state = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
		await c.get("db").insert(calendarOAuthStates).values({ connectionId: connection.id, userId: c.get("user").id, state, expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
		const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
		url.search = new URLSearchParams({ client_id: input.clientId, redirect_uri: redirectUri, response_type: "code", scope: "https://www.googleapis.com/auth/calendar", access_type: "offline", prompt: "consent", state }).toString();
		await notifyUser(c.env, c.get("user").id, { type: "calendar.changed" });
		return c.json({ url: url.toString(), redirectUri });
	})
	.get("/connections/google/callback", async (c) => {
		const state = c.req.query("state");
		const code = c.req.query("code");
		const pending = state ? await c.get("db").select().from(calendarOAuthStates).where(and(eq(calendarOAuthStates.state, state), eq(calendarOAuthStates.userId, c.get("user").id))).get() : undefined;
		if (!pending || pending.expiresAt <= new Date() || !code) throw new HTTPException(400, { message: "Google Calendar authorization expired or was denied" });
		await c.get("db").delete(calendarOAuthStates).where(eq(calendarOAuthStates.id, pending.id));
		const connection = await c.get("db").select().from(calendarConnections).where(eq(calendarConnections.id, pending.connectionId)).get();
		const configured = connection?.secret ? await decryptSecret(c.env, connection.secret) : null;
		if (!connection || !configured || !connection.username) throw new HTTPException(409, { message: "Google Calendar connection is no longer configured" });
		const { clientSecret } = JSON.parse(configured) as { clientSecret?: string };
		const redirectUri = `${new URL(c.req.url).origin}/api/calendar/connections/google/callback`;
		const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: connection.username, client_secret: clientSecret ?? "", redirect_uri: redirectUri, grant_type: "authorization_code" }) });
		const token = await response.json() as { refresh_token?: string; error_description?: string };
		if (!response.ok || !token.refresh_token) throw new HTTPException(502, { message: token.error_description ?? "Google did not return a refresh token" });
		await c.get("db").update(calendarConnections).set({ secret: await encryptSecret(c.env, JSON.stringify({ clientSecret, refreshToken: token.refresh_token })), lastError: null }).where(eq(calendarConnections.id, connection.id));
		await notifyUser(c.env, connection.userId, { type: "calendar.changed" });
		audit(c, { action: "calendar.google_connect", metadata: { connectionId: connection.id } });
		return c.redirect("/calendar?google=connected");
	})
	.post("/connections/:id/sync", async (c) => {
		const connection = await c.get("db").select().from(calendarConnections).where(and(eq(calendarConnections.id, c.req.param("id")), eq(calendarConnections.userId, c.get("user").id))).get();
		if (!connection) notFound("Calendar connection");
		return syncConnection(c, connection);
	})
	.delete("/connections/:id", async (c) => {
		const removed = await c.get("db").delete(calendarConnections).where(and(eq(calendarConnections.id, c.req.param("id")), eq(calendarConnections.userId, c.get("user").id))).returning({ id: calendarConnections.id }).get();
		if (!removed) notFound("Calendar connection");
		await notifyUser(c.env, c.get("user").id, { type: "calendar.changed" });
		audit(c, { action: "calendar.connection_remove", metadata: { connectionId: removed.id } });
		return c.json({ ok: true });
	})
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
					or(
						and(lte(calendarEvents.startsAt, new Date(range.to)), gte(calendarEvents.endsAt, new Date(range.from))),
						isNotNull(calendarEvents.recurrenceRule),
					),
				),
			)
			.orderBy(asc(calendarEvents.startsAt))
			.all();

		return c.json({ items: expandRecurrences(rows, new Date(range.from), new Date(range.to)) });
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
				recurrenceRule: input.recurrenceRule ?? null,
				timeZone: input.timeZone ?? null,
				userId: c.get("user").id,
				startsAt: new Date(input.startsAt),
				endsAt: new Date(input.endsAt),
			})
			.returning()
			.get();

		await notifyUser(c.env, c.get("user").id, { type: "calendar.changed" });
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
				and(eq(calendarEvents.id, seriesId(c.req.param("id"))), eq(calendarEvents.userId, c.get("user").id)),
			)
			.returning()
			.get();

		if (!row) notFound("Event");
		await notifyUser(c.env, c.get("user").id, { type: "calendar.changed" });
		return c.json(row);
	})

	.delete("/events/:id", async (c) => {
		const event = await c.get("db").select().from(calendarEvents).where(
			and(eq(calendarEvents.id, seriesId(c.req.param("id"))), eq(calendarEvents.userId, c.get("user").id)),
		).get();
		if (!event) notFound("Event");
		const links = await c.get("db").select({ connection: calendarConnections, link: calendarEventLinks })
			.from(calendarEventLinks)
			.innerJoin(calendarConnections, eq(calendarConnections.id, calendarEventLinks.connectionId))
			.where(eq(calendarEventLinks.eventId, event.id))
			.all();
		for (const { connection, link } of links) {
			try {
				await deleteCalendarEventFromConnection(c.env, c.get("db"), connection, link);
			} catch (error) {
				const message = error instanceof Error ? error.message.slice(0, 500) : "Calendar sync failed";
				throw new HTTPException(502, { message });
			}
		}
		const row = await c
			.get("db")
			.delete(calendarEvents)
			.where(
				and(eq(calendarEvents.id, seriesId(c.req.param("id"))), eq(calendarEvents.userId, c.get("user").id)),
			)
			.returning({ id: calendarEvents.id })
			.get();

		if (!row) notFound("Event");
		await notifyUser(c.env, c.get("user").id, { type: "calendar.changed" });
		return c.json({ ok: true });
	});

async function syncConnection(c: Context<AppBindings>, connection: typeof calendarConnections.$inferSelect) {
	try {
		const result = await syncCalendarConnection(c.env, c.get("db"), connection);
		audit(c, { action: `calendar.${connection.provider}_sync`, metadata: { connectionId: connection.id, ...result } });
		return c.json(result, 201);
	} catch (error) {
		const message = error instanceof Error ? error.message.slice(0, 500) : "Calendar sync failed";
		throw new HTTPException(502, { message });
	}
}

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
				recurrenceRule: row.recurrenceRule,
				timeZone: row.timeZone,
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
					recurrenceRule: event.recurrenceRule,
					timeZone: event.timeZone,
					startsAt: new Date(event.startsAt),
					endsAt: new Date(event.endsAt),
				});
			imported += 1;
		}

		audit(c, { action: "calendar.import", metadata: { imported, found: parsed.length } });
		if (imported > 0) await notifyUser(c.env, c.get("user").id, { type: "calendar.changed" });
		return c.json({ imported, skipped: parsed.length - imported });
	})

	/**
	 * Mails the event to its attendees as an invitation.
	 *
	 * It goes out as an ordinary outbound message — a row in `messages` with the
	 * `.ics` as its attachment, queued on `OUTBOUND_QUEUE` — so it inherits the
	 * retries, the audit trail and the Sent folder rather than growing a second
	 * delivery path. The sender domain must be onboarded for Cloudflare Email
	 * Sending, so an invitation can still fail on the queue, not here.
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

		const mailbox = await sendableMailbox(c, event.mailboxId, { requireSending: true });
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
					recurrenceRule: event.recurrenceRule,
					timeZone: event.timeZone,
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

		await notifyMailbox(c.env, mailbox.id, {
			type: "message.sent",
			mailboxId: mailbox.id,
			messageId: message.id,
		});
		audit(c, {
			action: "calendar.invite",
			mailboxId: mailbox.id,
			messageId: message.id,
			metadata: { attendees: event.attendees.length },
		});
		return c.json({ invited: event.attendees.length, messageId: message.id }, 202);
	});
