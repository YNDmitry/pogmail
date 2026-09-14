import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { getCookie } from "hono/cookie";
import { and, eq, isNull, sql } from "drizzle-orm";
import { appSettings, passkeyChallenges, passkeys, recoveryCodes, users } from "@/db/schema";
import { z } from "zod";
import { loginInput, registerInput } from "@/shared/contract/auth";
import { audit } from "../audit";
import { hashPassword, sha256Hex, verifyPassword } from "../auth/password";
import {
	randomChallenge,
	toBase64Url,
	verifyAuthentication,
	verifyClientData,
	verifyRegistration,
} from "../auth/passkey";
import {
	clearedSessionCookie,
	createSession,
	destroySession,
	sessionCookie,
	SESSION_COOKIE,
} from "../auth/session";
import { requireAuth } from "../middleware/auth";
import type { AppBindings } from "../middleware/context";
import { parseBody } from "./_util";

const passkeyChallengeInput = z.object({ challengeId: z.string().min(1).max(64) });
const recoveryLoginInput = z.object({ email: z.email(), code: z.string().min(6).max(32) });
const registrationInput = passkeyChallengeInput.extend({
	name: z.string().trim().min(1).max(120).optional(),
	credential: z.object({
		id: z.string().min(1).max(2048),
		rawId: z.string().min(1).max(2048),
		response: z.object({
			clientDataJSON: z.string().min(1).max(16_384),
			attestationObject: z.string().min(1).max(65_536),
		}),
	}),
});
const authenticationInput = passkeyChallengeInput.extend({
	credential: z.object({
		id: z.string().min(1).max(2048),
		rawId: z.string().min(1).max(2048),
		response: z.object({
			clientDataJSON: z.string().min(1).max(16_384),
			authenticatorData: z.string().min(1).max(2048),
			signature: z.string().min(1).max(2048),
		}),
	}),
});

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export const authRoutes = new Hono<AppBindings>()
	.post("/login", async (c) => {
		const input = await parseBody(c, loginInput);

		// Rate limit on the address so one attacker cannot lock out the whole instance.
		const { success } = await c.env.AUTH_RATE_LIMIT.limit({ key: input.email.toLowerCase() });
		if (!success) throw new HTTPException(429, { message: "Too many attempts, try again shortly" });

		const user = await c.get("db").select().from(users).where(eq(users.email, input.email.toLowerCase())).get();

		// Same message and roughly the same work either way: no user enumeration.
		const ok = user ? await verifyPassword(input.password, user.passwordHash) : false;
		if (!user || !ok || user.disabled) throw new HTTPException(401, { message: "Invalid email or password" });

		const session = await createSession(c.get("db"), user.id, {
			userAgent: c.req.header("user-agent"),
			ip: c.req.header("cf-connecting-ip"),
		});

		c.header("set-cookie", sessionCookie(session.token, session.expiresAt));
		c.set("user", {
			id: user.id,
			email: user.email,
			name: user.name,
			role: user.role,
			avatarKey: user.avatarKey,
			mailLayout: user.mailLayout,
			telegramChatId: user.telegramChatId,
			canManageMailboxes: user.canManageMailboxes,
		});
		audit(c, { action: "auth.login" });

		return c.json(c.get("user"));
	})

	.post("/recovery-login", async (c) => {
		const input = await parseBody(c, recoveryLoginInput);
		const email = input.email.toLowerCase();
		const { success } = await c.env.AUTH_RATE_LIMIT.limit({ key: `recovery:${email}` });
		if (!success) throw new HTTPException(429, { message: "Too many attempts, try again shortly" });
		const user = await c.get("db").select().from(users).where(eq(users.email, email)).get();
		const hash = await sha256Hex(input.code.toUpperCase().replaceAll(/[^A-Z0-9]/g, ""));
		const code = user ? await c.get("db").select().from(recoveryCodes).where(and(eq(recoveryCodes.userId, user.id), eq(recoveryCodes.codeHash, hash), isNull(recoveryCodes.usedAt))).get() : undefined;
		if (!user || user.disabled || !code) throw new HTTPException(401, { message: "Invalid recovery code" });
		await c.get("db").update(recoveryCodes).set({ usedAt: new Date() }).where(eq(recoveryCodes.id, code.id));
		const session = await createSession(c.get("db"), user.id, { userAgent: c.req.header("user-agent"), ip: c.req.header("cf-connecting-ip") });
		c.header("set-cookie", sessionCookie(session.token, session.expiresAt));
		audit(c, { action: "auth.recovery_login" });
		return c.json({ ok: true });
	})

	.post("/passkeys/register/options", requireAuth, async (c) => {
		const user = c.get("user");
		const challenge = randomChallenge();
		const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
		const record = await c
			.get("db")
			.insert(passkeyChallenges)
			.values({ userId: user.id, challenge, purpose: "registration", expiresAt })
			.returning({ id: passkeyChallenges.id })
			.get();
		const url = new URL(c.req.url);
		const existing = await c
			.get("db")
			.select({ credentialId: passkeys.credentialId })
			.from(passkeys)
			.where(eq(passkeys.userId, user.id));

		return c.json({
			challengeId: record.id,
			publicKey: {
				challenge,
				rp: { id: url.hostname, name: "Pogmail" },
				user: { id: toBase64Url(new TextEncoder().encode(user.id)), name: user.email, displayName: user.name },
				pubKeyCredParams: [{ type: "public-key", alg: -7 }],
				timeout: CHALLENGE_TTL_MS,
				attestation: "none",
				authenticatorSelection: { residentKey: "required", userVerification: "required" },
				excludeCredentials: existing.map((credential) => ({
					type: "public-key",
					id: credential.credentialId,
				})),
			},
		});
	})

	.post("/passkeys/register/verify", requireAuth, async (c) => {
		const input = await parseBody(c, registrationInput);
		const user = c.get("user");
		const challenge = await consumeChallenge(c, input.challengeId, "registration", user.id);
		const url = new URL(c.req.url);
		await verifyClientData(input.credential.response.clientDataJSON, "webauthn.create", challenge, url.origin);
		if (input.credential.id !== input.credential.rawId) throw new HTTPException(400, { message: "Invalid passkey credential" });
		const verified = await verifyRegistration(input.credential.response.attestationObject, url.hostname);
		if (verified.credentialId !== input.credential.rawId) throw new HTTPException(400, { message: "Invalid passkey credential" });

		const created = await c
			.get("db")
			.insert(passkeys)
			.values({
				userId: user.id,
				credentialId: verified.credentialId,
				publicKey: verified.publicKey,
				signCount: verified.signCount,
				name: input.name || "Passkey",
			})
			.returning({ id: passkeys.id, name: passkeys.name, createdAt: passkeys.createdAt })
			.get()
			.catch((error: unknown) => {
				if (isUniqueViolation(error)) throw new HTTPException(409, { message: "This passkey is already registered" });
				throw error;
			});

		audit(c, { action: "auth.passkey_register", metadata: { passkeyId: created.id } });
		return c.json(created, 201);
	})

	.post("/passkeys/authenticate/options", async (c) => {
		const challenge = randomChallenge();
		const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
		const record = await c
			.get("db")
			.insert(passkeyChallenges)
			.values({ challenge, purpose: "authentication", expiresAt })
			.returning({ id: passkeyChallenges.id })
			.get();
		const url = new URL(c.req.url);
		return c.json({
			challengeId: record.id,
			publicKey: {
				challenge,
				rpId: url.hostname,
				timeout: CHALLENGE_TTL_MS,
				userVerification: "required",
			},
		});
	})

	.post("/passkeys/authenticate/verify", async (c) => {
		const input = await parseBody(c, authenticationInput);
		const challenge = await consumeChallenge(c, input.challengeId, "authentication");
		const url = new URL(c.req.url);
		const clientData = await verifyClientData(input.credential.response.clientDataJSON, "webauthn.get", challenge, url.origin);
		if (input.credential.id !== input.credential.rawId) throw new HTTPException(400, { message: "Invalid passkey credential" });
		const passkey = await c
			.get("db")
			.select()
			.from(passkeys)
			.where(eq(passkeys.credentialId, input.credential.rawId))
			.get();
		if (!passkey) throw new HTTPException(401, { message: "This passkey is not registered" });
		const signCount = await verifyAuthentication(
			input.credential.response.authenticatorData,
			clientData,
			input.credential.response.signature,
			passkey.publicKey,
			url.hostname,
		);
		if (passkey.signCount !== 0 && signCount !== 0 && signCount <= passkey.signCount) {
			throw new HTTPException(401, { message: "This passkey may have been copied; use your password instead" });
		}

		const user = await c.get("db").select().from(users).where(eq(users.id, passkey.userId)).get();
		if (!user || user.disabled) throw new HTTPException(401, { message: "This account is unavailable" });
		await c
			.get("db")
			.update(passkeys)
			.set({ signCount: Math.max(passkey.signCount, signCount), lastUsedAt: new Date() })
			.where(eq(passkeys.id, passkey.id));
		const session = await createSession(c.get("db"), user.id, {
			userAgent: c.req.header("user-agent"),
			ip: c.req.header("cf-connecting-ip"),
		});
		c.header("set-cookie", sessionCookie(session.token, session.expiresAt));
		c.set("user", {
			id: user.id,
			email: user.email,
			name: user.name,
			role: user.role,
			avatarKey: user.avatarKey,
			mailLayout: user.mailLayout,
			telegramChatId: user.telegramChatId,
			canManageMailboxes: user.canManageMailboxes,
		});
		audit(c, { action: "auth.passkey_login", metadata: { passkeyId: passkey.id } });
		return c.json(c.get("user"));
	})

	.post("/register", async (c) => {
		const settings = await c.get("db").select().from(appSettings).get();
		if (!settings?.allowRegistration) {
			throw new HTTPException(403, { message: "Registration is disabled on this instance" });
		}

		const input = await parseBody(c, registerInput);
		const email = input.email.toLowerCase();

		const taken = await c.get("db").select({ id: users.id }).from(users).where(eq(users.email, email)).get();
		if (taken) throw new HTTPException(409, { message: "That email is already registered" });

		const user = await c
			.get("db")
			.insert(users)
			.values({ email, name: input.name, passwordHash: await hashPassword(input.password), role: "user" })
			.returning()
			.get();

		const session = await createSession(c.get("db"), user.id, {
			userAgent: c.req.header("user-agent"),
			ip: c.req.header("cf-connecting-ip"),
		});
		c.header("set-cookie", sessionCookie(session.token, session.expiresAt));

		return c.json(
			{
				id: user.id,
				email: user.email,
				name: user.name,
				role: user.role,
				avatarKey: user.avatarKey,
				mailLayout: user.mailLayout,
				telegramChatId: user.telegramChatId,
				canManageMailboxes: user.canManageMailboxes,
			},
			201,
		);
	})

	.post("/logout", async (c) => {
		await destroySession(c.get("db"), getCookie(c, SESSION_COOKIE));
		c.header("set-cookie", clearedSessionCookie);
		return c.json({ ok: true });
	})

	.get("/me", requireAuth, (c) => c.json(c.get("user")));

/** True when the instance has no users yet; drives the first-run wizard. */
export async function instanceIsEmpty(db: AppBindings["Variables"]["db"]): Promise<boolean> {
	const row = await db.select({ count: sql<number>`COUNT(*)` }).from(users).get();
	return (row?.count ?? 0) === 0;
}

async function consumeChallenge(
	c: Context<AppBindings>,
	id: string,
	purpose: "registration" | "authentication",
	userId?: string,
): Promise<string> {
	const row = await c.get("db").select().from(passkeyChallenges).where(eq(passkeyChallenges.id, id)).get();
	// Delete before verification: even a malformed assertion makes the ceremony single-use.
	if (row) await c.get("db").delete(passkeyChallenges).where(eq(passkeyChallenges.id, row.id));
	if (!row || row.purpose !== purpose || row.expiresAt <= new Date() || (userId !== undefined && row.userId !== userId)) {
		throw new HTTPException(400, { message: "This passkey request has expired; try again" });
	}
	return row.challenge;
}

function isUniqueViolation(error: unknown): boolean {
	return error instanceof Error && /unique|constraint/iu.test(error.message);
}
