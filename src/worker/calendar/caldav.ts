import { and, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { calendarConnections, calendarEventLinks, calendarEvents } from "@/db/schema";
import { parseIcs, toIcs } from "./ics";

const CALENDAR_QUERY = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter>
</c:calendar-query>`;

type Connection = typeof calendarConnections.$inferSelect;

function auth(username: string, password: string): string {
	const bytes = new TextEncoder().encode(`${username}:${password}`);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return `Basic ${btoa(binary)}`;
}

function text(xml: string, name: string): string | null {
	const match = xml.match(new RegExp(`<[^>]*${name}[^>]*>([\\s\\S]*?)<\\/[^>]*${name}>`, "i"));
	return match ? decodeXml(match[1].trim()) : null;
}

function decodeXml(value: string): string {
	return value.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"');
}

function responses(xml: string): Array<{ href: string; etag: string | null; ics: string }> {
	return [...xml.matchAll(/<[^>]*response[^>]*>([\s\S]*?)<\/[^>]*response>/gi)].flatMap((match) => {
		const value = match[1];
		const href = text(value, "href");
		const ics = text(value, "calendar-data");
		return href && ics ? [{ href, etag: text(value, "getetag"), ics }] : [];
	});
}

async function report(connection: Connection, password: string): Promise<Array<{ href: string; etag: string | null; ics: string }>> {
	const response = await fetch(connection.calendarUrl, {
		method: "REPORT",
		headers: { Authorization: auth(connection.username ?? "", password), Depth: "1", "Content-Type": "application/xml; charset=utf-8" },
		body: CALENDAR_QUERY,
	});
	if (!response.ok && response.status !== 207) throw new Error(`CalDAV server returned ${response.status}`);
	return responses(await response.text());
}

export async function syncCaldav(db: Database, connection: Connection, password: string): Promise<{ imported: number; exported: number }> {
	const remote = await report(connection, password);
	let imported = 0;
	for (const resource of remote) {
		const event = parseIcs(resource.ics)[0];
		if (!event) continue;
		const link = await db.select().from(calendarEventLinks).where(and(eq(calendarEventLinks.connectionId, connection.id), eq(calendarEventLinks.href, resource.href))).get();
		if (link) {
			await db.update(calendarEvents).set({ title: event.title, description: event.description, location: event.location, attendees: event.attendees, allDay: event.allDay, startsAt: new Date(event.startsAt), endsAt: new Date(event.endsAt) }).where(eq(calendarEvents.id, link.eventId));
			await db.update(calendarEventLinks).set({ etag: resource.etag }).where(eq(calendarEventLinks.id, link.id));
		} else {
			const created = await db.insert(calendarEvents).values({ userId: connection.userId, title: event.title, description: event.description, location: event.location, attendees: event.attendees, allDay: event.allDay, startsAt: new Date(event.startsAt), endsAt: new Date(event.endsAt) }).returning({ id: calendarEvents.id }).get();
			await db.insert(calendarEventLinks).values({ connectionId: connection.id, eventId: created.id, href: resource.href, etag: resource.etag });
			imported += 1;
		}
	}

	const links = await db.select().from(calendarEventLinks).where(eq(calendarEventLinks.connectionId, connection.id)).all();
	const linked = new Set(links.map((link) => link.eventId));
	const locals = await db.select().from(calendarEvents).where(eq(calendarEvents.userId, connection.userId)).all();
	let exported = 0;
	for (const event of locals.filter((item) => !linked.has(item.id))) {
		const href = new URL(`${encodeURIComponent(event.id)}.ics`, connection.calendarUrl.endsWith("/") ? connection.calendarUrl : `${connection.calendarUrl}/`).pathname;
		const response = await fetch(new URL(href, connection.calendarUrl), {
			method: "PUT",
			headers: { Authorization: auth(connection.username ?? "", password), "Content-Type": "text/calendar; charset=utf-8", "If-None-Match": "*" },
			body: toIcs([{ id: event.id, title: event.title, description: event.description, location: event.location, allDay: event.allDay, startsAt: event.startsAt, endsAt: event.endsAt, attendees: event.attendees }], { host: "pogmail.local" }),
		});
		if (!response.ok) continue;
		await db.insert(calendarEventLinks).values({ connectionId: connection.id, eventId: event.id, href, etag: response.headers.get("etag") });
		exported += 1;
	}
	return { imported, exported };
}
