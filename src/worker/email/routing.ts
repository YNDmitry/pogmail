import { and, asc, desc, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { contacts, domains, mailboxAliases, mailboxes, routingRules, type RuleCondition } from "@/db/schema";

export type IncomingMail = {
	to: string;
	from: string;
	subject: string | null;
	headers: Headers;
};

export type RoutingDecision =
	| { action: "deliver"; mailboxId: string }
	| { action: "reject"; reason: string }
	| { action: "forward"; to: string; mailboxId: string | null }
	| { action: "drop" };

/**
 * Runs inside the Worker's `email` handler, before any parsing, because
 * `setReject` and `forward` exist nowhere else.
 *
 * Three phases, in this order — collapsing them is the bug that lets a `*` catch-all
 * swallow mail addressed to a real mailbox:
 *   1. `reject` rules, so a blocked sender is stopped even for a valid recipient.
 *   2. exact mailbox, then alias lookup.
 *   3. `forward` / `store` catch-alls as fallback.
 */
export async function resolveIncomingMail(db: Database, mail: IncomingMail): Promise<RoutingDecision> {
	const [localPart, domainName] = splitAddress(mail.to);
	if (!localPart || !domainName) return { action: "drop" };

	const domain = await db
		.select({ id: domains.id, status: domains.status })
		.from(domains)
		.where(eq(domains.hostname, domainName))
		.get();

	if (!domain || domain.status !== "active") return { action: "drop" };

	const rules = await db
		.select()
		.from(routingRules)
		.where(
			and(
				eq(routingRules.scope, "domain"),
				eq(routingRules.domainId, domain.id),
				eq(routingRules.enabled, true),
			),
		)
		.orderBy(desc(routingRules.priority), asc(routingRules.createdAt))
		.all();

	// Phase 1 — rejections win over everything.
	for (const rule of rules) {
		if (rule.action !== "reject") continue;
		if (matches(rule.conditions, rule.matchAll, mail)) {
			return { action: "reject", reason: rule.rejectReason ?? "Rejected by policy" };
		}
	}

	// Phase 2 — a real recipient beats any catch-all.
	const mailbox = await db
		.select({ id: mailboxes.id, disabled: mailboxes.disabled, userId: mailboxes.userId })
		.from(mailboxes)
		.where(and(eq(mailboxes.domainId, domain.id), eq(mailboxes.localPart, localPart)))
		.get();

	if (mailbox && !mailbox.disabled) {
		if (await senderIsBlocked(db, mailbox.userId, mail.from)) {
			return { action: "reject", reason: "The recipient is not accepting mail from this address" };
		}
		return { action: "deliver", mailboxId: mailbox.id };
	}

	const alias = await db
		.select({ mailboxId: mailboxAliases.mailboxId, userId: mailboxes.userId })
		.from(mailboxAliases)
		.innerJoin(mailboxes, eq(mailboxes.id, mailboxAliases.mailboxId))
		.where(and(eq(mailboxAliases.domainId, domain.id), eq(mailboxAliases.localPart, localPart)))
		.get();

	if (alias) {
		if (await senderIsBlocked(db, alias.userId, mail.from)) {
			return { action: "reject", reason: "The recipient is not accepting mail from this address" };
		}
		return { action: "deliver", mailboxId: alias.mailboxId };
	}

	// Phase 3 — catch-alls.
	for (const rule of rules) {
		if (rule.action !== "forward" && rule.action !== "store") continue;
		if (!matches(rule.conditions, rule.matchAll, mail)) continue;

		if (rule.action === "forward" && rule.actionTarget) {
			return { action: "forward", to: rule.actionTarget, mailboxId: null };
		}
		if (rule.action === "store" && rule.actionTarget) {
			return { action: "deliver", mailboxId: rule.actionTarget };
		}
	}

	return { action: "drop" };
}

/**
 * A blocked contact is rejected at SMTP time rather than filed into spam, so the
 * sender learns the mail did not land instead of silently disappearing.
 */
async function senderIsBlocked(db: Database, userId: string, from: string): Promise<boolean> {
	const row = await db
		.select({ id: contacts.id })
		.from(contacts)
		.where(and(eq(contacts.userId, userId), eq(contacts.email, from.toLowerCase()), eq(contacts.blocked, true)))
		.get();

	return Boolean(row);
}

export function splitAddress(address: string): [string | null, string | null] {
	const at = address.lastIndexOf("@");
	if (at <= 0) return [null, null];
	return [address.slice(0, at).toLowerCase(), address.slice(at + 1).toLowerCase()];
}

export function matches(conditions: RuleCondition[], matchAll: boolean, mail: IncomingMail): boolean {
	if (conditions.length === 0) return true;
	const results = conditions.map((condition) => matchOne(condition, mail));
	return matchAll ? results.every(Boolean) : results.some(Boolean);
}

function matchOne(condition: RuleCondition, mail: IncomingMail): boolean {
	const subject = mail.subject ?? "";
	const candidate =
		condition.field === "to"
			? mail.to
			: condition.field === "from"
				? mail.from
				: condition.field === "subject"
					? subject
					: (mail.headers.get(condition.header ?? "") ?? "");

	const haystack = candidate.toLowerCase();
	const needle = condition.value.toLowerCase();

	switch (condition.operator) {
		case "equals":
			return haystack === needle;
		case "contains":
			return haystack.includes(needle);
		case "starts_with":
			return haystack.startsWith(needle);
		case "ends_with":
			return haystack.endsWith(needle);
		case "regex":
			// A bad pattern is a user mistake, not a delivery failure — never match.
			try {
				return new RegExp(condition.value, "i").test(candidate);
			} catch {
				return false;
			}
	}
}
