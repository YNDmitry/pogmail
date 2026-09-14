import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import { calendarConnections, calendarEventLinks } from "@/db/schema";
import { decryptSecret } from "../auth/secrets";
import { deleteCaldavEvent, syncCaldav } from "./caldav";
import { deleteGoogleEvent, googleHeaders, syncGoogle } from "./google";

type Connection = typeof calendarConnections.$inferSelect;
type Link = typeof calendarEventLinks.$inferSelect;

export type CalendarSyncResult = { imported: number; exported: number };

/**
 * Runs the same sealed-credential sync for an interactive request and the
 * hourly scheduler. Persisting the result here keeps both paths honest about
 * when a connection last worked and what needs attention.
 */
export async function syncCalendarConnection(
	env: Env,
	db: Database,
	connection: Connection,
): Promise<CalendarSyncResult> {
	try {
		const secret = connection.secret
			? await decryptSecret(env, connection.secret)
			: null;
		if (!secret) throw new Error("The calendar credentials can no longer be read; reconnect it");

		const result = connection.provider === "caldav"
			? await syncCaldav(db, connection, secret)
			: await syncGoogleConnection(db, connection, secret);

		await db
			.update(calendarConnections)
			.set({ lastSyncedAt: new Date(), lastError: null })
			.where(eq(calendarConnections.id, connection.id));
		return result;
	} catch (error) {
		const message = error instanceof Error
			? error.message.slice(0, 500)
			: "Calendar sync failed";
		await db
			.update(calendarConnections)
			.set({ lastError: message })
			.where(eq(calendarConnections.id, connection.id));
		throw error;
	}
}

async function syncGoogleConnection(
	db: Database,
	connection: Connection,
	secret: string,
): Promise<CalendarSyncResult> {
	const config = JSON.parse(secret) as {
		clientSecret?: string;
		refreshToken?: string;
	};
	if (!config.clientSecret || !config.refreshToken) {
		throw new Error("Google Calendar authorization is incomplete");
	}
	return syncGoogle(db, connection, config.clientSecret, config.refreshToken);
}

/** Delete the provider copy before removing the local event and its link. */
export async function deleteCalendarEventFromConnection(
	env: Env,
	db: Database,
	connection: Connection,
	link: Link,
): Promise<void> {
	try {
		const secret = connection.secret
			? await decryptSecret(env, connection.secret)
			: null;
		if (!secret) throw new Error("The calendar credentials can no longer be read; reconnect it");

		if (connection.provider === "caldav") {
			await deleteCaldavEvent(connection, secret, link.href, link.etag);
		} else {
			const config = JSON.parse(secret) as { clientSecret?: string; refreshToken?: string };
			if (!config.clientSecret || !config.refreshToken) throw new Error("Google Calendar authorization is incomplete");
			await deleteGoogleEvent(await googleHeaders(connection, config.clientSecret, config.refreshToken), link.href);
		}
		await db.update(calendarConnections).set({ lastError: null }).where(eq(calendarConnections.id, connection.id));
	} catch (error) {
		const message = error instanceof Error ? error.message.slice(0, 500) : "Calendar sync failed";
		await db.update(calendarConnections).set({ lastError: message }).where(eq(calendarConnections.id, connection.id));
		throw error;
	}
}
