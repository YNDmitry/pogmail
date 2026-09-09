import type { Context } from "hono";
import { auditLogs } from "@/db/schema";
import type { AppBindings } from "./middleware/context";

export type AuditEntry = {
	action: string;
	targetUserId?: string | null;
	mailboxId?: string | null;
	messageId?: string | null;
	metadata?: Record<string, unknown>;
};

/**
 * Writes an audit row without blocking the response. An audit failure must never turn
 * a successful action into an error, so this swallows its own errors deliberately.
 */
export function audit(c: Context<AppBindings>, entry: AuditEntry): void {
	const user = c.get("user");
	const write = c
		.get("db")
		.insert(auditLogs)
		.values({
			actorUserId: user?.id ?? null,
			targetUserId: entry.targetUserId ?? null,
			mailboxId: entry.mailboxId ?? null,
			messageId: entry.messageId ?? null,
			action: entry.action,
			metadata: entry.metadata ?? null,
			ip: c.req.header("cf-connecting-ip") ?? null,
		})
		.catch((error: unknown) => console.error("audit write failed", entry.action, error));

	try {
		c.executionCtx.waitUntil(write);
	} catch {
		// Hono unit calls may omit an ExecutionContext; production fetches always have one.
		void write;
	}
}
