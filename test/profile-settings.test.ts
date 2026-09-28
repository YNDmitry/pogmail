import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, expect, it } from "vitest";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { api } from "@/worker/api";
import { createSession, SESSION_COOKIE } from "@/worker/auth/session";

let userId: string | undefined;
afterEach(async () => {
	if (!userId) return;
	const db = getDb(env.DB);
	const objects = await env.MAIL_BUCKET.list({ prefix: `avatars/users/${userId}/` });
	await Promise.all(objects.objects.map((object) => env.MAIL_BUCKET.delete(object.key)));
	await db.delete(users).where(eq(users.id, userId));
	userId = undefined;
});

it("loads saved account preferences only for the owner and serves their photo", async () => {
	const db = getDb(env.DB);
	const user = await db.insert(users).values({
		email: `profile-${crypto.randomUUID()}@example.test`, name: "Test user", passwordHash: "unused",
		resetEmail: "recover@example.test", forwardingEmail: "forward@example.test",
	}).returning().get();
	userId = user.id;
	const session = await createSession(db, user.id);
	const cookie = `${SESSION_COOKIE}=${session.token}`;
	const url = "https://pogmail.test/api/settings/profile";
	const anonymous = await api.fetch(new Request(url), env);
	expect(anonymous.status).toBe(401);
	const response = await api.fetch(new Request(url, { headers: { cookie } }), env);
	expect(await response.json()).toEqual({ resetEmail: "recover@example.test", forwardingEmail: "forward@example.test" });

	const changed = await api.fetch(new Request(url, { method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ resetEmail: null, name: "New name" }) }), env);
	expect(changed.status).toBe(200);
	const updated = await api.fetch(new Request(url, { headers: { cookie } }), env);
	expect(await updated.json()).toEqual({ resetEmail: null, forwardingEmail: "forward@example.test" });

	const upload = await api.fetch(new Request("https://pogmail.test/api/settings/avatar", { method: "PUT", headers: { cookie, "content-type": "image/png" }, body: new Uint8Array([137, 80, 78, 71]) }), env);
	expect(upload.status).toBe(200);
	const { url: imageUrl } = await upload.json() as { url: string };
	const image = await api.fetch(new Request(`https://pogmail.test${imageUrl}`, { headers: { cookie } }), env);
	expect(image.status).toBe(200);
	const removed = await api.fetch(new Request("https://pogmail.test/api/settings/avatar", { method: "DELETE", headers: { cookie } }), env);
	expect(removed.status).toBe(200);
	const missing = await api.fetch(new Request(`https://pogmail.test${imageUrl}`, { headers: { cookie } }), env);
	expect(missing.status).toBe(403);
});
