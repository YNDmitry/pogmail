import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { hashPassword } from "@/worker/auth/password";
import { api } from "@/worker/api";

const testUsers: string[] = [];

afterEach(async () => {
	const db = getDb(env.DB);
	for (const userId of testUsers.splice(0)) {
		await db.delete(users).where(eq(users.id, userId));
	}
});

async function seedUser() {
	const db = getDb(env.DB);
	const user = await db
		.insert(users)
		.values({
			email: `android-${crypto.randomUUID()}@example.test`,
			name: "Android tester",
			passwordHash: await hashPassword("test password"),
		})
		.returning()
		.get();
	testUsers.push(user.id);
	return user;
}

function request(path: string, body?: unknown, accessToken?: string) {
	return new Request(`https://pogmail.test/api/mobile${path}`, {
		method: body === undefined ? "GET" : "POST",
		headers: {
			...(body === undefined ? {} : { "content-type": "application/json" }),
			...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

describe("mobile authentication", () => {
	it("issues, rotates and revokes per-device Android tokens", async () => {
		const user = await seedUser();
		const login = await api.fetch(
			request("/auth/login", {
				email: user.email,
				password: "test password",
				deviceName: "Pixel 10",
				appVersion: "0.1.0",
			}),
			env,
		);
		expect(login.status).toBe(201);
		const initial = (await login.json()) as {
			deviceSessionId: string;
			accessToken: string;
			refreshToken: string;
			user: { id: string; email: string };
		};
		expect(initial.accessToken).toMatch(/^pm_at_/);
		expect(initial.refreshToken).toMatch(/^pm_rt_/);
		expect(initial.user).toMatchObject({ id: user.id, email: user.email });

		const me = await api.fetch(request("/auth/me", undefined, initial.accessToken), env);
		expect(me.status).toBe(200);
		expect(await me.json()).toMatchObject({ id: user.id });
		const folders = await api.fetch(
			new Request("https://pogmail.test/api/folders", { headers: { authorization: `Bearer ${initial.accessToken}` } }),
			env,
		);
		expect(folders.status).toBe(200);

		const secondLogin = await api.fetch(
			request("/auth/login", {
				email: user.email,
				password: "test password",
				deviceName: "Pixel Tablet",
			}),
			env,
		);
		const second = (await secondLogin.json()) as { deviceSessionId: string; accessToken: string };
		const devices = await api.fetch(request("/devices", undefined, initial.accessToken), env);
		expect(devices.status).toBe(200);
		expect(await devices.json()).toMatchObject({
			items: expect.arrayContaining([
				expect.objectContaining({ id: initial.deviceSessionId, current: true }),
				expect.objectContaining({ id: second.deviceSessionId, current: false }),
			]),
		});
		const revoke = await api.fetch(
			new Request(`https://pogmail.test/api/mobile/devices/${second.deviceSessionId}`, {
				method: "DELETE",
				headers: { authorization: `Bearer ${initial.accessToken}` },
			}),
			env,
		);
		expect(revoke.status).toBe(200);
		const remotelyRevoked = await api.fetch(request("/auth/me", undefined, second.accessToken), env);
		expect(remotelyRevoked.status).toBe(401);

		const refresh = await api.fetch(request("/auth/refresh", { refreshToken: initial.refreshToken }), env);
		expect(refresh.status).toBe(200);
		const rotated = (await refresh.json()) as { accessToken: string; refreshToken: string };
		expect(rotated.accessToken).not.toBe(initial.accessToken);
		expect(rotated.refreshToken).not.toBe(initial.refreshToken);

		const staleAccess = await api.fetch(request("/auth/me", undefined, initial.accessToken), env);
		expect(staleAccess.status).toBe(401);
		const replay = await api.fetch(request("/auth/refresh", { refreshToken: initial.refreshToken }), env);
		expect(replay.status).toBe(401);

		const logout = await api.fetch(request("/auth/logout", {}, rotated.accessToken), env);
		expect(logout.status).toBe(200);
		const revoked = await api.fetch(request("/auth/me", undefined, rotated.accessToken), env);
		expect(revoked.status).toBe(401);
	});

	it("rejects invalid credentials without creating a session", async () => {
		const user = await seedUser();
		const response = await api.fetch(
			request("/auth/login", {
				email: user.email,
				password: "incorrect password",
				deviceName: "Pixel 10",
			}),
			env,
		);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "Invalid email or password" });
	});
});
