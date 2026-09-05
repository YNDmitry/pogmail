import { integer, text } from "drizzle-orm/sqlite-core";
import { nanoid } from "nanoid";

/** Every table uses the same 21-char opaque id and epoch-ms timestamps. */
export const id = () =>
	text("id")
		.primaryKey()
		.$defaultFn(() => nanoid());

export const createdAt = () =>
	integer("created_at", { mode: "timestamp_ms" })
		.notNull()
		.$defaultFn(() => new Date());

export const updatedAt = () =>
	integer("updated_at", { mode: "timestamp_ms" })
		.notNull()
		.$defaultFn(() => new Date())
		.$onUpdate(() => new Date());

export const timestamps = () => ({ createdAt: createdAt(), updatedAt: updatedAt() });
