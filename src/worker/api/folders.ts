import { Hono, type Context } from "hono";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { folders } from "@/db/schema";
import { getPermission, hasAtLeast, listAccessibleMailboxIds } from "../mailboxes/access";
import type { AppBindings } from "../middleware/context";
import { forbidden, notFound, parseBody } from "./_util";

const createInput = z.object({
	mailboxId: z.string().min(1),
	name: z.string().min(1).max(60),
	color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
	position: z.number().int().min(0).optional(),
});

const updateInput = createInput.partial().omit({ mailboxId: true });

export const folderRoutes = new Hono<AppBindings>()
	.get("/", async (c) => {
		const ids = await listAccessibleMailboxIds(c.get("db"), c.get("user"));
		if (ids.length === 0) return c.json({ items: [] });

		const rows = await c
			.get("db")
			.select()
			.from(folders)
			.where(inArray(folders.mailboxId, ids))
			.orderBy(asc(folders.position), asc(folders.name))
			.all();

		return c.json({ items: rows });
	})

	.post("/", async (c) => {
		const input = await parseBody(c, createInput);

		const permission = await getPermission(c.get("db"), c.get("user"), input.mailboxId);
		if (!hasAtLeast(permission, "full_access")) forbidden("Cannot create folders in this mailbox");

		const last = input.position === undefined
			? await c
					.get("db")
					.select({ position: folders.position })
					.from(folders)
					.where(eq(folders.mailboxId, input.mailboxId))
					.orderBy(desc(folders.position))
					.limit(1)
					.get()
			: null;
		const row = await c
			.get("db")
			.insert(folders)
			.values({ ...input, position: input.position ?? (last?.position ?? -1) + 1 })
			.returning()
			.get();
		return c.json(row, 201);
	})

	.patch("/:id", async (c) => {
		const input = await parseBody(c, updateInput);
		const folder = await requireFolderAccess(c, c.req.param("id"));

		const row = await c
			.get("db")
			.update(folders)
			.set(input)
			.where(eq(folders.id, folder.id))
			.returning()
			.get();

		return c.json(row);
	})

	.delete("/:id", async (c) => {
		const folder = await requireFolderAccess(c, c.req.param("id"));
		// Messages survive: `messages.folderId` is ON DELETE SET NULL, so they fall
		// back to whatever status folder they were already in.
		await c.get("db").delete(folders).where(eq(folders.id, folder.id));
		return c.json({ ok: true });
	});

async function requireFolderAccess(
	c: Context<AppBindings>,
	id: string,
): Promise<{ id: string; mailboxId: string }> {
	const folder = await c
		.get("db")
		.select({ id: folders.id, mailboxId: folders.mailboxId })
		.from(folders)
		.where(eq(folders.id, id))
		.get();

	if (!folder) notFound("Folder");

	const permission = await getPermission(c.get("db"), c.get("user"), folder.mailboxId);
	if (!hasAtLeast(permission, "full_access")) forbidden("Cannot modify folders in this mailbox");

	return folder;
}
