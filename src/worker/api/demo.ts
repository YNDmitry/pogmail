import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, eq } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import { calendarEvents, contacts, domains, emailTemplates, mailboxes, messages } from "@/db/schema";
import { isMockProvisioningEnabled, mockZoneId } from "../domains/mock";
import type { AppBindings } from "../middleware/context";

/** Local-only sample data, so a new installation has a useful inbox to inspect. */
export const demoRoutes = new Hono<AppBindings>()
	.get("/", (c) => c.json({ enabled: isMockProvisioningEnabled(c.env) }))
	.post("/seed", async (c) => {
		if (!isMockProvisioningEnabled(c.env)) throw new HTTPException(404, { message: "Local demo is disabled" });
		let showcase = false;
		try {
			showcase = Boolean((await c.req.json<{ showcase?: boolean }>()).showcase);
		} catch {
			// An empty request body is the backwards-compatible minimal seed.
		}

		const db = c.get("db");
		const user = c.get("user");
		const hostname = "acme.test";
		let domain = await db.select().from(domains).where(eq(domains.hostname, hostname)).get();
		if (domain && domain.userId !== user.id) {
			throw new HTTPException(409, { message: "acme.test belongs to another local account" });
		}
		if (!domain) {
			domain = await db
				.insert(domains)
				.values({
					userId: user.id,
					hostname,
					zoneId: mockZoneId(hostname),
					status: "active",
					routingEnabled: true,
					routingStatus: "mock",
					sendingEnabled: true,
					verifiedAt: new Date(),
				})
				.returning()
				.get();
		}

		let mailbox = await db
			.select()
			.from(mailboxes)
			.where(and(eq(mailboxes.domainId, domain.id), eq(mailboxes.userId, user.id)))
			.get();
		if (!mailbox) {
			mailbox = await db
				.insert(mailboxes)
				.values({ domainId: domain.id, userId: user.id, localPart: "hello", displayName: "Alex Morgan" })
				.returning()
				.get();
		}

		const existing = await db
			.select({ id: messages.id })
			.from(messages)
			.where(eq(messages.mailboxId, mailbox.id))
			.limit(1)
			.get();
		if (!existing) {
			const address = `${mailbox.localPart}@${hostname}`;
			await db.insert(messages).values([
				{
					mailboxId: mailbox.id,
					direction: "inbound",
					status: "received",
					threadId: crypto.randomUUID(),
					messageId: `<welcome@acme.test>`,
					fromAddress: "mira@northstar.test",
					fromName: "Mira Chen",
					toAddresses: [{ address }],
					subject: "Welcome to the local inbox",
					bodyText: "This is a local demo message. Try replying, starring it, or opening Compose.",
					bodyHtml: "<p>This is a local demo message.</p><p>Try replying, starring it, or opening Compose.</p>",
					snippet: "This is a local demo message. Try replying, starring it, or opening Compose.",
					receivedAt: new Date(Date.now() - 12 * 60_000),
				},
				{
					mailboxId: mailbox.id,
					direction: "inbound",
					status: "received",
					threadId: crypto.randomUUID(),
					messageId: `<briefing@acme.test>`,
					fromAddress: "ops@northstar.test",
					fromName: "Northstar Ops",
					toAddresses: [{ address }],
					subject: "Friday briefing",
					bodyText: "The weekly briefing is ready for review.",
					snippet: "The weekly briefing is ready for review.",
					read: true,
					receivedAt: new Date(Date.now() - 3 * 60 * 60_000),
				},
			]);
		}

		if (showcase) {
			const address = `${mailbox.localPart}@${hostname}`;
			const showcaseMarker = await db
				.select({ id: messages.id })
				.from(messages)
				.where(and(eq(messages.mailboxId, mailbox.id), eq(messages.messageId, "<showcase-planning@acme.test>")))
				.get();
			if (!showcaseMarker) {
				const now = Date.now();
				const thread = crypto.randomUUID();
				const showcaseMessages: InferInsertModel<typeof messages>[] = [
					{
						mailboxId: mailbox.id,
						direction: "inbound",
						status: "received",
						threadId: thread,
						messageId: "<showcase-planning@acme.test>",
						fromAddress: "sophie@lumen.studio",
						fromName: "Sophie Laurent",
						toAddresses: [{ address, name: mailbox.displayName ?? undefined }],
						subject: "Your Q4 launch plan is ready ✨",
						bodyText: "Hi Alex,\n\nI pulled together the launch plan and a few ideas for the first week. The timeline looks great — would love your thoughts before Thursday.\n\nSophie",
						bodyHtml: "<p>Hi Alex,</p><p>I pulled together the launch plan and a few ideas for the first week. The timeline looks great — would love your thoughts before Thursday.</p><p>Sophie</p>",
						snippet: "I pulled together the launch plan and a few ideas for the first week. The timeline looks great…",
						read: false,
						starred: true,
						hasAttachments: true,
						sizeBytes: 128_400,
						receivedAt: new Date(now - 28 * 60_000),
					},
					{
						mailboxId: mailbox.id,
						direction: "inbound",
						status: "received",
						threadId: crypto.randomUUID(),
						messageId: "<showcase-receipt@acme.test>",
						fromAddress: "billing@northstar.test",
						fromName: "Northstar Billing",
						toAddresses: [{ address }],
						subject: "Receipt for your Pro plan",
						bodyText: "Thanks for being with us. Your latest invoice is attached and your plan is active through October 12, 2026.",
						bodyHtml: "<p>Thanks for being with us.</p><p>Your latest invoice is attached and your plan is active through October 12, 2026.</p>",
						snippet: "Your latest invoice is attached and your plan is active through October 12, 2026.",
						read: true,
						receivedAt: new Date(now - 4 * 60 * 60_000),
						hasAttachments: true,
						sizeBytes: 64_200,
					},
					{
						mailboxId: mailbox.id,
						direction: "inbound",
						status: "received",
						threadId: crypto.randomUUID(),
						messageId: "<showcase-invite@acme.test>",
						fromAddress: "jordan@studio.test",
						fromName: "Jordan Kim",
						toAddresses: [{ address }],
						subject: "Coffee next week?",
						bodyText: "I’ll be downtown on Tuesday afternoon. Want to catch up at the usual place?",
						bodyHtml: "<p>I’ll be downtown on Tuesday afternoon. Want to catch up at the usual place?</p>",
						snippet: "I’ll be downtown on Tuesday afternoon. Want to catch up at the usual place?",
						read: true,
						receivedAt: new Date(now - 25 * 60 * 60_000),
					},
					{
						mailboxId: mailbox.id,
						authorUserId: user.id,
						direction: "outbound",
						status: "sent",
						threadId: crypto.randomUUID(),
						messageId: "<showcase-sent@acme.test>",
						fromAddress: address,
						fromName: mailbox.displayName ?? "Alex Morgan",
						toAddresses: [{ address: "team@northstar.test", name: "Northstar Team" }],
						subject: "Project Aurora — next steps",
						bodyText: "Thanks everyone — I’ve added the final notes and will share the updated timeline tomorrow morning.",
						bodyHtml: "<p>Thanks everyone — I’ve added the final notes and will share the updated timeline tomorrow morning.</p>",
						snippet: "I’ve added the final notes and will share the updated timeline tomorrow morning.",
						read: true,
						receivedAt: new Date(now - 2 * 24 * 60 * 60_000),
					},
					{
						mailboxId: mailbox.id,
						authorUserId: user.id,
						direction: "outbound",
						status: "draft",
						threadId: crypto.randomUUID(),
						messageId: "<showcase-draft@acme.test>",
						fromAddress: address,
						fromName: mailbox.displayName ?? "Alex Morgan",
						toAddresses: [{ address: "sophie@lumen.studio", name: "Sophie Laurent" }],
						subject: "Re: Your Q4 launch plan is ready ✨",
						bodyText: "This looks fantastic — I’m reviewing the timeline now and will send notes shortly.",
						bodyHtml: "<p>This looks fantastic — I’m reviewing the timeline now and will send notes shortly.</p>",
						snippet: "This looks fantastic — I’m reviewing the timeline now…",
						read: true,
						receivedAt: new Date(now - 3 * 60 * 60_000),
					},
					{
						mailboxId: mailbox.id,
						direction: "inbound",
						status: "trash",
						threadId: crypto.randomUUID(),
						messageId: "<showcase-trash@acme.test>",
						fromAddress: "offers@noise.test",
						fromName: "Weekend Offers",
						toAddresses: [{ address }],
						subject: "You’re invited: 20% off this weekend",
						bodyText: "A promotional message for the trash folder preview.",
						snippet: "A promotional message for the trash folder preview.",
						read: true,
						receivedAt: new Date(now - 5 * 24 * 60 * 60_000),
					},
				];
				for (const showcaseMessage of showcaseMessages) await db.insert(messages).values(showcaseMessage);
			}
			await db
				.update(messages)
				.set({
					bodyText: "Thanks for being with us. Your Pro plan receipt is ready. Total paid: $149.00 USD.",
					bodyHtml: `<div style="margin:0 auto;max-width:620px;background:#f6f7f9;color:#17202a;font-family:Arial,Helvetica,sans-serif;padding:32px 20px">
						<div style="background:#121820;border-radius:16px 16px 0 0;padding:24px 28px;color:#fff">
							<div style="font-size:13px;letter-spacing:1.8px;text-transform:uppercase;color:#ff8178;font-weight:700">Northstar</div>
							<div style="font-size:26px;font-weight:700;margin-top:14px">Payment receipt</div>
							<div style="font-size:14px;color:#b9c0c9;margin-top:6px">September 10, 2026 · INV-2048</div>
						</div>
						<div style="background:#fff;border:1px solid #e6e9ed;border-top:0;border-radius:0 0 16px 16px;padding:28px">
							<div style="font-size:14px;color:#68717c">BILLED TO</div>
							<div style="font-size:17px;font-weight:700;margin-top:6px">Alex Morgan</div>
							<div style="font-size:14px;color:#68717c;margin-top:3px">hello@acme.test</div>
							<div style="height:1px;background:#edf0f2;margin:24px 0"></div>
							<table role="presentation" style="width:100%;border-collapse:collapse;font-size:15px"><tr><td style="padding:8px 0;color:#68717c">Northstar Pro plan</td><td style="padding:8px 0;text-align:right;font-weight:700">$149.00</td></tr><tr><td style="padding:8px 0;color:#68717c">Tax</td><td style="padding:8px 0;text-align:right">$0.00</td></tr><tr><td style="padding:16px 0 4px;border-top:1px solid #edf0f2;font-size:18px;font-weight:700">Total paid</td><td style="padding:16px 0 4px;border-top:1px solid #edf0f2;text-align:right;font-size:18px;font-weight:700;color:#df403d">$149.00 USD</td></tr></table>
							<div style="display:inline-block;margin-top:24px;border-radius:999px;background:#eaf8ef;color:#22844a;padding:8px 14px;font-size:13px;font-weight:700">✓ Payment successful</div>
							<p style="font-size:14px;line-height:1.6;color:#68717c;margin:28px 0 0">Thanks for being with us. Your plan is active through October 12, 2026.</p>
						</div>
						<div style="text-align:center;color:#8a929c;font-size:12px;padding:20px 8px">Northstar · Built for thoughtful teams<br><span style="color:#a8afb8">Questions? Reply to this email.</span></div>
					</div>`,
				})
				.where(and(eq(messages.mailboxId, mailbox.id), eq(messages.messageId, "<showcase-receipt@acme.test>")));

			await db.insert(contacts).values([
				{ userId: user.id, email: "sophie@lumen.studio", displayName: "Sophie Laurent", source: "inbound", messageCount: 4, lastSeenAt: new Date() },
				{ userId: user.id, email: "team@northstar.test", displayName: "Northstar Team", source: "outbound", messageCount: 3, lastSeenAt: new Date(Date.now() - 2 * 60 * 60_000) },
				{ userId: user.id, email: "jordan@studio.test", displayName: "Jordan Kim", source: "inbound", messageCount: 2, lastSeenAt: new Date(Date.now() - 25 * 60 * 60_000) },
			]).onConflictDoNothing();
			const template = await db.select({ id: emailTemplates.id }).from(emailTemplates).where(and(eq(emailTemplates.userId, user.id), eq(emailTemplates.name, "Warm follow-up"))).get();
			if (!template) {
				await db.insert(emailTemplates).values({
					userId: user.id,
					name: "Warm follow-up",
					subject: "Great connecting today",
					bodyText: "Hi there,\n\nIt was great connecting today. I’ll follow up with the details we discussed shortly.\n\nBest,\nAlex",
					bodyHtml: "<p>Hi there,</p><p>It was great connecting today. I’ll follow up with the details we discussed shortly.</p><p>Best,<br>Alex</p>",
				});
			} else {
				await db.update(emailTemplates).set({
					subject: "Great connecting today — a quick follow-up",
					bodyText: "Hi there,\n\nIt was great connecting today. I’ll follow up with the details we discussed shortly.\n\nBest,\nAlex",
					bodyHtml: `<div style="margin:0 auto;max-width:600px;background:#fff;color:#20242a;font-family:Arial,Helvetica,sans-serif;padding:36px"><div style="font-size:13px;letter-spacing:1.6px;text-transform:uppercase;color:#df403d;font-weight:700">Pogmail</div><h1 style="font-size:28px;line-height:1.2;margin:28px 0 16px">Great connecting today</h1><p style="font-size:16px;line-height:1.65;color:#59616b">Hi there,<br><br>It was great connecting today. I’ll follow up with the details we discussed shortly.</p><div style="margin:28px 0;padding:18px 20px;border-left:3px solid #ff5e57;background:#fff4f3;color:#59616b;font-size:14px;line-height:1.6">A thoughtful follow-up makes every conversation easier to continue.</div><p style="font-size:16px;line-height:1.65;color:#59616b">Best,<br><strong style="color:#20242a">Alex</strong></p></div>`,
				}).where(eq(emailTemplates.id, template.id));
			}
			const event = await db.select({ id: calendarEvents.id }).from(calendarEvents).where(and(eq(calendarEvents.userId, user.id), eq(calendarEvents.title, "Aurora launch review"))).get();
			if (!event) {
				const startsAt = new Date(Date.now() + 2 * 24 * 60 * 60_000);
				startsAt.setHours(10, 30, 0, 0);
				await db.insert(calendarEvents).values({
					userId: user.id,
					mailboxId: mailbox.id,
					title: "Aurora launch review",
					description: "Review final launch checklist and owners.",
					location: "Google Meet",
					attendees: [{ address: "sophie@lumen.studio", name: "Sophie Laurent" }, { address }],
					startsAt,
					endsAt: new Date(startsAt.getTime() + 45 * 60_000),
				});
			}
		}

		return c.json({ domain, mailbox, seeded: !existing, showcase });
	});
