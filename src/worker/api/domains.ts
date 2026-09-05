import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { domainRecords, domains, mailboxes } from "@/db/schema";
import { audit } from "../audit";
import { CloudflareClient } from "../cloudflare/client";
import { getRoutingSettings } from "../cloudflare/email-routing";
import { listDnsRecords } from "../cloudflare/zones";
import { deprovisionDomain, provisionDomain, resolveZone } from "../domains/provision";
import { requireMailboxManager } from "../middleware/auth";
import type { AppBindings } from "../middleware/context";
import { notFound, parseBody } from "./_util";

const createInput = z.object({
	hostname: z
		.string()
		.min(3)
		.max(253)
		.regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "That does not look like a hostname"),
	/** Optional: normally resolved from the account's zones automatically. */
	zoneId: z.string().optional(),
});

export const domainRoutes = new Hono<AppBindings>()
	.get("/", async (c) => {
		const rows = await c.get("db").select().from(domains).orderBy(desc(domains.createdAt)).all();
		return c.json({ items: rows });
	})

	.post("/", requireMailboxManager, async (c) => {
		const input = await parseBody(c, createInput);
		const hostname = input.hostname.toLowerCase();

		const existing = await c
			.get("db")
			.select({ id: domains.id })
			.from(domains)
			.where(eq(domains.hostname, hostname))
			.get();
		if (existing) throw new HTTPException(409, { message: "That domain is already added" });

		const zoneId = input.zoneId ?? (await resolveZone(c.env, hostname))?.id;
		if (!zoneId) {
			throw new HTTPException(422, {
				message: `No Cloudflare zone on this account covers ${hostname}. Add the domain to Cloudflare first.`,
			});
		}

		const domain = await c
			.get("db")
			.insert(domains)
			.values({ hostname, zoneId, userId: c.get("user").id, status: "pending" })
			.returning()
			.get();

		// Provisioning talks to Cloudflare across several calls; do it after the row
		// exists so a failure is visible in the UI rather than lost.
		const result = await provisionDomain(c.env, c.get("db"), domain.id);
		audit(c, { action: "domain.create", metadata: { hostname, status: result.status } });

		const saved = await c.get("db").select().from(domains).where(eq(domains.id, domain.id)).get();
		return c.json(saved, 201);
	})

	.get("/:id", async (c) => {
		const domain = await c.get("db").select().from(domains).where(eq(domains.id, c.req.param("id"))).get();
		if (!domain) notFound("Domain");

		const boxes = await c
			.get("db")
			.select({ id: mailboxes.id, localPart: mailboxes.localPart, disabled: mailboxes.disabled })
			.from(mailboxes)
			.where(eq(mailboxes.domainId, domain.id))
			.all();

		return c.json({ ...domain, mailboxes: boxes });
	})

	/** Live DNS and Email Routing state, read straight from Cloudflare. */
	.get("/:id/dns", async (c) => {
		const domain = await c.get("db").select().from(domains).where(eq(domains.id, c.req.param("id"))).get();
		if (!domain) notFound("Domain");

		const cf = CloudflareClient.fromEnv(c.env);
		const [routing, records, tracked] = await Promise.all([
			getRoutingSettings(cf, domain.zoneId).catch(() => null),
			listDnsRecords(cf, domain.zoneId).catch(() => []),
			c.get("db").select().from(domainRecords).where(eq(domainRecords.domainId, domain.id)).all(),
		]);

		const ours = new Set(tracked.map((record) => record.cloudflareRecordId));

		return c.json({
			routing,
			records: records
				.filter((record) => record.type === "MX" || record.type === "TXT")
				.map((record) => ({ ...record, managedByPostbox: ours.has(record.id) })),
		});
	})

	.post("/:id/verify", requireMailboxManager, async (c) => {
		const domain = await c.get("db").select().from(domains).where(eq(domains.id, c.req.param("id"))).get();
		if (!domain) notFound("Domain");

		const result = await provisionDomain(c.env, c.get("db"), domain.id);
		audit(c, { action: "domain.verify", metadata: { hostname: domain.hostname, ...result } });

		const saved = await c.get("db").select().from(domains).where(eq(domains.id, domain.id)).get();
		return c.json(saved);
	})

	.delete("/:id", requireMailboxManager, async (c) => {
		const domain = await c.get("db").select().from(domains).where(eq(domains.id, c.req.param("id"))).get();
		if (!domain) notFound("Domain");

		// Remote cleanup first: if it fails we still have the row to retry from.
		await deprovisionDomain(c.env, c.get("db"), domain.id);
		await c.get("db").delete(domains).where(eq(domains.id, domain.id));

		audit(c, { action: "domain.delete", metadata: { hostname: domain.hostname } });
		return c.json({ ok: true });
	});
