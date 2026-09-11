import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { campaignLinkClicks, contacts, messages } from "@/db/schema";
import type { AppBindings } from "../middleware/context";
import { parseQuery } from "./_util";

const tokenQuery = z.object({ token: z.string().uuid() });
const unsubscribeInput = z.object({ token: z.string().uuid() });
const subscribeInput = z.object({ token: z.string().uuid() });
const preferenceInput = z.object({ token: z.string().uuid(), status: z.enum(["subscribed", "unsubscribed"]) });

const transparentGif = new Uint8Array([
	71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255,
	33, 249, 4, 1, 0, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59,
]);

/**
 * This is intentionally a tiny server-rendered page: recipients do not need an
 * account, and the token is an opaque capability rather than an email address.
 */
export const publicRoutes = new Hono<AppBindings>()
	.get("/subscribe", async (c) => {
		const { token } = await parseQuery(c, tokenQuery);
		const contact = await c.get("db").select({ marketingStatus: contacts.marketingStatus })
			.from(contacts).where(eq(contacts.confirmationToken, token)).get();
		if (!contact) return c.html(page("That confirmation link is no longer valid."), 404);
		if (contact.marketingStatus === "subscribed") return c.html(page("Your email subscription is already confirmed."));
		return c.html(page("Confirm that you want to receive marketing email.", token, "subscribe"));
	})
	.post("/subscribe", async (c) => {
		const parsed = subscribeInput.safeParse(await c.req.parseBody());
		if (!parsed.success) return c.html(page("That confirmation link is no longer valid."), 400);
		const updated = await c.get("db").update(contacts).set({
			marketingStatus: "subscribed", confirmedAt: new Date(), unsubscribedAt: null,
		}).where(eq(contacts.confirmationToken, parsed.data.token)).returning({ id: contacts.id }).get();
		return c.html(page(updated ? "Your subscription is confirmed. You can unsubscribe at any time." : "That confirmation link is no longer valid."), updated ? 200 : 404);
	})
	.get("/preferences", async (c) => {
		const { token } = await parseQuery(c, tokenQuery);
		const contact = await c.get("db").select({ marketingStatus: contacts.marketingStatus })
			.from(contacts).where(eq(contacts.unsubscribeToken, token)).get();
		if (!contact) return c.html(page("That preferences link is no longer valid."), 404);
		return c.html(preferencesPage(token, contact.marketingStatus));
	})
	.post("/preferences", async (c) => {
		const parsed = preferenceInput.safeParse(await c.req.parseBody());
		if (!parsed.success) return c.html(page("That preferences link is no longer valid."), 400);
		const unsubscribed = parsed.data.status === "unsubscribed";
		const updated = await c.get("db").update(contacts).set({
			marketingStatus: parsed.data.status,
			unsubscribedAt: unsubscribed ? new Date() : null,
			...(unsubscribed ? {} : { confirmedAt: new Date() }),
		}).where(eq(contacts.unsubscribeToken, parsed.data.token)).returning({ id: contacts.id }).get();
		return c.html(page(updated ? (unsubscribed ? "Your marketing subscription is paused." : "Your marketing subscription is active.") : "That preferences link is no longer valid."), updated ? 200 : 404);
	})
	.get("/click", async (c) => {
		const parsed = tokenQuery.safeParse(c.req.query());
		if (!parsed.success) return redirectHome(c.req.url);
		const click = await c.get("db").select({ id: campaignLinkClicks.id, destination: campaignLinkClicks.destination })
			.from(campaignLinkClicks).where(eq(campaignLinkClicks.token, parsed.data.token)).get();
		if (!click) return redirectHome(c.req.url);
		await c.get("db").update(campaignLinkClicks).set({ clickedAt: new Date() }).where(and(
			eq(campaignLinkClicks.id, click.id), isNull(campaignLinkClicks.clickedAt),
		));
		return new Response(null, { status: 302, headers: { "cache-control": "no-store, max-age=0", location: click.destination } });
	})
	.get("/open", async (c) => {
		const parsed = tokenQuery.safeParse(c.req.query());
		if (parsed.success) {
			await c.get("db").update(messages).set({ openedAt: new Date() }).where(and(
				eq(messages.openTrackingToken, parsed.data.token), isNull(messages.openedAt),
		));
		}
		return new Response(transparentGif, { headers: { "cache-control": "no-store, max-age=0", "content-type": "image/gif" } });
	})
	.get("/unsubscribe", async (c) => {
		const { token } = await parseQuery(c, tokenQuery);
		const contact = await c.get("db").select({ unsubscribedAt: contacts.unsubscribedAt })
			.from(contacts).where(eq(contacts.unsubscribeToken, token)).get();
		if (!contact) return c.html(page("That unsubscribe link is no longer valid."), 404);
		if (contact.unsubscribedAt) return c.html(page("You are already unsubscribed."));
		return c.html(page("Stop receiving marketing email?", token));
	})
	.post("/unsubscribe", async (c) => {
		const body = await c.req.parseBody();
		// RFC 8058 sends the opaque token in the URL and a fixed one-click body;
		// the browser form still submits the token in its body.
		const parsed = unsubscribeInput.safeParse({ token: body.token ?? c.req.query("token") });
		if (!parsed.success) return c.html(page("That unsubscribe link is no longer valid."), 400);
		const { token } = parsed.data;
		const updated = await c.get("db").update(contacts).set({ marketingStatus: "unsubscribed", unsubscribedAt: new Date() })
			.where(eq(contacts.unsubscribeToken, token)).returning({ id: contacts.id }).get();
		return c.html(page(updated ? "You have been unsubscribed." : "That unsubscribe link is no longer valid."), updated ? 200 : 404);
	});

function page(message: string, token?: string, actionName: "subscribe" | "unsubscribe" = "unsubscribe") {
	const action = token
		? `<form method="post" action="/api/public/${actionName}"><input type="hidden" name="token" value="${token}"><button>${actionName === "subscribe" ? "Confirm subscription" : "Unsubscribe"}</button></form>`
		: "";
	return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences</title><body style="font-family:system-ui,sans-serif;margin:3rem;max-width:34rem;color:#202020"><h1>Email preferences</h1><p>${message}</p>${action}</body></html>`;
}

function preferencesPage(token: string, status: "pending" | "subscribed" | "unsubscribed") {
	const checked = status === "unsubscribed" ? "unsubscribed" : "subscribed";
	return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences</title><body style="font-family:system-ui,sans-serif;margin:3rem;max-width:34rem;color:#202020"><h1>Email preferences</h1><p>Choose whether you would like to receive marketing email.</p><form method="post" action="/api/public/preferences"><input type="hidden" name="token" value="${token}"><p><label><input type="radio" name="status" value="subscribed"${checked === "subscribed" ? " checked" : ""}> Receive marketing email</label></p><p><label><input type="radio" name="status" value="unsubscribed"${checked === "unsubscribed" ? " checked" : ""}> Do not receive marketing email</label></p><button>Save preferences</button></form></body></html>`;
}

function redirectHome(requestUrl: string) {
	return new Response(null, { status: 302, headers: { "cache-control": "no-store, max-age=0", location: new URL("/", requestUrl).toString() } });
}
