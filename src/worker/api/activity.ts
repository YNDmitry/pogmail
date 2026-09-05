import { Hono } from "hono";
import { and, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { auditLogs, users } from "@/db/schema";
import { requireAdmin } from "../middleware/auth";
import type { AppBindings } from "../middleware/context";
import { parseQuery } from "./_util";

const listQuery = z.object({
	action: z.string().max(80).optional(),
	actorUserId: z.string().optional(),
	/** Keyset cursor: `createdAt` epoch ms of the last row on the previous page. */
	cursor: z.coerce.number().int().optional(),
	limit: z.coerce.number().int().min(1).max(200).default(100),
});

/**
 * The audit trail. Admin-only: it names other users' actions, so it is not something
 * a regular account should be able to page through.
 */
export const activityRoutes = new Hono<AppBindings>()
	.use("*", requireAdmin)

	.get("/", async (c) => {
		const query = await parseQuery(c, listQuery);

		const rows = await c
			.get("db")
			.select({
				id: auditLogs.id,
				action: auditLogs.action,
				metadata: auditLogs.metadata,
				mailboxId: auditLogs.mailboxId,
				messageId: auditLogs.messageId,
				ip: auditLogs.ip,
				createdAt: auditLogs.createdAt,
				actorId: users.id,
				actorEmail: users.email,
				actorName: users.name,
			})
			.from(auditLogs)
			.leftJoin(users, eq(users.id, auditLogs.actorUserId))
			.where(
				and(
					query.action ? eq(auditLogs.action, query.action) : undefined,
					query.actorUserId ? eq(auditLogs.actorUserId, query.actorUserId) : undefined,
					query.cursor ? lt(auditLogs.createdAt, new Date(query.cursor)) : undefined,
				),
			)
			.orderBy(desc(auditLogs.createdAt))
			.limit(query.limit)
			.all();

		const last = rows.at(-1);
		return c.json({
			items: rows,
			nextCursor: rows.length === query.limit && last ? last.createdAt.getTime() : null,
		});
	});
