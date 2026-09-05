import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
	MATCH_FIELDS,
	MATCH_OPERATORS,
	RULE_ACTIONS,
	RULE_SCOPES,
	domains,
	routingRules,
} from "@/db/schema";
import { audit } from "../audit";
import { getPermission, hasAtLeast, listAccessibleMailboxIds } from "../mailboxes/access";
import type { AppBindings } from "../middleware/context";
import { forbidden, notFound, parseBody, parseQuery } from "./_util";

const condition = z.object({
	field: z.enum(MATCH_FIELDS),
	operator: z.enum(MATCH_OPERATORS),
	value: z.string().min(1).max(500),
	header: z.string().max(100).optional(),
});

const ruleInput = z
	.object({
		scope: z.enum(RULE_SCOPES),
		domainId: z.string().nullable().optional(),
		mailboxId: z.string().nullable().optional(),
		name: z.string().min(1).max(120),
		enabled: z.boolean().default(true),
		priority: z.number().int().min(-1000).max(1000).default(0),
		conditions: z.array(condition).max(20),
		matchAll: z.boolean().default(true),
		action: z.enum(RULE_ACTIONS),
		actionTarget: z.string().max(320).nullable().optional(),
		rejectReason: z.string().max(300).nullable().optional(),
		stopProcessing: z.boolean().default(false),
	})
	// The two scopes are different engines, so their actions do not overlap.
	.refine((rule) => (rule.scope === "domain" ? Boolean(rule.domainId) : Boolean(rule.mailboxId)), {
		message: "A domain rule needs domainId; a mailbox rule needs mailboxId",
		path: ["scope"],
	})
	.refine(
		(rule) =>
			rule.scope === "domain"
				? ["deliver", "reject", "forward", "store"].includes(rule.action)
				: ["move", "spam", "trash", "deliver"].includes(rule.action),
		{ message: "That action is not valid for this scope", path: ["action"] },
	)
	.refine((rule) => rule.action !== "forward" || Boolean(rule.actionTarget), {
		message: "A forward rule needs a destination address",
		path: ["actionTarget"],
	})
	.refine((rule) => rule.action !== "move" || Boolean(rule.actionTarget), {
		message: "A move rule needs a target folder",
		path: ["actionTarget"],
	});

const listQuery = z.object({
	scope: z.enum(RULE_SCOPES).optional(),
	domainId: z.string().optional(),
	mailboxId: z.string().optional(),
});

export const routingRuleRoutes = new Hono<AppBindings>()
	.get("/", async (c) => {
		const query = await parseQuery(c, listQuery);

		// Domain rules are instance-wide configuration; mailbox rules are per-mailbox
		// and must be filtered to what the caller can see.
		const accessible = await listAccessibleMailboxIds(c.get("db"), c.get("user"));

		const rows = await c
			.get("db")
			.select()
			.from(routingRules)
			.where(
				and(
					query.scope ? eq(routingRules.scope, query.scope) : undefined,
					query.domainId ? eq(routingRules.domainId, query.domainId) : undefined,
					query.mailboxId ? eq(routingRules.mailboxId, query.mailboxId) : undefined,
				),
			)
			.orderBy(desc(routingRules.priority), asc(routingRules.createdAt))
			.all();

		const visible = rows.filter(
			(rule) =>
				rule.scope === "domain" ||
				(rule.mailboxId !== null && accessible.includes(rule.mailboxId)),
		);

		return c.json({ items: visible });
	})

	.post("/", async (c) => {
		const input = await parseBody(c, ruleInput);
		await assertScopeAccess(c, input);

		const row = await c
			.get("db")
			.insert(routingRules)
			.values({
				...input,
				domainId: input.domainId ?? null,
				mailboxId: input.mailboxId ?? null,
				actionTarget: input.actionTarget ?? null,
				rejectReason: input.rejectReason ?? null,
			})
			.returning()
			.get();

		audit(c, { action: "routing_rule.create", metadata: { scope: row.scope, name: row.name } });
		return c.json(row, 201);
	})

	.patch("/:id", async (c) => {
		const existing = await c
			.get("db")
			.select()
			.from(routingRules)
			.where(eq(routingRules.id, c.req.param("id")))
			.get();
		if (!existing) notFound("Rule");

		await assertScopeAccess(c, existing);
		const input = await parseBody(c, ruleInput.partial());

		const row = await c
			.get("db")
			.update(routingRules)
			.set(input)
			.where(eq(routingRules.id, existing.id))
			.returning()
			.get();

		audit(c, { action: "routing_rule.update", metadata: { id: row.id } });
		return c.json(row);
	})

	.delete("/:id", async (c) => {
		const existing = await c
			.get("db")
			.select()
			.from(routingRules)
			.where(eq(routingRules.id, c.req.param("id")))
			.get();
		if (!existing) notFound("Rule");

		await assertScopeAccess(c, existing);
		await c.get("db").delete(routingRules).where(eq(routingRules.id, existing.id));

		audit(c, { action: "routing_rule.delete", metadata: { id: existing.id } });
		return c.json({ ok: true });
	})

	/** Reorders a whole scope in one request, so drag-and-drop is a single call. */
	.put("/order", async (c) => {
		const input = await parseBody(
			c,
			z.object({ ids: z.array(z.string().min(1)).min(1).max(200) }),
		);

		const rules = await c
			.get("db")
			.select()
			.from(routingRules)
			.where(inArray(routingRules.id, input.ids))
			.all();

		for (const rule of rules) await assertScopeAccess(c, rule);

		// Descending priority: first id in the list runs first.
		await Promise.all(
			input.ids.map((id, index) =>
				c
					.get("db")
					.update(routingRules)
					.set({ priority: input.ids.length - index })
					.where(eq(routingRules.id, id)),
			),
		);

		return c.json({ ok: true });
	});

/** Domain rules are admin-level; mailbox rules follow mailbox permissions. */
async function assertScopeAccess(
	c: Context<AppBindings>,
	rule: { scope: "domain" | "mailbox"; domainId?: string | null; mailboxId?: string | null },
): Promise<void> {
	if (rule.scope === "domain") {
		const user = c.get("user");
		if (user.role !== "admin" && !user.canManageMailboxes) {
			forbidden("Domain rules require mailbox management rights");
		}
		if (rule.domainId) {
			const domain = await c.get("db").select({ id: domains.id }).from(domains).where(eq(domains.id, rule.domainId)).get();
			if (!domain) notFound("Domain");
		}
		return;
	}

	if (!rule.mailboxId) throw new HTTPException(400, { message: "mailboxId is required" });
	const permission = await getPermission(c.get("db"), c.get("user"), rule.mailboxId);
	if (!hasAtLeast(permission, "full_access")) forbidden("You do not have full access to this mailbox");
}
