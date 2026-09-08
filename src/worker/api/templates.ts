import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { emailTemplates, messageAttachments, messages, templateAttachments } from "@/db/schema";
import { getPermission, hasAtLeast } from "../mailboxes/access";
import type { AppBindings } from "../middleware/context";
import { deleteObject, putUpload, serveObject } from "../storage";
import { forbidden, notFound, parseBody } from "./_util";

const MAX_TEMPLATE_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DRAFT_ATTACHMENT_BYTES = 15 * 1024 * 1024;

const templateInput = z.object({
	name: z.string().min(1).max(80),
	subject: z.string().max(300).default(""),
	bodyText: z.string().default(""),
	bodyHtml: z.string().nullable().optional(),
});
const insertInput = z.object({ draftId: z.string().min(1) });

export const templateRoutes = new Hono<AppBindings>()
	.get("/", async (c) => {
		const rows = await c.get("db").select().from(emailTemplates)
			.where(eq(emailTemplates.userId, c.get("user").id)).orderBy(desc(emailTemplates.updatedAt)).all();
		return c.json({ items: rows });
	})
	.post("/", async (c) => {
		const input = await parseBody(c, templateInput);
		const row = await c.get("db").insert(emailTemplates).values({ ...input, userId: c.get("user").id }).returning().get();
		return c.json(row, 201);
	})
	/** Stores a private image for a saved template and returns its editor URL. */
	.post("/:id/attachments", async (c) => {
		const template = await ownedTemplate(c, c.req.param("id"));
		const filename = decodeURIComponent(c.req.header("x-filename") ?? "").trim();
		if (!filename) throw new HTTPException(400, { message: "Missing x-filename" });
		const contentType = c.req.header("content-type")?.split(";")[0]?.trim() ?? "";
		if (!contentType.startsWith("image/")) throw new HTTPException(415, { message: "Template attachments must be images" });

		const r2Key = await putUpload(c.env, "template-attachments", c.req.raw, { accept: "any", maxBytes: MAX_TEMPLATE_IMAGE_BYTES });
		const object = await c.env.MAIL_BUCKET.head(r2Key);
		const row = await c.get("db").insert(templateAttachments).values({
			templateId: template.id,
			filename: filename.slice(0, 200),
			contentType,
			sizeBytes: object?.size ?? 0,
			contentId: crypto.randomUUID(),
			r2Key,
		}).returning().get();
		return c.json(templateAttachmentResponse(template.id, row), 201);
	})
	/** The editor needs an authenticated, private URL to render a template image. */
	.get("/:id/attachments/:attachmentId", async (c) => {
		const template = await ownedTemplate(c, c.req.param("id"));
		const attachment = await c.get("db").select().from(templateAttachments).where(and(
			eq(templateAttachments.id, c.req.param("attachmentId")),
			eq(templateAttachments.templateId, template.id),
		)).get();
		if (!attachment) notFound("Template attachment");
		return serveObject(c.env, attachment.r2Key);
	})
	/** Copies template images into a draft and returns URL-to-CID replacements. */
	.post("/:id/insert", async (c) => {
		const template = await ownedTemplate(c, c.req.param("id"));
		const { draftId } = await parseBody(c, insertInput);
		const draft = await editableDraft(c, draftId);
		const assets = await c.get("db").select().from(templateAttachments)
			.where(eq(templateAttachments.templateId, template.id)).all();
		const existing = await c.get("db").select({ sizeBytes: messageAttachments.sizeBytes }).from(messageAttachments)
			.where(eq(messageAttachments.messageId, draft.id)).all();
		const totalBytes = [...existing, ...assets].reduce((total, attachment) => total + attachment.sizeBytes, 0);
		if (totalBytes > MAX_DRAFT_ATTACHMENT_BYTES) {
			throw new HTTPException(413, { message: "Attachments may total 15 MB" });
		}
		const copies: Array<{ id: string; filename: string; contentType: string; sizeBytes: number; disposition: "inline"; contentId: string; from: string; to: string }> = [];

		for (const asset of assets) {
			const source = await c.env.MAIL_BUCKET.get(asset.r2Key);
			if (!source) throw new HTTPException(409, { message: "A template image is no longer available" });
			const r2Key = `attachments/${crypto.randomUUID()}`;
			await c.env.MAIL_BUCKET.put(r2Key, await source.arrayBuffer(), { httpMetadata: { contentType: asset.contentType } });
			const contentId = crypto.randomUUID();
			const row = await c.get("db").insert(messageAttachments).values({
				messageId: draft.id, filename: asset.filename, contentType: asset.contentType, sizeBytes: asset.sizeBytes,
				disposition: "inline", contentId, r2Key,
			}).returning().get();
			copies.push({ id: row.id, filename: row.filename, contentType: row.contentType, sizeBytes: row.sizeBytes,
				disposition: "inline", contentId, from: templateAttachmentUrl(template.id, asset.id), to: `cid:${contentId}` });
		}

		if (copies.length > 0) await c.get("db").update(messages).set({ hasAttachments: true }).where(eq(messages.id, draft.id));
		return c.json({ attachments: copies, replacements: copies.map(({ from, to }) => ({ from, to })) });
	})
	.patch("/:id", async (c) => {
		const input = await parseBody(c, templateInput.partial());
		const row = await c.get("db").update(emailTemplates).set(input)
			.where(and(eq(emailTemplates.id, c.req.param("id")), eq(emailTemplates.userId, c.get("user").id))).returning().get();
		if (!row) notFound("Template");
		if (input.bodyHtml !== undefined) await removeUnusedTemplateImages(c, row.id, input.bodyHtml);
		return c.json(row);
	})
	.delete("/:id", async (c) => {
		const template = await ownedTemplate(c, c.req.param("id"));
		const assets = await c.get("db").select({ r2Key: templateAttachments.r2Key }).from(templateAttachments)
			.where(eq(templateAttachments.templateId, template.id)).all();
		await c.get("db").delete(emailTemplates).where(eq(emailTemplates.id, template.id));
		await Promise.all(assets.map((asset) => deleteObject(c.env, asset.r2Key)));
		return c.json({ ok: true });
	});

async function ownedTemplate(c: Context<AppBindings>, id: string) {
	const template = await c.get("db").select().from(emailTemplates)
		.where(and(eq(emailTemplates.id, id), eq(emailTemplates.userId, c.get("user").id))).get();
	if (!template) notFound("Template");
	return template;
}

async function editableDraft(c: Context<AppBindings>, id: string) {
	const draft = await c.get("db").select().from(messages)
		.where(and(eq(messages.id, id), eq(messages.status, "draft"))).get();
	if (!draft) notFound("Draft");
	const permission = await getPermission(c.get("db"), c.get("user"), draft.mailboxId);
	if (!hasAtLeast(permission, "full_access")) forbidden("You cannot edit drafts in this mailbox");
	return draft;
}

function templateAttachmentUrl(templateId: string, attachmentId: string) {
	return `/api/templates/${encodeURIComponent(templateId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

function templateAttachmentResponse(templateId: string, attachment: typeof templateAttachments.$inferSelect) {
	return { id: attachment.id, filename: attachment.filename, contentType: attachment.contentType, sizeBytes: attachment.sizeBytes, url: templateAttachmentUrl(templateId, attachment.id) };
}

/** Delete private image blobs no longer referenced by a saved template document. */
async function removeUnusedTemplateImages(c: Context<AppBindings>, templateId: string, bodyHtml: string | null) {
	const assets = await c.get("db").select().from(templateAttachments)
		.where(eq(templateAttachments.templateId, templateId)).all();
	const unused = assets.filter((asset) => !(bodyHtml ?? "").includes(templateAttachmentUrl(templateId, asset.id)));
	if (unused.length === 0) return;
	await c.get("db").delete(templateAttachments).where(inArray(templateAttachments.id, unused.map(({ id }) => id)));
	await Promise.all(unused.map((asset) => deleteObject(c.env, asset.r2Key)));
}
