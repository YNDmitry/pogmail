import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, eq } from "drizzle-orm";
import { domains, mailboxes, messages } from "@/db/schema";
import { isMockProvisioningEnabled, mockZoneId } from "../domains/mock";
import type { AppBindings } from "../middleware/context";

/** Local-only sample data, so a new installation has a useful inbox to inspect. */
export const demoRoutes = new Hono<AppBindings>()
	.get("/", (c) => c.json({ enabled: isMockProvisioningEnabled(c.env) }))
	.post("/seed", async (c) => {
		if (!isMockProvisioningEnabled(c.env)) throw new HTTPException(404, { message: "Local demo is disabled" });

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

		return c.json({ domain, mailbox, seeded: !existing });
	});
