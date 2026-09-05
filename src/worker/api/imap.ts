import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import PostalMime from "postal-mime";
import { z } from "zod";
import { messages } from "@/db/schema";
import { audit } from "../audit";
import { ImapConnection } from "../import/imap";
import { getPermission, hasAtLeast } from "../mailboxes/access";
import type { AppBindings } from "../middleware/context";
import { forbidden, parseBody } from "./_util";

const credentials = z.object({
	host: z.string().min(3).max(253),
	port: z.number().int().min(1).max(65535).default(993),
	username: z.string().min(1).max(320),
	password: z.string().min(1).max(500),
});

const importInput = credentials.extend({
	mailboxId: z.string().min(1),
	folder: z.string().min(1).max(200).default("INBOX"),
	/** A Worker has a wall-clock budget, so an import runs in bounded batches. */
	limit: z.number().int().min(1).max(200).default(100),
});

export const imapRoutes = new Hono<AppBindings>()
	/** Lists folders so the user picks one instead of guessing its exact name. */
	.post("/folders", async (c) => {
		const input = await parseBody(c, credentials);

		const connection = await open(input);
		try {
			return c.json({ folders: await connection.listFolders() });
		} finally {
			await connection.close();
		}
	})

	.post("/import", async (c) => {
		const input = await parseBody(c, importInput);

		const permission = await getPermission(c.get("db"), c.get("user"), input.mailboxId);
		if (!hasAtLeast(permission, "full_access")) forbidden("You cannot import into this mailbox");

		const connection = await open(input);
		let imported = 0;
		let skipped = 0;

		try {
			await connection.selectFolder(input.folder);
			const uids = await connection.searchAll();

			// Newest first: an interrupted import should have brought over the mail
			// the user is most likely to want.
			for (const uid of uids.toReversed().slice(0, input.limit)) {
				const raw = await connection.fetchMessage(uid);
				const parsed = await PostalMime.parse(raw.buffer as ArrayBuffer);

				const key = `raw/imported/${crypto.randomUUID()}.eml`;
				await c.env.MAIL_BUCKET.put(key, raw);

				const row = await c
					.get("db")
					.insert(messages)
					.values({
						mailboxId: input.mailboxId,
						direction: "inbound",
						status: "received",
						messageId: parsed.messageId ?? null,
						threadId: parsed.messageId ?? crypto.randomUUID(),
						inReplyTo: parsed.inReplyTo ?? null,
						subject: parsed.subject ?? null,
						fromAddress: (parsed.from?.address ?? "unknown@invalid").toLowerCase(),
						fromName: parsed.from?.name ?? null,
						toAddresses: (parsed.to ?? [])
							.filter((entry) => entry.address)
							.map((entry) => ({ address: entry.address as string })),
						bodyText: parsed.text ?? null,
						bodyHtml: parsed.html ?? null,
						snippet: (parsed.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
						rawKey: key,
						sizeBytes: raw.byteLength,
						hasAttachments: parsed.attachments.length > 0,
						read: true,
						receivedAt: parsed.date ? new Date(parsed.date) : new Date(),
					})
					// Running the import twice must not double the mailbox.
					.onConflictDoNothing({ target: [messages.mailboxId, messages.messageId] })
					.returning({ id: messages.id })
					.get();

				if (row) imported++;
				else {
					skipped++;
					// Nothing references the object once the row is skipped.
					await c.env.MAIL_BUCKET.delete(key);
				}
			}
		} finally {
			await connection.close();
		}

		audit(c, {
			action: "message.imap_import",
			mailboxId: input.mailboxId,
			metadata: { host: input.host, folder: input.folder, imported, skipped },
		});

		return c.json({ imported, skipped });
	});

async function open(input: z.infer<typeof credentials>): Promise<ImapConnection> {
	try {
		return await ImapConnection.open(input);
	} catch (error) {
		// The message may name the host but never the credentials.
		throw new HTTPException(502, {
			message: error instanceof Error ? error.message : "Could not reach the IMAP server",
		});
	}
}
