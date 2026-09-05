-- Full-text search over messages. Written by hand because drizzle-kit cannot
-- express virtual tables; drizzle-kit will not touch it as long as no Drizzle
-- table declares these names.
--
-- External-content index: the FTS table stores only the index, and rowid points
-- back at messages.rowid, so bodies are not duplicated on disk.
CREATE VIRTUAL TABLE messages_fts USING fts5(
	subject,
	body_text,
	from_address,
	from_name,
	content = 'messages',
	content_rowid = 'rowid',
	tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
	INSERT INTO messages_fts(rowid, subject, body_text, from_address, from_name)
	VALUES (new.rowid, new.subject, new.body_text, new.from_address, new.from_name);
END;
--> statement-breakpoint
-- External-content tables need the 'delete' command with the OLD values before
-- re-inserting; a plain DELETE leaves the index inconsistent.
CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
	INSERT INTO messages_fts(messages_fts, rowid, subject, body_text, from_address, from_name)
	VALUES ('delete', old.rowid, old.subject, old.body_text, old.from_address, old.from_name);
END;
--> statement-breakpoint
CREATE TRIGGER messages_fts_update AFTER UPDATE ON messages BEGIN
	INSERT INTO messages_fts(messages_fts, rowid, subject, body_text, from_address, from_name)
	VALUES ('delete', old.rowid, old.subject, old.body_text, old.from_address, old.from_name);
	INSERT INTO messages_fts(rowid, subject, body_text, from_address, from_name)
	VALUES (new.rowid, new.subject, new.body_text, new.from_address, new.from_name);
END;
