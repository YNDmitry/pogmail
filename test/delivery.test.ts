import { env } from "cloudflare:test";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { campaignLinkClicks, contacts, domains, mailboxes, messageAttachments, messages, outboundDeliveries, outboundJobs, templateAttachments, users } from "@/db/schema";
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
		const [recipient, blocked, pending] = await db.insert(contacts).values([
			{ userId: user.id, email: "recipient@example.test", displayName: "Recipient", source: "manual", marketingStatus: "subscribed" },
			{ userId: user.id, email: "blocked@example.test", blocked: true, source: "manual" },
			{ userId: user.id, email: "pending@example.test", displayName: "Pending", source: "manual", marketingStatus: "pending" },
		]).returning().all();
		const session = await createSession(db, user.id);
		const cookie = `${SESSION_COOKIE}=${session.token}`;
		const imported = await api.fetch(new Request("https://pogmail.test/api/contacts/import", {
			method: "POST", headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({ contacts: [
				{ email: "imported@example.test", displayName: "Imported" },
				{ email: "recipient@example.test", displayName: "Replaced" },
			] }),
		}), env);
		expect(imported.status).toBe(200);
		expect(await imported.json()).toMatchObject({ imported: 1, skippedExisting: 1 });
		expect(await db.select().from(contacts).where(eq(contacts.email, "imported@example.test")).get())
			.toMatchObject({ displayName: "Imported", source: "manual", marketingStatus: "pending" });
		expect(await db.select().from(contacts).where(eq(contacts.id, recipient!.id)).get())
			.toMatchObject({ displayName: "Recipient" });
		await db.run(sql`update contacts set tags = 'tags' where id = ${recipient!.id}`);
		await db.run(sql`update contacts set tags = case when json_valid(tags) then case when json_type(tags) = 'array' then tags else '[]' end else '[]' end where id = ${recipient!.id}`);
		expect(await db.select().from(contacts).where(eq(contacts.id, recipient!.id)).get())
			.toMatchObject({ tags: [] });
		const scheduledFor = Date.now() + 60_000;
		const response = await api.fetch(new Request("https://pogmail.test/api/send/campaigns", {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({
				mailboxId: mailbox.id,
				contactIds: [recipient!.id, blocked!.id, "removed-contact"],
				subject: "Hello",
				bodyText: "A private update",
				bodyHtml: '<p>A private update <a href="https://example.com/offer?source=mail&amp;id=1">See offer</a></p>',
				trackOpens: true,
				trackClicks: true,
				scheduledFor,
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
		expect(sent[0]?.openTrackingToken).toMatch(/^[0-9a-f-]{36}$/);
		expect(sent[0]?.bodyHtml).toContain(`/api/public/open?token=${sent[0]?.openTrackingToken}`);
		const click = await db.select().from(campaignLinkClicks).where(eq(campaignLinkClicks.messageId, sent[0]!.id)).get();
		expect(click).toMatchObject({ destination: "https://example.com/offer?source=mail&id=1" });
		expect(sent[0]?.bodyHtml).toContain(`/api/public/click?token=${click?.token}`);
		const jobs = await db.select().from(outboundJobs).where(eq(outboundJobs.messageId, sent[0]!.id)).all();
		expect(jobs).toHaveLength(1);
		expect(jobs[0]?.scheduledFor?.getTime()).toBe(scheduledFor);
		const confirmation = await api.fetch(new Request("https://pogmail.test/api/contacts/confirmations", {
			method: "POST", headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({ mailboxId: mailbox.id, contactIds: [pending!.id] }),
		}), env);
		expect(confirmation.status).toBe(202);
		expect(await confirmation.json()).toMatchObject({ queued: 1 });
		const pendingContact = await db.select().from(contacts).where(eq(contacts.id, pending!.id)).get();
		expect(pendingContact?.confirmationToken).toMatch(/^[0-9a-f-]{36}$/);
		const subscribePage = await api.fetch(new Request(`https://pogmail.test/api/public/subscribe?token=${pendingContact!.confirmationToken}`), env);
		expect(subscribePage.status).toBe(200);
		const subscribe = await api.fetch(new Request("https://pogmail.test/api/public/subscribe", {
			method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `token=${pendingContact!.confirmationToken}`,
		}), env);
		expect(subscribe.status).toBe(200);
		expect(await db.select().from(contacts).where(eq(contacts.id, pending!.id)).get())
			.toMatchObject({ marketingStatus: "subscribed", confirmedAt: expect.any(Date) });

		const history = await api.fetch(new Request("https://pogmail.test/api/send/campaigns", { headers: { cookie } }), env);
		expect(await history.json()).toMatchObject({ items: [expect.objectContaining({ id: result.id, state: "queued", queued: 1, opens: 0, clicks: 0, scheduledFor: expect.any(String) })] });
		const open = await api.fetch(new Request(`https://pogmail.test/api/public/open?token=${sent[0]!.openTrackingToken}`), env);
		expect(open).toMatchObject({ status: 200 });
		expect(open.headers.get("content-type")).toBe("image/gif");
		expect(await db.select().from(messages).where(eq(messages.id, sent[0]!.id)).get())
			.toMatchObject({ openedAt: expect.any(Date) });
		const openedHistory = await api.fetch(new Request("https://pogmail.test/api/send/campaigns", { headers: { cookie } }), env);
		expect(await openedHistory.json()).toMatchObject({ items: [expect.objectContaining({ id: result.id, opens: 1, clicks: 0 })] });
		const redirect = await api.fetch(new Request(`https://pogmail.test/api/public/click?token=${click!.token}`), env);
		expect(redirect).toMatchObject({ status: 302 });
		expect(redirect.headers.get("location")).toBe("https://example.com/offer?source=mail&id=1");
		expect(await db.select().from(campaignLinkClicks).where(eq(campaignLinkClicks.id, click!.id)).get())
			.toMatchObject({ clickedAt: expect.any(Date) });
		const clickedHistory = await api.fetch(new Request("https://pogmail.test/api/send/campaigns", { headers: { cookie } }), env);
		expect(await clickedHistory.json()).toMatchObject({ items: [expect.objectContaining({ id: result.id, opens: 1, clicks: 1 })] });
		const stopped = await api.fetch(new Request(`https://pogmail.test/api/send/campaigns/${result.id}/cancel`, {
			method: "POST", headers: { cookie },
		}), env);
		expect(stopped.status).toBe(200);
		// A Queue message already in flight checks cancellation before it can reach Email Sending.
		await processOutboundJob(env, { kind: "outbound", jobId: jobs[0]!.id });
		expect(await db.select().from(outboundJobs).where(eq(outboundJobs.id, jobs[0]!.id)).get())
			.toMatchObject({ status: "failed", lastError: "Campaign cancelled" });
		const contact = await db.select().from(contacts).where(eq(contacts.id, recipient!.id)).get();
		expect(contact?.unsubscribeToken).toMatch(/^[0-9a-f-]{36}$/);
		const tagged = await api.fetch(new Request("https://pogmail.test/api/contacts/tags", {
			method: "POST", headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({ contactIds: [recipient!.id], tag: "VIP" }),
		}), env);
		expect(tagged.status).toBe(200);
		expect(await db.select().from(contacts).where(eq(contacts.id, recipient!.id)).get())
			.toMatchObject({ tags: ["VIP"] });
		const targeted = await api.fetch(new Request("https://pogmail.test/api/send/campaigns", {
			method: "POST", headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({ mailboxId: mailbox.id, contactIds: [recipient!.id], tag: "VIP", subject: "VIP update", bodyText: "Hello" }),
		}), env);
		expect(targeted.status).toBe(202);
		expect(await targeted.json()).toMatchObject({ queued: 1 });
		const unsubscribe = await api.fetch(new Request("https://pogmail.test/api/public/unsubscribe", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: `token=${encodeURIComponent(contact!.unsubscribeToken!)}`,
		}), env);
		expect(unsubscribe.status).toBe(200);
		expect(await db.select().from(contacts).where(eq(contacts.id, recipient!.id)).get())
			.toMatchObject({ marketingStatus: "unsubscribed", unsubscribedAt: expect.any(Date) });
		const audienceResponse = await api.fetch(new Request("https://pogmail.test/api/contacts/audiences", {
			method: "POST", headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({ name: "Newsletter", contactIds: [recipient!.id] }),
		}), env);
		expect(audienceResponse.status).toBe(201);
		const audience = await audienceResponse.json() as { id: string; memberCount: number };
		expect(audience.memberCount).toBe(1);
		const suppressed = await api.fetch(new Request("https://pogmail.test/api/send/campaigns", {
			method: "POST", headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({ mailboxId: mailbox.id, audienceId: audience.id, subject: "Follow-up", bodyText: "Hello" }),
		}), env);
		expect(suppressed.status).toBe(422);
		const preferences = await api.fetch(new Request(`https://pogmail.test/api/public/preferences?token=${contact!.unsubscribeToken}`), env);
		expect(preferences.status).toBe(200);
		const resume = await api.fetch(new Request("https://pogmail.test/api/public/preferences", {
			method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `token=${contact!.unsubscribeToken}&status=subscribed`,
		}), env);
		expect(resume.status).toBe(200);
		expect(await db.select().from(contacts).where(eq(contacts.id, recipient!.id)).get())
			.toMatchObject({ marketingStatus: "subscribed", unsubscribedAt: null });
		const testSend = await api.fetch(new Request("https://pogmail.test/api/send/campaigns/test", {
			method: "POST", headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({
				mailboxId: mailbox.id, to: [{ address: "reviewer@example.test", name: "Reviewer" }],
				subject: "Review me", bodyText: "Hi {{first_name}}", bodyHtml: "<p>Hi {{first_name}}</p>",
			}),
		}), env);
		expect(testSend.status).toBe(202);
		const testMessage = await db.select().from(messages).where(eq(messages.subject, "[Test] Review me")).get();
		expect(testMessage).toMatchObject({ bodyText: expect.stringContaining("Hi Reviewer"), bodyHtml: expect.stringContaining("test email") });
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
