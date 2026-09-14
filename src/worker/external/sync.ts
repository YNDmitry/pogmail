import { and, eq, isNull, lt, or } from "drizzle-orm";
import { getDb } from "@/db";
import { externalAccounts, externalFolders, mailboxes } from "@/db/schema";
import { decryptExternalAccountSecret } from "../auth/secrets";
import { processInboundMessage } from "../email/inbound";
import { ImapConnection } from "../import/imap";
import { notifyMailbox } from "../realtime/notify";
import type { ExternalSyncMessage } from "./types";

const LEASE_MS = 10 * 60 * 1000;
const INITIAL_BATCH = 100;

/**
 * Imports a bounded UID range. Queues may redeliver this job; the D1 lease and the
 * existing `(mailbox_id, message_id)` guard make that a harmless retry.
 */
export async function syncExternalAccount(env: Env, job: ExternalSyncMessage): Promise<void> {
	const db = getDb(env.DB);
	const now = new Date();
	const lease = new Date(now.getTime() + LEASE_MS);
	const claimed = await db
		.update(externalAccounts)
		.set({ syncLeaseUntil: lease })
		.where(
			and(
				eq(externalAccounts.id, job.accountId),
				eq(externalAccounts.status, "active"),
				or(isNull(externalAccounts.syncLeaseUntil), lt(externalAccounts.syncLeaseUntil, now)),
			),
		)
		.returning()
		.get();
	if (!claimed) return;

	try {
		const password = await decryptExternalAccountSecret(env, claimed.imapSecret);
		if (!password) {
			await markFailure(db, claimed.id, "Stored IMAP credentials can no longer be decrypted", "needs_auth");
			return;
		}

		const mailbox = await db
			.select({ address: mailboxes.externalAddress })
			.from(mailboxes)
			.where(eq(mailboxes.id, claimed.mailboxId))
			.get();
		if (!mailbox?.address) throw new Error("External account mailbox is missing its address");

		const folder = await db
			.select()
			.from(externalFolders)
			.where(and(eq(externalFolders.accountId, claimed.id), eq(externalFolders.isInbox, true)))
			.get();
		if (!folder) throw new Error("External account has no inbox folder");

		const connection = await ImapConnection.open({
			host: claimed.imapHost,
			port: claimed.imapPort,
			security: claimed.imapSecurity,
			username: claimed.imapUsername,
			password,
		});
		let imported = 0;
		try {
			await connection.selectFolder(folder.remoteName);
			const uids = (await connection.searchAll())
				.map(Number)
				.filter((uid) => Number.isSafeInteger(uid) && uid > folder.lastUid)
				.slice(-INITIAL_BATCH);
			for (const uid of uids) {
				const raw = await connection.fetchMessage(String(uid));
				const rawKey = `raw/external/${claimed.id}/${crypto.randomUUID()}.eml`;
				await env.MAIL_BUCKET.put(rawKey, raw);
				const messageId = await processInboundMessage(env, {
					kind: "inbound",
					source: "external",
					externalFolderId: folder.id,
					externalUid: uid,
					mailboxId: claimed.mailboxId,
					rawKey,
					to: mailbox.address.toLowerCase(),
					from: "unknown@invalid",
					sizeBytes: raw.byteLength,
					receivedAt: Date.now(),
				});
				if (messageId) imported++;
				else await env.MAIL_BUCKET.delete(rawKey);
			}
			if (uids.length > 0) {
				await db.update(externalFolders).set({ lastUid: uids.at(-1)! }).where(eq(externalFolders.id, folder.id));
			}
		} finally {
			await connection.close();
		}

		await db
			.update(externalAccounts)
			.set({ lastSyncedAt: new Date(), lastError: null, syncLeaseUntil: null })
			.where(eq(externalAccounts.id, claimed.id));
		if (imported > 0) await notifyMailbox(env, claimed.mailboxId, { type: "message.changed", mailboxId: claimed.mailboxId });
		console.log(JSON.stringify({ message: "External mailbox synced", accountId: claimed.id, imported }));
	} catch (error) {
		const detail = error instanceof Error ? error.message : "External IMAP sync failed";
		const status = /login|authenticat|credential/i.test(detail) ? "needs_auth" : "error";
		await markFailure(db, claimed.id, detail, status);
		console.error(JSON.stringify({ message: "External mailbox sync failed", accountId: claimed.id, error: detail }));
		throw error;
	}
}

async function markFailure(
	db: ReturnType<typeof getDb>,
	accountId: string,
	error: string,
	status: "needs_auth" | "error",
) {
	await db
		.update(externalAccounts)
		.set({ status, lastError: error.slice(0, 500), syncLeaseUntil: null })
		.where(eq(externalAccounts.id, accountId));
}
