import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { calendarConnections, calendarEventLinks, calendarEvents, users } from "@/db/schema";
import { syncGoogle } from "@/worker/calendar/google";

const createdUsers: string[] = [];

afterEach(async () => {
	vi.restoreAllMocks();
	const db = getDb(env.DB);
	for (const id of createdUsers.splice(0)) {
		await db.delete(users).where(eq(users.id, id));
	}
});

async function seed() {
	const db = getDb(env.DB);
	const user = await db.insert(users).values({
		email: `calendar-${crypto.randomUUID()}@example.test`,
		name: "Calendar user",
		passwordHash: "x",
	}).returning().get();
	createdUsers.push(user.id);
	const connection = await db.insert(calendarConnections).values({
		userId: user.id,
		provider: "google",
		name: "Google Calendar",
		calendarUrl: "primary",
		username: "client-id",
	}).returning().get();
	return { db, user, connection };
}

function remote(id: string, etag: string, title = id) {
	return {
		id,
		etag,
		updated: "2026-09-14T10:00:00.000Z",
		summary: title,
		start: { dateTime: "2026-09-15T09:00:00.000Z" },
		end: { dateTime: "2026-09-15T10:00:00.000Z" },
	};
}

describe("Google Calendar sync", () => {
	it("imports every page returned by Google", async () => {
		const { db, user, connection } = await seed();
		const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
			const url = String(input);
			if (url.includes("oauth2.googleapis.com")) return Promise.resolve(new Response(JSON.stringify({ access_token: "access" })));
			if (url.includes("pageToken=next")) return Promise.resolve(new Response(JSON.stringify({ items: [remote("two", "etag-two")] })));
			return Promise.resolve(new Response(JSON.stringify({ items: [remote("one", "etag-one")], nextPageToken: "next" })));
		});

		await expect(syncGoogle(db, connection, "secret", "refresh")).resolves.toEqual({ imported: 2, exported: 0 });
		const events = await db.select().from(calendarEvents).where(eq(calendarEvents.userId, user.id)).all();
		expect(events.map((event) => event.title).toSorted()).toEqual(["one", "two"]);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("pushes a local edit when the remote version is unchanged", async () => {
		const { db, user, connection } = await seed();
		const event = await db.insert(calendarEvents).values({
			userId: user.id,
			title: "Before",
			startsAt: new Date("2026-09-15T09:00:00Z"),
			endsAt: new Date("2026-09-15T10:00:00Z"),
		}).returning().get();
		const link = await db.insert(calendarEventLinks).values({ connectionId: connection.id, eventId: event.id, href: "remote-id", etag: "etag" }).returning().get();
		await db.update(calendarEventLinks).set({ updatedAt: new Date(0) }).where(eq(calendarEventLinks.id, link.id));
		await db.update(calendarEvents).set({ title: "After" }).where(eq(calendarEvents.id, event.id));
		const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
			const url = String(input);
			if (url.includes("oauth2.googleapis.com")) return Promise.resolve(new Response(JSON.stringify({ access_token: "access" })));
			if (init?.method === "PUT") return Promise.resolve(new Response(JSON.stringify(remote("remote-id", "etag-next", "After"))));
			return Promise.resolve(new Response(JSON.stringify({ items: [remote("remote-id", "etag")] })));
		});

		await expect(syncGoogle(db, connection, "secret", "refresh")).resolves.toEqual({ imported: 0, exported: 1 });
		expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("remote-id"), expect.objectContaining({ method: "PUT" }));
	});

	it("removes an unchanged local event that was deleted remotely", async () => {
		const { db, user, connection } = await seed();
		const event = await db.insert(calendarEvents).values({
			userId: user.id,
			title: "Deleted externally",
			startsAt: new Date("2026-09-15T09:00:00Z"),
			endsAt: new Date("2026-09-15T10:00:00Z"),
		}).returning().get();
		await db.insert(calendarEventLinks).values({ connectionId: connection.id, eventId: event.id, href: "gone", etag: "etag" });
		vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
			if (String(input).includes("oauth2.googleapis.com")) return Promise.resolve(new Response(JSON.stringify({ access_token: "access" })));
			return Promise.resolve(new Response(JSON.stringify({ items: [] })));
		});

		await expect(syncGoogle(db, connection, "secret", "refresh")).resolves.toEqual({ imported: 1, exported: 0 });
		expect(await db.select().from(calendarEvents).where(eq(calendarEvents.id, event.id)).get()).toBeUndefined();
	});
});
