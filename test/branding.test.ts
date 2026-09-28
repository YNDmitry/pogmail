import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { appSettings, users } from "@/db/schema";
import { createSession, SESSION_COOKIE } from "@/worker/auth/session";
import { api } from "@/worker/api";

const userIds: string[] = [];

afterEach(async () => {
	const db = getDb(env.DB);
	await db.delete(appSettings);
	for (const userId of userIds.splice(0)) await db.delete(users).where(eq(users.id, userId));
	const objects = await env.MAIL_BUCKET.list({ prefix: "branding/icon/" });
	await Promise.all(objects.objects.map((object) => env.MAIL_BUCKET.delete(object.key)));
});

async function adminCookie() {
	const db = getDb(env.DB);
	const user = await db
		.insert(users)
		.values({
			email: `branding-${crypto.randomUUID()}@example.test`,
			name: "Branding admin",
			passwordHash: "unused",
			role: "admin",
		})
		.returning()
		.get();
	userIds.push(user.id);
	const session = await createSession(db, user.id);
	return `${SESSION_COOKIE}=${session.token}`;
}

describe("branding", () => {
	it("authenticates writes and immediately serves saved branding", async () => {
		const anonymous = await api.fetch(
			new Request("https://pogmail.test/api/branding", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ appName: "Acme Mail", allowRegistration: true }),
			}),
			env,
		);
		expect(anonymous.status).toBe(401);

		const cookie = await adminCookie();
		const updated = await api.fetch(
			new Request("https://pogmail.test/api/branding", {
				method: "PUT",
				headers: { "content-type": "application/json", cookie },
				body: JSON.stringify({ appName: "Acme Mail", allowRegistration: true }),
			}),
			env,
		);
		expect(updated.status).toBe(200);

		const icon = await api.fetch(
			new Request("https://pogmail.test/api/branding/icon", {
				method: "PUT",
				headers: { "content-type": "image/svg+xml", cookie },
				body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
			}),
			env,
		);
		expect(icon.status).toBe(200);
		const { iconUrl } = (await icon.json()) as { iconUrl: string };

		const branding = await api.fetch(new Request("https://pogmail.test/api/branding"), env);
		expect(await branding.json()).toMatchObject({
			appName: "Acme Mail",
			allowRegistration: true,
			iconUrl,
		});

		const storedIcon = await api.fetch(new Request(`https://pogmail.test${iconUrl}`), env);
		expect(storedIcon.status).toBe(200);
		expect(storedIcon.headers.get("content-type")).toBe("image/svg+xml");
	});
});
