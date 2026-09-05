import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { webhookDeliveries, webhooks, type WebhookEvent } from "@/db/schema";
import type { WebhookRetryMessage } from "./types";

const MAX_ATTEMPTS = 6;
const DISABLE_AFTER_FAILURES = 20;
const TIMEOUT_MS = 10_000;

/** Exponential backoff with a ceiling, in seconds: 10, 30, 90, 270, 810, 3600. */
function backoffSeconds(attempt: number): number {
	return Math.min(10 * 3 ** attempt, 3600);
}

export async function dispatchWebhooks(
	env: Env,
	mailboxId: string,
	event: WebhookEvent,
	payload: unknown,
): Promise<void> {
	const db = getDb(env.DB);

	const targets = await db
		.select()
		.from(webhooks)
		.where(and(eq(webhooks.mailboxId, mailboxId), eq(webhooks.enabled, true)))
		.all();

	for (const target of targets) {
		if (!target.events.includes(event)) continue;

		const delivery = await db
			.insert(webhookDeliveries)
			.values({ webhookId: target.id, event, payload })
			.returning({ id: webhookDeliveries.id })
			.get();

		await runDelivery(env, delivery.id, 0);
	}
}

/** Shared by the retry queue and the manual "retry now" endpoint. */
export async function runDelivery(env: Env, deliveryId: string, attempt: number): Promise<void> {
	const db = getDb(env.DB);

	const delivery = await db
		.select()
		.from(webhookDeliveries)
		.where(eq(webhookDeliveries.id, deliveryId))
		.get();
	if (!delivery) return;

	const target = await db.select().from(webhooks).where(eq(webhooks.id, delivery.webhookId)).get();
	if (!target || !target.enabled) return;

	const body = JSON.stringify(delivery.payload);
	const startedAt = Date.now();

	let responseStatus: number | null = null;
	let errorSnippet: string | null = null;

	try {
		const response = await fetch(target.url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-postbox-event": delivery.event,
				"x-postbox-delivery": delivery.id,
				"x-postbox-signature": await sign(target.secret, body),
			},
			body,
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});

		responseStatus = response.status;
		if (!response.ok) errorSnippet = (await response.text()).slice(0, 500);
	} catch (error) {
		errorSnippet = String(error).slice(0, 500);
	}

	const succeeded = responseStatus !== null && responseStatus >= 200 && responseStatus < 300;
	const nextAttempt = attempt + 1;
	const exhausted = !succeeded && nextAttempt >= MAX_ATTEMPTS;

	await db
		.update(webhookDeliveries)
		.set({
			status: succeeded ? "delivered" : exhausted ? "exhausted" : "failed",
			attempt: nextAttempt,
			responseStatus,
			errorSnippet,
			durationMs: Date.now() - startedAt,
			nextRetryAt: succeeded || exhausted ? null : new Date(Date.now() + backoffSeconds(attempt) * 1000),
		})
		.where(eq(webhookDeliveries.id, delivery.id));

	if (succeeded) {
		await db.update(webhooks).set({ consecutiveFailures: 0 }).where(eq(webhooks.id, target.id));
		return;
	}

	const failures = target.consecutiveFailures + 1;
	await db
		.update(webhooks)
		.set({
			consecutiveFailures: failures,
			// A permanently broken endpoint stops costing us queue capacity.
			enabled: failures < DISABLE_AFTER_FAILURES,
		})
		.where(eq(webhooks.id, target.id));

	if (exhausted) return;

	// Retries ride the outbound queue instead of needing a third binding.
	const retry: WebhookRetryMessage = { kind: "webhook-retry", deliveryId: delivery.id, attempt: nextAttempt };
	await env.OUTBOUND_QUEUE.send(retry, { delaySeconds: backoffSeconds(attempt) });
}

async function sign(secret: string, body: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
	return `sha256=${[...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

