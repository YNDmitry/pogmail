import { Hono, type Context } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { WEBHOOK_EVENTS, webhookDeliveries, webhooks } from "@/db/schema";
import { audit } from "../audit";
import { runDelivery } from "../email/webhooks";
import { getPermission, hasAtLeast, listAccessibleMailboxIds } from "../mailboxes/access";
import type { AppBindings } from "../middleware/context";
import { forbidden, notFound, parseBody } from "./_util";

const webhookInput = z.object({
	mailboxId: z.string().min(1),
	url: z.url().refine((value) => value.startsWith("https://"), "Webhook URLs must use HTTPS"),
	events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
	enabled: z.boolean().default(true),
});

export const webhookRoutes = new Hono<AppBindings>()
	.get("/", async (c) => {
		const ids = await listAccessibleMailboxIds(c.get("db"), c.get("user"));
		if (ids.length === 0) return c.json({ items: [] });

		const rows = await c
			.get("db")
			.select({
				id: webhooks.id,
				mailboxId: webhooks.mailboxId,
				url: webhooks.url,
				events: webhooks.events,
				enabled: webhooks.enabled,
				consecutiveFailures: webhooks.consecutiveFailures,
				createdAt: webhooks.createdAt,
			})
			.from(webhooks)
			.where(inArray(webhooks.mailboxId, ids))
			.orderBy(desc(webhooks.createdAt))
			.all();

		return c.json({ items: rows });
	})

	.post("/", async (c) => {
		const input = await parseBody(c, webhookInput);
		await assertAccess(c, input.mailboxId);

		const row = await c
			.get("db")
			.insert(webhooks)
			.values({ ...input, secret: crypto.randomUUID().replaceAll("-", "") })
			.returning()
			.get();

		audit(c, { action: "webhook.create", mailboxId: row.mailboxId, metadata: { url: row.url } });

		// The signing secret is shown once, at creation, and never listed again.
		return c.json({ ...row }, 201);
	})

	.patch("/:id", async (c) => {
		const hook = await load(c, c.req.param("id"));
		const input = await parseBody(c, webhookInput.partial().omit({ mailboxId: true }));

		const row = await c
			.get("db")
			.update(webhooks)
			// Re-enabling by hand clears the failure counter that auto-disabled it.
			.set({ ...input, ...(input.enabled === true ? { consecutiveFailures: 0 } : {}) })
			.where(eq(webhooks.id, hook.id))
			.returning()
			.get();

		return c.json({ ...row, secret: undefined });
	})

	.delete("/:id", async (c) => {
		const hook = await load(c, c.req.param("id"));
		await c.get("db").delete(webhooks).where(eq(webhooks.id, hook.id));

		audit(c, { action: "webhook.delete", mailboxId: hook.mailboxId });
		return c.json({ ok: true });
	})

	.get("/:id/deliveries", async (c) => {
		const hook = await load(c, c.req.param("id"));

		const rows = await c
			.get("db")
			.select({
				id: webhookDeliveries.id,
				event: webhookDeliveries.event,
				status: webhookDeliveries.status,
				attempt: webhookDeliveries.attempt,
				responseStatus: webhookDeliveries.responseStatus,
				errorSnippet: webhookDeliveries.errorSnippet,
				durationMs: webhookDeliveries.durationMs,
				nextRetryAt: webhookDeliveries.nextRetryAt,
				createdAt: webhookDeliveries.createdAt,
			})
			.from(webhookDeliveries)
			.where(eq(webhookDeliveries.webhookId, hook.id))
			.orderBy(desc(webhookDeliveries.createdAt))
			.limit(100)
			.all();

		return c.json({ items: rows });
	})

	.post("/:id/deliveries/:deliveryId/retry", async (c) => {
		const hook = await load(c, c.req.param("id"));

		const delivery = await c
			.get("db")
			.select()
			.from(webhookDeliveries)
			.where(
				and(
					eq(webhookDeliveries.id, c.req.param("deliveryId")),
					eq(webhookDeliveries.webhookId, hook.id),
				),
			)
			.get();
		if (!delivery) notFound("Delivery");

		// Shares `runDelivery` with the retry queue, so a manual retry behaves
		// identically to an automatic one, backoff included.
		await runDelivery(c.env, delivery.id, delivery.attempt);

		const after = await c
			.get("db")
			.select()
			.from(webhookDeliveries)
			.where(eq(webhookDeliveries.id, delivery.id))
			.get();

		return c.json(after);
	})

	/** Sends a synthetic event so the user can verify their endpoint before real mail. */
	.post("/:id/test", async (c) => {
		const hook = await load(c, c.req.param("id"));

		const delivery = await c
			.get("db")
			.insert(webhookDeliveries)
			.values({
				webhookId: hook.id,
				event: "message.received",
				payload: {
					test: true,
					id: "test-message",
					mailboxId: hook.mailboxId,
					subject: "Pogmail test event",
					from: "pogmail@example.invalid",
					receivedAt: Date.now(),
				},
			})
			.returning({ id: webhookDeliveries.id })
			.get();

		await runDelivery(c.env, delivery.id, 0);

		const after = await c
			.get("db")
			.select()
			.from(webhookDeliveries)
			.where(eq(webhookDeliveries.id, delivery.id))
			.get();

		return c.json(after);
	});

async function load(c: Context<AppBindings>, id: string) {
	const hook = await c.get("db").select().from(webhooks).where(eq(webhooks.id, id)).get();
	if (!hook) notFound("Webhook");
	await assertAccess(c, hook.mailboxId);
	return hook;
}

async function assertAccess(c: Context<AppBindings>, mailboxId: string): Promise<void> {
	const permission = await getPermission(c.get("db"), c.get("user"), mailboxId);
	if (!hasAtLeast(permission, "full_access")) forbidden("You do not have full access to this mailbox");
}
