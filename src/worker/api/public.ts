import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { contacts } from "@/db/schema";
import type { AppBindings } from "../middleware/context";
import { parseQuery } from "./_util";

const tokenQuery = z.object({ token: z.string().uuid() });
const unsubscribeInput = z.object({ token: z.string().uuid() });

/**
 * This is intentionally a tiny server-rendered page: recipients do not need an
 * account, and the token is an opaque capability rather than an email address.
 */
export const publicRoutes = new Hono<AppBindings>()
	.get("/unsubscribe", async (c) => {
		const { token } = await parseQuery(c, tokenQuery);
		const contact = await c.get("db").select({ unsubscribedAt: contacts.unsubscribedAt })
			.from(contacts).where(eq(contacts.unsubscribeToken, token)).get();
		if (!contact) return c.html(page("That unsubscribe link is no longer valid."), 404);
		if (contact.unsubscribedAt) return c.html(page("You are already unsubscribed."));
		return c.html(page("Stop receiving marketing email?", token));
	})
	.post("/unsubscribe", async (c) => {
		const parsed = unsubscribeInput.safeParse(await c.req.parseBody());
		if (!parsed.success) return c.html(page("That unsubscribe link is no longer valid."), 400);
		const { token } = parsed.data;
		const updated = await c.get("db").update(contacts).set({ unsubscribedAt: new Date() })
			.where(eq(contacts.unsubscribeToken, token)).returning({ id: contacts.id }).get();
		return c.html(page(updated ? "You have been unsubscribed." : "That unsubscribe link is no longer valid."), updated ? 200 : 404);
	});

function page(message: string, token?: string) {
	const action = token
		? `<form method="post" action="/api/public/unsubscribe"><input type="hidden" name="token" value="${token}"><button>Unsubscribe</button></form>`
		: "";
	return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences</title><body style="font-family:system-ui,sans-serif;margin:3rem;max-width:34rem;color:#202020"><h1>Email preferences</h1><p>${message}</p>${action}</body></html>`;
}
