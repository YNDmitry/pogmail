import { Hono } from "hono";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { messages, MESSAGE_STATUSES, outboundJobs } from "@/db/schema";
import type { OutboundSendMessage } from "../../email/types";
import { canSendFrom, getPermission, resolveMailboxScope, listAccessibleMailboxes } from "../../mailboxes/access";
import { requireScope } from "../../middleware/auth";
import type { AppBindings } from "../../middleware/context";
import { forbidden, notFound, parseBody, parseQuery } from "../_util";
import { domains, mailboxes } from "@/db/schema";

/**
 * Stable public API for API-key clients. Kept deliberately narrow and versioned: the
 * dashboard's own routes change with the UI, these must not.
 */
const listQuery = z.object({
	mailbox: z.string().optional(),
	status: z.enum(MESSAGE_STATUSES).default("received"),
	cursor: z.coerce.number().int().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
});

const sendInput = z.object({
	from: z.string().min(1),
	to: z.array(z.email()).min(1).max(100),
	subject: z.string().max(300).default(""),
	text: z.string().max(500_000).default(""),
	html: z.string().max(1_000_000).nullable().optional(),
});

export const v1Routes = new Hono<AppBindings>()
	.get("/mailboxes", requireScope("mailboxes:read"), async (c) => {
		const items = await listAccessibleMailboxes(c.get("db"), c.get("user"));
		return c.json({ data: items.map(({ id, address, displayName }) => ({ id, address, displayName })) });
	})

	.get("/messages", requireScope("messages:read"), async (c) => {
		const query = await parseQuery(c, listQuery);
		const scope = await resolveMailboxScope(c.get("db"), c.get("user"), query.mailbox);
		if (scope.length === 0) return c.json({ data: [], next_cursor: null });

		const rows = await c
			.get("db")
			.select({
				id: messages.id,
				mailbox_id: messages.mailboxId,
				thread_id: messages.threadId,
				subject: messages.subject,
				from: messages.fromAddress,
				to: messages.toAddresses,
				snippet: messages.snippet,
				read: messages.read,
				received_at: messages.receivedAt,
			})
			.from(messages)
			.where(
				and(
					inArray(messages.mailboxId, scope),
					eq(messages.status, query.status),
					query.cursor ? lt(messages.receivedAt, new Date(query.cursor)) : undefined,
				),
			)
			.orderBy(desc(messages.receivedAt))
			.limit(query.limit)
			.all();

		const last = rows.at(-1);
		return c.json({
			data: rows.map((row) => ({ ...row, received_at: row.received_at.toISOString() })),
			next_cursor: rows.length === query.limit && last ? last.received_at.getTime() : null,
		});
	})

	.get("/messages/:id", requireScope("messages:read"), async (c) => {
		const message = await c.get("db").select().from(messages).where(eq(messages.id, c.req.param("id"))).get();
		if (!message) notFound("Message");

		const permission = await getPermission(c.get("db"), c.get("user"), message.mailboxId);
		if (!permission) notFound("Message");

		return c.json({
			data: {
				id: message.id,
				mailbox_id: message.mailboxId,
				thread_id: message.threadId,
				subject: message.subject,
				from: message.fromAddress,
				to: message.toAddresses,
				text: message.bodyText,
				html: message.bodyHtml,
				received_at: message.receivedAt.toISOString(),
			},
		});
	})

	.post("/send", requireScope("messages:send"), async (c) => {
		const input = await parseBody(c, sendInput);

		// `from` accepts either a mailbox id or the address itself, so a caller does
		// not have to look ids up first.
		const mailbox = await c
			.get("db")
			.select({
				id: mailboxes.id,
				localPart: mailboxes.localPart,
				displayName: mailboxes.displayName,
				hostname: domains.hostname,
			})
			.from(mailboxes)
			.innerJoin(domains, eq(domains.id, mailboxes.domainId))
			.where(eq(mailboxes.id, input.from))
			.get();

		const resolved =
			mailbox ??
			(await c
				.get("db")
				.select({
					id: mailboxes.id,
					localPart: mailboxes.localPart,
					displayName: mailboxes.displayName,
					hostname: domains.hostname,
				})
				.from(mailboxes)
				.innerJoin(domains, eq(domains.id, mailboxes.domainId))
				.where(
					and(
						eq(mailboxes.localPart, input.from.split("@")[0]?.toLowerCase() ?? ""),
						eq(domains.hostname, input.from.split("@")[1]?.toLowerCase() ?? ""),
					),
				)
				.get());

		if (!resolved) notFound("Mailbox");

		const permission = await getPermission(c.get("db"), c.get("user"), resolved.id);
		if (!canSendFrom(permission)) forbidden("This key cannot send from that mailbox");

		const address = `${resolved.localPart}@${resolved.hostname}`;

		const message = await c
			.get("db")
			.insert(messages)
			.values({
				mailboxId: resolved.id,
				authorUserId: c.get("user").id,
				direction: "outbound",
				status: "sent",
				threadId: crypto.randomUUID(),
				subject: input.subject || null,
				fromAddress: address,
				fromName: resolved.displayName,
				toAddresses: input.to.map((value) => ({ address: value })),
				bodyText: input.text || null,
				bodyHtml: input.html ?? null,
				snippet: input.text.replace(/\s+/g, " ").trim().slice(0, 200),
				read: true,
				receivedAt: new Date(),
			})
			.returning()
			.get();

		const job = await c
			.get("db")
			.insert(outboundJobs)
			.values({ messageId: message.id })
			.returning()
			.get();

		const payload: OutboundSendMessage = { kind: "outbound", jobId: job.id };
		await c.env.OUTBOUND_QUEUE.send(payload);

		return c.json({ data: { id: message.id, status: "queued" } }, 202);
	});
