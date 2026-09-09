import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { domains, mailboxAccess, mailboxes, users } from "@/db/schema";
import { canSendFrom, getPermission, hasAtLeast, listAccessibleMailboxIds } from "@/worker/mailboxes/access";
import type { SessionUser } from "@/shared/contract/auth";

const db = () => getDb(env.DB);

const session = (row: { id: string; email: string; name: string; role: "admin" | "user" }): SessionUser => ({
	...row,
	avatarKey: null,
	mailLayout: "messages",
	telegramChatId: null,
	canManageMailboxes: false,
});

async function seed() {
	const [owner, sharer, stranger, admin] = await Promise.all(
		[
			{ email: "owner@test", name: "Owner", role: "user" as const },
			{ email: "sharer@test", name: "Sharer", role: "user" as const },
			{ email: "stranger@test", name: "Stranger", role: "user" as const },
			{ email: "admin@test", name: "Admin", role: "admin" as const },
		].map((row) => db().insert(users).values({ ...row, passwordHash: "x" }).returning().get()),
	);

	const domain = await db()
		.insert(domains)
		.values({ hostname: "acme.test", zoneId: "z", userId: owner!.id, status: "active" })
		.returning()
		.get();

	const mailbox = await db()
		.insert(mailboxes)
		.values({ domainId: domain.id, userId: owner!.id, localPart: "hello" })
		.returning()
		.get();

	await db()
		.insert(mailboxAccess)
		.values({ mailboxId: mailbox.id, userId: sharer!.id, permission: "read_only" });

	return { owner: owner!, sharer: sharer!, stranger: stranger!, admin: admin!, mailbox };
}

describe("mailbox access", () => {
	beforeEach(async () => {
		// Children before parents: D1 enforces the foreign keys.
		await db().delete(mailboxAccess);
		await db().delete(mailboxes);
		await db().delete(domains);
		await db().delete(users);
	});

	it("gives the owner full access", async () => {
		const { owner, mailbox } = await seed();
		expect(await getPermission(db(), session(owner), mailbox.id)).toBe("full_access");
	});

	it("gives a shared user only what the grant says", async () => {
		const { sharer, mailbox } = await seed();
		expect(await getPermission(db(), session(sharer), mailbox.id)).toBe("read_only");
	});

	it("gives an unrelated user nothing", async () => {
		const { stranger, mailbox } = await seed();
		expect(await getPermission(db(), session(stranger), mailbox.id)).toBeNull();
		expect(await listAccessibleMailboxIds(db(), session(stranger))).toEqual([]);
	});

	it("gives an admin access without an explicit grant", async () => {
		const { admin, mailbox } = await seed();
		expect(await getPermission(db(), session(admin), mailbox.id)).toBe("full_access");
		expect(await listAccessibleMailboxIds(db(), session(admin))).toContain(mailbox.id);
	});

	it("lists a shared mailbox exactly once", async () => {
		const { sharer, mailbox } = await seed();
		expect(await listAccessibleMailboxIds(db(), session(sharer))).toEqual([mailbox.id]);
	});

	it("does not let read-only access send mail", () => {
		expect(canSendFrom("read_only")).toBe(false);
		expect(canSendFrom("send_as")).toBe(true);
		expect(canSendFrom(null)).toBe(false);
	});

	it("ranks permissions rather than comparing them by name", () => {
		expect(hasAtLeast("send_as", "read_only")).toBe(true);
		expect(hasAtLeast("send_as", "full_access")).toBe(false);
		expect(hasAtLeast(null, "read_only")).toBe(false);
	});
});
