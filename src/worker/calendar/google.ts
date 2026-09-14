import { and, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { calendarConnections, calendarEventLinks, calendarEvents } from "@/db/schema";

type Connection = typeof calendarConnections.$inferSelect;
type GoogleEvent = { id: string; summary?: string; description?: string; location?: string; start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string }; attendees?: Array<{ email?: string; displayName?: string }> };

async function token(connection: Connection, clientSecret: string, refreshToken: string): Promise<string> {
	const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: connection.username ?? "", client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }) });
	const body = await response.json() as { access_token?: string; error_description?: string };
	if (!response.ok || !body.access_token) throw new Error(body.error_description ?? "Google token refresh failed");
	return body.access_token;
}

function date(value: { date?: string; dateTime?: string } | undefined): Date | null { return value?.dateTime ? new Date(value.dateTime) : value?.date ? new Date(`${value.date}T00:00:00Z`) : null; }

export async function syncGoogle(db: Database, connection: Connection, clientSecret: string, refreshToken: string): Promise<{ imported: number; exported: number }> {
	const access = await token(connection, clientSecret, refreshToken);
	const headers = { Authorization: `Bearer ${access}`, "Content-Type": "application/json" };
	const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&maxResults=2500", { headers });
	const body = await response.json() as { items?: GoogleEvent[]; error?: { message?: string } };
	if (!response.ok) throw new Error(body.error?.message ?? "Google Calendar request failed");
	let imported = 0;
	for (const remote of body.items ?? []) {
		const start = date(remote.start); const end = date(remote.end); if (!start || !end || !remote.id) continue;
		const allDay = !!remote.start?.date;
		const link = await db.select().from(calendarEventLinks).where(and(eq(calendarEventLinks.connectionId, connection.id), eq(calendarEventLinks.href, remote.id))).get();
		const values = { title: remote.summary ?? "Untitled event", description: remote.description ?? "", location: remote.location ?? "", attendees: (remote.attendees ?? []).flatMap((item) => item.email ? [{ address: item.email, ...(item.displayName ? { name: item.displayName } : {}) }] : []), allDay, startsAt: start, endsAt: allDay ? new Date(end.getTime() - 1000) : end };
		if (link) await db.update(calendarEvents).set(values).where(eq(calendarEvents.id, link.eventId));
		else { const created = await db.insert(calendarEvents).values({ userId: connection.userId, ...values }).returning({ id: calendarEvents.id }).get(); await db.insert(calendarEventLinks).values({ connectionId: connection.id, eventId: created.id, href: remote.id }); imported++; }
	}
	const links = await db.select().from(calendarEventLinks).where(eq(calendarEventLinks.connectionId, connection.id)).all();
	const linked = new Set(links.map((item) => item.eventId));
	const locals = await db.select().from(calendarEvents).where(eq(calendarEvents.userId, connection.userId)).all();
	let exported = 0;
	for (const event of locals.filter((item) => !linked.has(item.id))) {
		const payload = { summary: event.title, description: event.description, location: event.location, start: event.allDay ? { date: event.startsAt.toISOString().slice(0, 10) } : { dateTime: event.startsAt.toISOString() }, end: event.allDay ? { date: new Date(event.endsAt.getTime() + 1000).toISOString().slice(0, 10) } : { dateTime: event.endsAt.toISOString() }, attendees: event.attendees.map((item) => ({ email: item.address, displayName: item.name })) };
		const created = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", { method: "POST", headers, body: JSON.stringify(payload) }); const remote = await created.json() as GoogleEvent;
		if (!created.ok || !remote.id) continue;
		await db.insert(calendarEventLinks).values({ connectionId: connection.id, eventId: event.id, href: remote.id }); exported++;
	}
	return { imported, exported };
}
