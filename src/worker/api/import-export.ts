import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { messages, MESSAGE_STATUSES } from "@/db/schema";
import { audit } from "../audit";
import { getPermission, hasAtLeast, resolveMailboxScope } from "../mailboxes/access";
import type { AppBindings } from "../middleware/context";
import { forbidden, parseBody, parseQuery } from "./_util";

const exportQuery = z.object({
	mailboxId: z.string().optional(),
	status: z.enum(MESSAGE_STATUSES).optional(),
	format: z.enum(["ndjson", "mbox"]).default("ndjson"),
	before: z.coerce.number().int().optional(),
	limit: z.coerce.number().int().min(1).max(5000).default(1000),
});

const importInput = z.object({
	mailboxId: z.string().min(1),
	/** Each entry is one RFC 5322 message; the client splits an mbox before upload. */
	messages: z
		.array(
			z.object({
				subject: z.string().max(300).nullable().optional(),
				from: z.email(),
				to: z.array(z.email()).default([]),
				bodyText: z.string().max(500_000).nullable().optional(),
				bodyHtml: z.string().max(1_000_000).nullable().optional(),
				receivedAt: z.number().int(),
				messageId: z.string().max(300).nullable().optional(),
				status: z.enum(MESSAGE_STATUSES).default("received"),
			}),
		)
		.min(1)
		.max(500),
});

export const importExportRoutes = new Hono<AppBindings>()
	/**
	 * Streams messages out. NDJSON is the honest format for a JSON body store; mbox is
	 * offered because that is what other mail clients actually import.
	 */
	.get("/export", async (c) => {
		const query = await parseQuery(c, exportQuery);
		const scope = await resolveMailboxScope(c.get("db"), c.get("user"), query.mailboxId);
		if (scope.length === 0) forbidden("No accessible mailboxes to export");

		const rows = await c
			.get("db")
			.select()
			.from(messages)
			.where(
				and(
					inArray(messages.mailboxId, scope),
					query.status ? eq(messages.status, query.status) : undefined,
					query.before ? lt(messages.receivedAt, new Date(query.before)) : undefined,
				),
			)
			.orderBy(desc(messages.receivedAt))
			.limit(query.limit)
			.all();

		audit(c, { action: "message.export", metadata: { count: rows.length, format: query.format } });

		if (query.format === "mbox") {
			return new Response(rows.map(toMbox).join("\n"), {
				headers: {
					"content-type": "application/mbox",
					"content-disposition": 'attachment; filename="pogmail-export.mbox"',
				},
			});
		}

		return new Response(rows.map((row) => JSON.stringify(row)).join("\n"), {
			headers: {
				"content-type": "application/x-ndjson",
				"content-disposition": 'attachment; filename="pogmail-export.ndjson"',
			},
		});
	})

	.get("/export/:messageId/eml", async (c) => {
		const message = await c
			.get("db")
			.select()
			.from(messages)
			.where(eq(messages.id, c.req.param("messageId")))
			.get();

		if (!message) throw new HTTPException(404, { message: "Message not found" });

		const permission = await getPermission(c.get("db"), c.get("user"), message.mailboxId);
		if (!hasAtLeast(permission, "read_only")) throw new HTTPException(404, { message: "Message not found" });

		// Prefer the stored original; fall back to a reconstruction for sent mail,
		// which never had a raw MIME source of its own.
		if (message.rawKey) {
			const object = await c.env.MAIL_BUCKET.get(message.rawKey);
			if (object) {
				return new Response(object.body, {
					headers: {
						"content-type": "message/rfc822",
						"content-disposition": `attachment; filename="${message.id}.eml"`,
					},
				});
			}
		}

		return new Response(toMbox(message), {
			headers: {
				"content-type": "message/rfc822",
				"content-disposition": `attachment; filename="${message.id}.eml"`,
			},
		});
	})

	.post("/import", async (c) => {
		const input = await parseBody(c, importInput);

		const permission = await getPermission(c.get("db"), c.get("user"), input.mailboxId);
		if (!hasAtLeast(permission, "full_access")) forbidden("You cannot import into this mailbox");

		let imported = 0;
		for (const entry of input.messages) {
			const row = await c
				.get("db")
				.insert(messages)
				.values({
					mailboxId: input.mailboxId,
					direction: entry.status === "sent" ? "outbound" : "inbound",
					status: entry.status,
					messageId: entry.messageId ?? null,
					threadId: entry.messageId ?? crypto.randomUUID(),
					subject: entry.subject ?? null,
					fromAddress: entry.from.toLowerCase(),
					toAddresses: entry.to.map((value) => ({ address: value })),
					bodyText: entry.bodyText ?? null,
					bodyHtml: entry.bodyHtml ?? null,
					snippet: (entry.bodyText ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
					read: true,
					receivedAt: new Date(entry.receivedAt),
				})
				// Re-importing the same archive twice must not double every message.
				.onConflictDoNothing({ target: [messages.mailboxId, messages.messageId] })
				.returning({ id: messages.id })
				.get();

			if (row) imported++;
		}

		audit(c, {
			action: "message.import",
			mailboxId: input.mailboxId,
			metadata: { submitted: input.messages.length, imported },
		});

		return c.json({ submitted: input.messages.length, imported });
	});

/** Minimal but valid mbox entry: `From ` separator plus headers and body. */
function toMbox(message: typeof messages.$inferSelect): string {
	const date = message.receivedAt.toUTCString();
	const to = message.toAddresses.map((entry) => entry.address).join(", ");

	return [
		`From ${message.fromAddress} ${date}`,
		`Date: ${date}`,
		`From: ${message.fromName ? `${message.fromName} <${message.fromAddress}>` : message.fromAddress}`,
		`To: ${to}`,
		`Subject: ${message.subject ?? ""}`,
		message.messageId ? `Message-ID: ${message.messageId}` : null,
		"Content-Type: text/plain; charset=utf-8",
		"",
		// Any body line starting with "From " would otherwise look like a separator.
		(message.bodyText ?? "").replaceAll(/^From /gm, ">From "),
		"",
	]
		.filter((line) => line !== null)
		.join("\n");
}
