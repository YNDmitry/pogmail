import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { emailTemplates } from "@/db/schema";
import type { AppBindings } from "../middleware/context";
import { notFound, parseBody } from "./_util";

const templateInput = z.object({
	name: z.string().min(1).max(80),
	subject: z.string().max(300).default(""),
	bodyText: z.string().default(""),
	bodyHtml: z.string().nullable().optional(),
});

export const templateRoutes = new Hono<AppBindings>()
	.get("/", async (c) => {
		const rows = await c
			.get("db")
			.select()
			.from(emailTemplates)
			.where(eq(emailTemplates.userId, c.get("user").id))
			.orderBy(desc(emailTemplates.updatedAt))
			.all();

		return c.json({ items: rows });
	})

	.post("/", async (c) => {
		const input = await parseBody(c, templateInput);
		const row = await c
			.get("db")
			.insert(emailTemplates)
			.values({ ...input, userId: c.get("user").id })
			.returning()
			.get();

		return c.json(row, 201);
	})

	.patch("/:id", async (c) => {
		const input = await parseBody(c, templateInput.partial());
		const row = await c
			.get("db")
			.update(emailTemplates)
			.set(input)
			.where(and(eq(emailTemplates.id, c.req.param("id")), eq(emailTemplates.userId, c.get("user").id)))
			.returning()
			.get();

		if (!row) notFound("Template");
		return c.json(row);
	})

	.delete("/:id", async (c) => {
		const row = await c
			.get("db")
			.delete(emailTemplates)
			.where(and(eq(emailTemplates.id, c.req.param("id")), eq(emailTemplates.userId, c.get("user").id)))
			.returning({ id: emailTemplates.id })
			.get();

		if (!row) notFound("Template");
		return c.json({ ok: true });
	});
