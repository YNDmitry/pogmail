import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { externalAccounts, externalFolders, mailboxes } from "@/db/schema";
import { encryptExternalAccountSecret, SecretKeyMissing } from "../auth/secrets";
import { audit } from "../audit";
import { ImapConnection } from "../import/imap";
import { getPermission, hasAtLeast } from "../mailboxes/access";
import { notifyMailbox } from "../realtime/notify";
import { SmtpConnection } from "../external/smtp";
import type { ExternalSyncMessage } from "../external/types";
import type { AppBindings } from "../middleware/context";
import { forbidden, notFound, parseBody } from "./_util";

const security = z.enum(["tls", "starttls"]);
const connection = z.object({
	host: z.string().trim().min(3).max(253),
	port: z.number().int(),
	security,
	username: z.string().trim().min(1).max(320),
	password: z.string().min(1).max(1_000),
});

const createInput = z.object({
	address: z.email().transform((value) => value.toLowerCase()),
	displayName: z.string().trim().max(120).nullable().optional(),
	imap: connection,
	smtp: connection,
}).superRefine((input, ctx) => {
	if (input.address.slice(0, input.address.indexOf("@")).length > 64) {
		ctx.addIssue({ code: "custom", path: ["address"], message: "The address local part may be at most 64 characters" });
	}
});

const updateInput = z.object({
	status: z.enum(["active", "paused"]).optional(),
});

export const externalAccountRoutes = new Hono<AppBindings>()
	.get("/", async (c) => {
		const items = await c
			.get("db")
			.select({
				id: externalAccounts.id,
				mailboxId: externalAccounts.mailboxId,
				address: mailboxes.externalAddress,
				displayName: mailboxes.displayName,
				imapHost: externalAccounts.imapHost,
				imapPort: externalAccounts.imapPort,
				smtpHost: externalAccounts.smtpHost,
				smtpPort: externalAccounts.smtpPort,
				status: externalAccounts.status,
				lastSyncedAt: externalAccounts.lastSyncedAt,
				lastError: externalAccounts.lastError,
			})
			.from(externalAccounts)
			.innerJoin(mailboxes, eq(mailboxes.id, externalAccounts.mailboxId))
			.where(eq(externalAccounts.userId, c.get("user").id))
			.orderBy(desc(externalAccounts.createdAt))
			.all();
		return c.json({ items });
	})

	.post("/", async (c) => {
		const input = await parseBody(c, createInput);
		if (!c.env.EXTERNAL_ACCOUNTS_ENCRYPTION_KEY) {
			throw new HTTPException(503, {
				message: "External accounts are not configured. Set EXTERNAL_ACCOUNTS_ENCRYPTION_KEY first.",
			});
		}

		// Validate both protocols before anything durable is created. A credentials
		// mistake must not leave a dead mailbox in navigation.
		const folders = await verifyConnections(input);
		const [imapSecret, smtpSecret] = await Promise.all([
			encryptExternalAccountSecret(c.env, input.imap.password),
			encryptExternalAccountSecret(c.env, input.smtp.password),
		]);

		const existing = await c.get("db").select().from(mailboxes)
			.where(eq(mailboxes.externalAddress, input.address)).get();
		if (existing && (existing.source !== "external" || existing.userId !== c.get("user").id || !existing.disabled)) {
			throw new HTTPException(409, { message: "That external address is already connected" });
		}

		const localPart = input.address.slice(0, input.address.indexOf("@"));
		const mailbox = existing
			? await c.get("db").update(mailboxes).set({ disabled: false, displayName: input.displayName ?? existing.displayName }).where(eq(mailboxes.id, existing.id)).returning().get()
			: await c.get("db").insert(mailboxes).values({
				userId: c.get("user").id,
				localPart,
				source: "external",
				externalAddress: input.address,
				displayName: input.displayName ?? null,
			}).returning().get();
		const account = await c.get("db").insert(externalAccounts).values({
			mailboxId: mailbox.id,
			userId: c.get("user").id,
			imapHost: input.imap.host,
			imapPort: input.imap.port,
			imapSecurity: input.imap.security,
			imapUsername: input.imap.username,
			imapSecret,
			smtpHost: input.smtp.host,
			smtpPort: input.smtp.port,
			smtpSecurity: input.smtp.security,
			smtpUsername: input.smtp.username,
			smtpSecret,
		}).returning().get();
		await c.get("db").insert(externalFolders).values({
			accountId: account.id,
			remoteName: folders.includes("INBOX") ? "INBOX" : folders[0] ?? "INBOX",
			isInbox: true,
		});

		audit(c, { action: "external_account.create", mailboxId: mailbox.id, metadata: { address: input.address, imapHost: input.imap.host, smtpHost: input.smtp.host } });
		await c.env.EXTERNAL_SYNC_QUEUE.send({ kind: "external-sync", accountId: account.id } satisfies ExternalSyncMessage);
		return c.json(publicAccount(account, mailbox), 201);
	})

	.patch("/:id", async (c) => {
		const input = await parseBody(c, updateInput);
		const account = await readableAccount(c, c.req.param("id"));
		const row = await c.get("db").update(externalAccounts).set({
			...input,
			...(input.status === "active" ? { lastError: null } : {}),
		}).where(eq(externalAccounts.id, account.id)).returning().get();
		if (row.status === "active") await c.env.EXTERNAL_SYNC_QUEUE.send({ kind: "external-sync", accountId: row.id } satisfies ExternalSyncMessage);
		audit(c, { action: "external_account.update", mailboxId: row.mailboxId, metadata: { status: row.status } });
		return c.json(publicAccount(row, account.mailbox));
	})

	.post("/:id/sync", async (c) => {
		const account = await readableAccount(c, c.req.param("id"));
		if (account.status !== "active") throw new HTTPException(409, { message: "Reconnect this account before syncing it" });
		await c.env.EXTERNAL_SYNC_QUEUE.send({ kind: "external-sync", accountId: account.id } satisfies ExternalSyncMessage);
		return c.json({ queued: true }, 202);
	})

	.delete("/:id", async (c) => {
		const account = await writableAccount(c, c.req.param("id"));
		await c.get("db").delete(externalAccounts).where(eq(externalAccounts.id, account.id));
		await c.get("db").update(mailboxes).set({ disabled: true }).where(eq(mailboxes.id, account.mailboxId));
		audit(c, { action: "external_account.disconnect", mailboxId: account.mailboxId });
		await notifyMailbox(c.env, account.mailboxId, { type: "message.changed", mailboxId: account.mailboxId });
		return c.json({ ok: true });
	});

async function verifyConnections(input: z.infer<typeof createInput>): Promise<string[]> {
	try {
		const imap = await ImapConnection.open(input.imap);
		let folders: string[];
		try {
			folders = await imap.listFolders();
		} finally {
			await imap.close();
		}
		const smtp = await SmtpConnection.open(input.smtp);
		await smtp.close();
		return folders;
	} catch (error) {
		if (error instanceof SecretKeyMissing) throw error;
		throw new HTTPException(502, { message: error instanceof Error ? error.message.slice(0, 500) : "Could not connect to mail server" });
	}
}

async function readableAccount(c: Context<AppBindings>, id: string) {
	const account = await c.get("db").select({ account: externalAccounts, mailbox: mailboxes })
		.from(externalAccounts).innerJoin(mailboxes, eq(mailboxes.id, externalAccounts.mailboxId))
		.where(eq(externalAccounts.id, id)).get();
	if (!account) notFound("External account");
	const permission = await getPermission(c.get("db"), c.get("user"), account.account.mailboxId);
	if (!hasAtLeast(permission, "read_only")) forbidden("You cannot read this external account");
	return { ...account.account, mailbox: account.mailbox };
}

async function writableAccount(c: Context<AppBindings>, id: string) {
	const account = await readableAccount(c, id);
	const permission = await getPermission(c.get("db"), c.get("user"), account.mailboxId);
	if (!hasAtLeast(permission, "full_access")) forbidden("You cannot manage this external account");
	return account;
}

function publicAccount(account: typeof externalAccounts.$inferSelect, mailbox: typeof mailboxes.$inferSelect) {
	return {
		id: account.id,
		mailboxId: account.mailboxId,
		address: mailbox.externalAddress,
		displayName: mailbox.displayName,
		imapHost: account.imapHost,
		imapPort: account.imapPort,
		smtpHost: account.smtpHost,
		smtpPort: account.smtpPort,
		status: account.status,
		lastSyncedAt: account.lastSyncedAt,
		lastError: account.lastError,
	};
}
