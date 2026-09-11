import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { contacts, domains, mailboxes, messageAttachments, messages, outboundDeliveries, outboundJobs, templateAttachments, users } from "@/db/schema";
import { api } from "@/worker/api";
import { hashPassword } from "@/worker/auth/password";
import { createSession, SESSION_COOKIE } from "@/worker/auth/session";
import { claimOutboundDelivery, processOutboundJob } from "@/worker/email/send";

const createdUsers: string[] = [];

afterEach(async () => {
	const db = getDb(env.DB);
	for (const id of createdUsers.splice(0)) await db.delete(users).where(eq(users.id, id));
});

describe("outbound delivery retry", () => {
	it("queues a private copy for each unblocked campaign contact", async () => {
		const db = getDb(env.DB);
		const user = await db.insert(users).values({
			email: `campaign-${crypto.randomUUID()}@example.test`, name: "Campaign", passwordHash: await hashPassword("test password"),
		}).returning().get();
		createdUsers.push(user.id);
		const domain = await db.insert(domains).values({
			hostname: `${crypto.randomUUID()}.test`, zoneId: "mock", userId: user.id, status: "active", sendingEnabled: true,
		}).returning().get();
		const mailbox = await db.insert(mailboxes).values({ domainId: domain.id, userId: user.id, localPart: "hello" }).returning().get();
		const [recipient, blocked] = await db.insert(contacts).values([
			{ userId: user.id, email: "recipient@example.test", displayName: "Recipient", source: "manual" },
			{ userId: user.id, email: "blocked@example.test", blocked: true, source: "manual" },
		]).returning().all();
		const session = await createSession(db, user.id);
		const cookie = `${SESSION_COOKIE}=${session.token}`;
		const response = await api.fetch(new Request("https://pogmail.test/api/send/campaigns", {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({
				mailboxId: mailbox.id,
				contactIds: [recipient!.id, blocked!.id, "removed-contact"],
				subject: "Hello",
				bodyText: "A private update",
				bodyHtml: "<p>A private update</p>",
			}),
		}), env);

		expect(response.status).toBe(202);
		const result = await response.json() as { id: string; queued: number; skippedBlocked: number; skippedMissing: number };
		expect(result).toMatchObject({ id: expect.any(String), queued: 1, skippedBlocked: 1, skippedMissing: 1 });
		const sent = await db.select().from(messages).where(eq(messages.authorUserId, user.id)).all();
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			toAddresses: [{ address: "recipient@example.test", name: "Recipient" }],
			ccAddresses: [],
			bccAddresses: [],
		});
		const jobs = await db.select().from(outboundJobs).where(eq(outboundJobs.messageId, sent[0]!.id)).all();
		expect(jobs).toHaveLength(1);

		const history = await api.fetch(new Request("https://pogmail.test/api/send/campaigns", { headers: { cookie } }), env);
		expect(await history.json()).toMatchObject({ items: [expect.objectContaining({ id: result.id, state: "queued", queued: 1 })] });
		const stopped = await api.fetch(new Request(`https://pogmail.test/api/send/campaigns/${result.id}/cancel`, {
			method: "POST", headers: { cookie },
		}), env);
		expect(stopped.status).toBe(200);
		// A Queue message already in flight checks cancellation before it can reach Email Sending.
		await processOutboundJob(env, { kind: "outbound", jobId: jobs[0]!.id });
		expect(await db.select().from(outboundJobs).where(eq(outboundJobs.id, jobs[0]!.id)).get())
			.toMatchObject({ status: "failed", lastError: "Campaign cancelled" });
	});

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
		await db.insert(outboundDeliveries).values([
			{ outboundJobId: job.id, recipient: "accepted@example.test", status: "sent", sentAt: new Date() },
			{ outboundJobId: job.id, recipient: "retry@example.test", status: "failed", lastError: "Destination rejected" },
			{ outboundJobId: job.id, recipient: "reconsider@example.test", status: "permanent", lastError: "Sender not verified" },
		]);
		const racing = await db
			.insert(outboundDeliveries)
			.values({ outboundJobId: job.id, recipient: "claim@example.test" })
			.returning()
			.get();
		const claims = await Promise.all([claimOutboundDelivery(db, racing.id), claimOutboundDelivery(db, racing.id)]);
		expect(claims.filter(Boolean)).toHaveLength(1);
		expect(await db.select().from(outboundDeliveries).where(eq(outboundDeliveries.id, racing.id)).get()).toMatchObject({ status: "sending", attempts: 1 });
		const session = await createSession(db, user.id);

		const response = await api.fetch(new Request(`https://pogmail.test/api/messages/${message.id}/retry`, {
			method: "POST", headers: { cookie: `${SESSION_COOKIE}=${session.token}` },
		}), env);
		expect(response.status).toBe(200);
		expect(await db.select().from(outboundJobs).where(eq(outboundJobs.id, job.id)).get()).toMatchObject({ status: "queued", lastError: null });
		expect(await db.select().from(outboundDeliveries).where(eq(outboundDeliveries.outboundJobId, job.id)).all()).toEqual(expect.arrayContaining([
			expect.objectContaining({ recipient: "accepted@example.test", status: "sent" }),
			expect.objectContaining({ recipient: "retry@example.test", status: "failed" }),
			expect.objectContaining({ recipient: "reconsider@example.test", status: "failed", lastError: null }),
		]));
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
		const attachment = await upload.json() as { id: string; filename: string; disposition: string };
		expect(attachment).toMatchObject({ filename: "chart.png", disposition: "inline" });
		const preview = await api.fetch(new Request(`https://pogmail.test/api/send/drafts/${draft.id}/attachments/${attachment.id}`, {
			headers: { cookie },
		}), env);
		expect(preview.status).toBe(200);
		expect(preview.headers.get("content-disposition")).toBeNull();
	});

	it("copies a template image into a draft and cleans an unreferenced CID image", async () => {
		const db = getDb(env.DB);
		const user = await db.insert(users).values({
			email: `template-${crypto.randomUUID()}@example.test`, name: "Template", passwordHash: await hashPassword("test password"),
		}).returning().get();
		createdUsers.push(user.id);
		const domain = await db.insert(domains).values({ hostname: `${crypto.randomUUID()}.test`, zoneId: "mock", userId: user.id, status: "active" }).returning().get();
		const mailbox = await db.insert(mailboxes).values({ domainId: domain.id, userId: user.id, localPart: "hello" }).returning().get();
		const session = await createSession(db, user.id);
		const cookie = `${SESSION_COOKIE}=${session.token}`;

		const created = await api.fetch(new Request("https://pogmail.test/api/templates", {
			method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ name: "Newsletter" }),
		}), env);
		const template = await created.json() as { id: string };
		const uploaded = await api.fetch(new Request(`https://pogmail.test/api/templates/${template.id}/attachments`, {
			method: "POST", headers: { cookie, "content-type": "image/png", "x-filename": "banner.png" }, body: new Uint8Array([137, 80, 78, 71]),
		}), env);
		expect(uploaded.status).toBe(201);
		const image = await uploaded.json() as { url: string };
		await api.fetch(new Request(`https://pogmail.test/api/templates/${template.id}`, {
			method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ bodyHtml: `<img src="${image.url}">` }),
		}), env);

		const draftResponse = await api.fetch(new Request("https://pogmail.test/api/send/drafts", {
			method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ mailboxId: mailbox.id, to: [] }),
		}), env);
		const draft = await draftResponse.json() as { id: string };
		const inserted = await api.fetch(new Request(`https://pogmail.test/api/templates/${template.id}/insert`, {
			method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ draftId: draft.id }),
		}), env);
		expect(inserted.status).toBe(200);
		const result = await inserted.json() as { replacements: Array<{ from: string; to: string }> };
		expect(result.replacements).toEqual([{ from: image.url, to: expect.stringMatching(/^cid:/) }]);

		const source = await db.select().from(templateAttachments).where(eq(templateAttachments.templateId, template.id)).get();
		const copied = await db.select().from(messageAttachments).where(eq(messageAttachments.messageId, draft.id)).get();
		expect(copied).toMatchObject({ disposition: "inline" });
		expect(copied?.r2Key).not.toBe(source?.r2Key);

		await api.fetch(new Request(`https://pogmail.test/api/send/drafts/${draft.id}`, {
			method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ bodyHtml: "<p>No image</p>" }),
		}), env);
		expect(await db.select().from(messageAttachments).where(eq(messageAttachments.messageId, draft.id)).all()).toEqual([]);
	});
});
