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
type Event = typeof calendarEvents.$inferSelect;

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

function calendarIcs(event: Event): string {
	return toIcs([{ id: event.id, title: event.title, description: event.description, location: event.location, allDay: event.allDay, startsAt: event.startsAt, endsAt: event.endsAt, attendees: event.attendees }], { host: "pogmail.local" });
}

function resourceUrl(connection: Connection, href: string): URL {
	return new URL(href, connection.calendarUrl);
}

async function put(connection: Connection, password: string, event: Event, href: string, etag?: string | null): Promise<string | null> {
	const response = await fetch(resourceUrl(connection, href), {
		method: "PUT",
		headers: {
			Authorization: auth(connection.username ?? "", password),
			"Content-Type": "text/calendar; charset=utf-8",
			...(etag ? { "If-Match": etag } : { "If-None-Match": "*" }),
		},
		body: calendarIcs(event),
	});
	if (!response.ok) throw new Error(`CalDAV could not save the event (${response.status})`);
	return response.headers.get("etag");
}

export async function deleteCaldavEvent(connection: Connection, password: string, href: string, etag?: string | null): Promise<void> {
	const response = await fetch(resourceUrl(connection, href), {
		method: "DELETE",
		headers: { Authorization: auth(connection.username ?? "", password), ...(etag ? { "If-Match": etag } : {}) },
	});
	if (!response.ok && response.status !== 404) throw new Error(`CalDAV could not delete the event (${response.status})`);
}

export async function syncCaldav(db: Database, connection: Connection, password: string): Promise<{ imported: number; exported: number }> {
	const remote = await report(connection, password);
	const seen = new Set<string>();
	let imported = 0;
	let exported = 0;

	for (const resource of remote) {
		const parsed = parseIcs(resource.ics)[0];
		if (!parsed) continue;
		seen.add(resource.href);
		const link = await db.select().from(calendarEventLinks).where(and(eq(calendarEventLinks.connectionId, connection.id), eq(calendarEventLinks.href, resource.href))).get();
		const next = { title: parsed.title, description: parsed.description, location: parsed.location, attendees: parsed.attendees, allDay: parsed.allDay, startsAt: new Date(parsed.startsAt), endsAt: new Date(parsed.endsAt) };
		if (!link) {
			const created = await db.insert(calendarEvents).values({ userId: connection.userId, ...next }).returning().get();
			await db.insert(calendarEventLinks).values({ connectionId: connection.id, eventId: created.id, href: resource.href, etag: resource.etag });
			imported += 1;
			continue;
		}

		const local = await db.select().from(calendarEvents).where(eq(calendarEvents.id, link.eventId)).get();
		if (!local) continue;
		const localChanged = local.updatedAt > link.updatedAt;
		const remoteChanged = resource.etag !== link.etag;
		if (remoteChanged && !localChanged) {
			await db.update(calendarEvents).set(next).where(eq(calendarEvents.id, local.id));
			await db.update(calendarEventLinks).set({ etag: resource.etag }).where(eq(calendarEventLinks.id, link.id));
			imported += 1;
		} else if (localChanged) {
			const etag = await put(connection, password, local, resource.href, resource.etag ?? link.etag);
			await db.update(calendarEventLinks).set({ etag }).where(eq(calendarEventLinks.id, link.id));
			exported += 1;
		}
	}

	const links = await db.select().from(calendarEventLinks).where(eq(calendarEventLinks.connectionId, connection.id)).all();
	for (const link of links.filter((item) => !seen.has(item.href))) {
		const local = await db.select().from(calendarEvents).where(eq(calendarEvents.id, link.eventId)).get();
		if (!local) continue;
		if (local.updatedAt > link.updatedAt) {
			const etag = await put(connection, password, local, link.href);
			await db.update(calendarEventLinks).set({ etag }).where(eq(calendarEventLinks.id, link.id));
			exported += 1;
		} else {
			await db.delete(calendarEvents).where(eq(calendarEvents.id, local.id));
			imported += 1;
		}
	}

	const linked = new Set(links.map((item) => item.eventId));
	const locals = await db.select().from(calendarEvents).where(eq(calendarEvents.userId, connection.userId)).all();
	for (const event of locals.filter((item) => !linked.has(item.id))) {
		const href = new URL(`${encodeURIComponent(event.id)}.ics`, connection.calendarUrl.endsWith("/") ? connection.calendarUrl : `${connection.calendarUrl}/`).pathname;
		const etag = await put(connection, password, event, href);
		await db.insert(calendarEventLinks).values({ connectionId: connection.id, eventId: event.id, href, etag });
		exported += 1;
	}
	return { imported, exported };
}
