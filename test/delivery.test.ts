import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { domains, mailboxes, messages, outboundJobs, users } from "@/db/schema";
import { api } from "@/worker/api";
import { hashPassword } from "@/worker/auth/password";
import { createSession, SESSION_COOKIE } from "@/worker/auth/session";

const createdUsers: string[] = [];

afterEach(async () => {
	const db = getDb(env.DB);
	for (const id of createdUsers.splice(0)) await db.delete(users).where(eq(users.id, id));
});

describe("outbound delivery retry", () => {
	it("requeues a failed delivery for a mailbox owner", async () => {
		const db = getDb(env.DB);
		const user = await db.insert(users).values({
			email: `delivery-${crypto.randomUUID()}@example.test`, name: "Delivery", passwordHash: await hashPassword("test password"),
		}).returning().get();
		createdUsers.push(user.id);
		const domain = await db.insert(domains).values({ hostname: `${crypto.randomUUID()}.test`, zoneId: "mock", userId: user.id, status: "active" }).returning().get();
		const mailbox = await db.insert(mailboxes).values({ domainId: domain.id, userId: user.id, localPart: "hello" }).returning().get();
		const message = await db.insert(messages).values({
			mailboxId: mailbox.id, authorUserId: user.id, direction: "outbound", status: "sent", threadId: crypto.randomUUID(),
			fromAddress: "hello@example.test", toAddresses: [{ address: "recipient@example.test" }], receivedAt: new Date(),
		}).returning().get();
		const job = await db.insert(outboundJobs).values({ messageId: message.id, status: "failed", attempts: 2, lastError: "Destination rejected" }).returning().get();
		const session = await createSession(db, user.id);

		const response = await api.fetch(new Request(`https://pogmail.test/api/messages/${message.id}/retry`, {
			method: "POST", headers: { cookie: `${SESSION_COOKIE}=${session.token}` },
		}), env);
		expect(response.status).toBe(200);
		expect(await db.select().from(outboundJobs).where(eq(outboundJobs.id, job.id)).get()).toMatchObject({ status: "queued", lastError: null });
	});

	it("stores an editor image as an inline CID attachment", async () => {
		const db = getDb(env.DB);
		const user = await db.insert(users).values({
			email: `image-${crypto.randomUUID()}@example.test`, name: "Image", passwordHash: await hashPassword("test password"),
		}).returning().get();
		createdUsers.push(user.id);
		const domain = await db.insert(domains).values({ hostname: `${crypto.randomUUID()}.test`, zoneId: "mock", userId: user.id, status: "active" }).returning().get();
		const mailbox = await db.insert(mailboxes).values({ domainId: domain.id, userId: user.id, localPart: "hello" }).returning().get();
		const session = await createSession(db, user.id);
		const cookie = `${SESSION_COOKIE}=${session.token}`;
		const draftResponse = await api.fetch(new Request("https://pogmail.test/api/send/drafts", {
			method: "POST", headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({ mailboxId: mailbox.id, to: [] }),
		}), env);
		expect(draftResponse.status).toBe(201);
		const draft = await draftResponse.json() as { id: string };

		const upload = await api.fetch(new Request(`https://pogmail.test/api/send/drafts/${draft.id}/attachments`, {
			method: "POST",
			headers: { cookie, "content-type": "image/png", "x-filename": "chart.png", "x-inline": "true" },
			body: new Uint8Array([137, 80, 78, 71]),
		}), env);
		expect(upload.status).toBe(201);
		expect(await upload.json()).toMatchObject({ filename: "chart.png", disposition: "inline" });
	});
});
