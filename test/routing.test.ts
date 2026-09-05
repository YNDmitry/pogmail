import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { domains, mailboxAliases, mailboxes, routingRules, users } from "@/db/schema";
import { resolveIncomingMail } from "@/worker/email/routing";

const db = () => getDb(env.DB);

async function seed() {
	const user = await db()
		.insert(users)
		.values({ email: "owner@example.test", name: "Owner", passwordHash: "x", role: "admin" })
		.returning()
		.get();

	const domain = await db()
		.insert(domains)
		.values({ hostname: "acme.test", zoneId: "zone", userId: user.id, status: "active" })
		.returning()
		.get();

	const mailbox = await db()
		.insert(mailboxes)
		.values({ domainId: domain.id, userId: user.id, localPart: "hello" })
		.returning()
		.get();

	return { user, domain, mailbox };
}

const mail = (to: string, from = "sender@other.test") => ({
	to,
	from,
	subject: "Hi",
	headers: new Headers(),
});

describe("resolveIncomingMail", () => {
	beforeEach(async () => {
		// Order matters: children before parents, since D1 enforces the FKs.
		await db().delete(routingRules);
		await db().delete(mailboxAliases);
		await db().delete(mailboxes);
		await db().delete(domains);
		await db().delete(users);
	});

	it("delivers to an exact mailbox", async () => {
		const { mailbox } = await seed();
		expect(await resolveIncomingMail(db(), mail("hello@acme.test"))).toEqual({
			action: "deliver",
			mailboxId: mailbox.id,
		});
	});

	it("delivers to an alias", async () => {
		const { domain, mailbox } = await seed();
		await db().insert(mailboxAliases).values({ mailboxId: mailbox.id, domainId: domain.id, localPart: "sales" });

		expect(await resolveIncomingMail(db(), mail("sales@acme.test"))).toEqual({
			action: "deliver",
			mailboxId: mailbox.id,
		});
	});

	it("does not let a catch-all shadow a real mailbox", async () => {
		const { domain, mailbox } = await seed();
		await db().insert(routingRules).values({
			scope: "domain",
			domainId: domain.id,
			name: "catch-all",
			conditions: [],
			action: "forward",
			actionTarget: "archive@elsewhere.test",
		});

		// The catch-all matches everything, but phase 2 runs first.
		expect(await resolveIncomingMail(db(), mail("hello@acme.test"))).toEqual({
			action: "deliver",
			mailboxId: mailbox.id,
		});

		expect(await resolveIncomingMail(db(), mail("nobody@acme.test"))).toEqual({
			action: "forward",
			to: "archive@elsewhere.test",
			mailboxId: null,
		});
	});

	it("rejects a blocked sender even for a valid recipient", async () => {
		const { domain } = await seed();
		await db().insert(routingRules).values({
			scope: "domain",
			domainId: domain.id,
			name: "block",
			conditions: [{ field: "from", operator: "ends_with", value: "@spam.test" }],
			action: "reject",
			rejectReason: "Blocked",
			priority: 100,
		});

		expect(await resolveIncomingMail(db(), mail("hello@acme.test", "bad@spam.test"))).toEqual({
			action: "reject",
			reason: "Blocked",
		});
	});

	it("drops mail for an unknown domain", async () => {
		await seed();
		expect(await resolveIncomingMail(db(), mail("hello@unknown.test"))).toEqual({ action: "drop" });
	});

	it("ignores mailbox-scope rules while resolving the address", async () => {
		const { domain, mailbox } = await seed();
		await db().insert(routingRules).values({
			scope: "mailbox",
			mailboxId: mailbox.id,
			domainId: domain.id,
			name: "spam folder",
			conditions: [],
			action: "reject",
			rejectReason: "should never fire here",
		});

		expect(await resolveIncomingMail(db(), mail("hello@acme.test"))).toEqual({
			action: "deliver",
			mailboxId: mailbox.id,
		});
	});
});
