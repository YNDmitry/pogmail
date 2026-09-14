import { and, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { calendarConnections, calendarEventLinks, calendarEvents } from "@/db/schema";

type Connection = typeof calendarConnections.$inferSelect;
type Event = typeof calendarEvents.$inferSelect;
type GoogleEvent = {
	id: string;
	etag?: string;
	status?: string;
	updated?: string;
	summary?: string;
	description?: string;
	location?: string;
	start?: { date?: string; dateTime?: string };
	end?: { date?: string; dateTime?: string };
	attendees?: Array<{ email?: string; displayName?: string }>;
};
export type GoogleHeaders = Record<string, string>;

async function token(connection: Connection, clientSecret: string, refreshToken: string): Promise<string> {
	const response = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ client_id: connection.username ?? "", client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
	});
	const body = await response.json() as { access_token?: string; error_description?: string };
	if (!response.ok || !body.access_token) throw new Error(body.error_description ?? "Google token refresh failed");
	return body.access_token;
}

function date(value: { date?: string; dateTime?: string } | undefined): Date | null {
	return value?.dateTime ? new Date(value.dateTime) : value?.date ? new Date(`${value.date}T00:00:00Z`) : null;
}

function values(remote: GoogleEvent) {
	const start = date(remote.start);
	const end = date(remote.end);
	if (!start || !end) return null;
	const allDay = !!remote.start?.date;
	return {
		title: remote.summary ?? "Untitled event",
		description: remote.description ?? "",
		location: remote.location ?? "",
		attendees: (remote.attendees ?? []).flatMap((item) => item.email ? [{ address: item.email, ...(item.displayName ? { name: item.displayName } : {}) }] : []),
		allDay,
		startsAt: start,
		endsAt: allDay ? new Date(end.getTime() - 1000) : end,
	};
}

function payload(event: Event) {
	return {
		summary: event.title,
		description: event.description,
		location: event.location,
		start: event.allDay ? { date: event.startsAt.toISOString().slice(0, 10) } : { dateTime: event.startsAt.toISOString() },
		end: event.allDay ? { date: new Date(event.endsAt.getTime() + 1000).toISOString().slice(0, 10) } : { dateTime: event.endsAt.toISOString() },
		attendees: event.attendees.map((item) => ({ email: item.address, displayName: item.name })),
	};
}

async function googleJson(url: string, init: RequestInit): Promise<GoogleEvent> {
	const response = await fetch(url, init);
	const body = await response.json() as GoogleEvent & { error?: { message?: string } };
	if (!response.ok) throw new Error(body.error?.message ?? "Google Calendar request failed");
	return body;
}

async function listEvents(headers: GoogleHeaders): Promise<GoogleEvent[]> {
	const events: GoogleEvent[] = [];
	let pageToken: string | undefined;
	do {
		const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
		url.search = new URLSearchParams({ singleEvents: "true", maxResults: "2500", ...(pageToken ? { pageToken } : {}) }).toString();
		const response = await fetch(url, { headers });
		const body = await response.json() as { items?: GoogleEvent[]; nextPageToken?: string; error?: { message?: string } };
		if (!response.ok) throw new Error(body.error?.message ?? "Google Calendar request failed");
		events.push(...(body.items ?? []));
		pageToken = body.nextPageToken;
	} while (pageToken);
	return events;
}

async function create(headers: GoogleHeaders, event: Event): Promise<GoogleEvent> {
	return googleJson("https://www.googleapis.com/calendar/v3/calendars/primary/events", { method: "POST", headers, body: JSON.stringify(payload(event)) });
}

async function update(headers: GoogleHeaders, event: Event, remoteId: string, etag: string | null): Promise<GoogleEvent> {
	return googleJson(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(remoteId)}`, {
		method: "PUT",
		headers: { ...headers, ...(etag ? { "If-Match": etag } : {}) },
		body: JSON.stringify(payload(event)),
	});
}

export async function deleteGoogleEvent(headers: GoogleHeaders, remoteId: string): Promise<void> {
	const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(remoteId)}`, { method: "DELETE", headers });
	if (!response.ok && response.status !== 404) throw new Error("Google Calendar could not delete the event");
}

export async function googleHeaders(connection: Connection, clientSecret: string, refreshToken: string): Promise<GoogleHeaders> {
	return { Authorization: `Bearer ${await token(connection, clientSecret, refreshToken)}`, "Content-Type": "application/json" };
}

export async function syncGoogle(db: Database, connection: Connection, clientSecret: string, refreshToken: string): Promise<{ imported: number; exported: number }> {
	const headers = await googleHeaders(connection, clientSecret, refreshToken);
	const remoteEvents = await listEvents(headers);
	const seen = new Set<string>();
	let imported = 0;
	let exported = 0;

	for (const remote of remoteEvents) {
		if (remote.status === "cancelled" || !remote.id) continue;
		const next = values(remote);
		if (!next) continue;
		seen.add(remote.id);
		const link = await db.select().from(calendarEventLinks).where(and(eq(calendarEventLinks.connectionId, connection.id), eq(calendarEventLinks.href, remote.id))).get();
		if (!link) {
			const created = await db.insert(calendarEvents).values({ userId: connection.userId, ...next }).returning().get();
			await db.insert(calendarEventLinks).values({ connectionId: connection.id, eventId: created.id, href: remote.id, etag: remote.etag ?? null });
			imported += 1;
			continue;
		}

		const local = await db.select().from(calendarEvents).where(eq(calendarEvents.id, link.eventId)).get();
		if (!local) continue;
		const localChanged = local.updatedAt > link.updatedAt;
		const remoteChanged = remote.etag !== link.etag;
		const remoteNewer = !remote.updated || new Date(remote.updated) >= local.updatedAt;
		if (remoteChanged && (!localChanged || remoteNewer)) {
			await db.update(calendarEvents).set(next).where(eq(calendarEvents.id, local.id));
			await db.update(calendarEventLinks).set({ etag: remote.etag ?? null }).where(eq(calendarEventLinks.id, link.id));
			imported += 1;
		} else if (localChanged) {
			const updated = await update(headers, local, remote.id, remote.etag ?? link.etag);
			await db.update(calendarEventLinks).set({ etag: updated.etag ?? null }).where(eq(calendarEventLinks.id, link.id));
			exported += 1;
		}
	}

	const links = await db.select().from(calendarEventLinks).where(eq(calendarEventLinks.connectionId, connection.id)).all();
	for (const link of links.filter((item) => !seen.has(item.href))) {
		const local = await db.select().from(calendarEvents).where(eq(calendarEvents.id, link.eventId)).get();
		if (!local) continue;
		if (local.updatedAt > link.updatedAt) {
			const recreated = await create(headers, local);
			await db.update(calendarEventLinks).set({ href: recreated.id, etag: recreated.etag ?? null }).where(eq(calendarEventLinks.id, link.id));
			exported += 1;
		} else {
			await db.delete(calendarEvents).where(eq(calendarEvents.id, local.id));
			imported += 1;
		}
	}

	const linked = new Set(links.map((item) => item.eventId));
	const locals = await db.select().from(calendarEvents).where(eq(calendarEvents.userId, connection.userId)).all();
	for (const local of locals.filter((item) => !linked.has(item.id))) {
		const created = await create(headers, local);
		await db.insert(calendarEventLinks).values({ connectionId: connection.id, eventId: local.id, href: created.id, etag: created.etag ?? null });
		exported += 1;
	}
	return { imported, exported };
}
