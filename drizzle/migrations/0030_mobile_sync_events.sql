CREATE TABLE `mobile_sync_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mailbox_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`operation` text NOT NULL,
	`created_at` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `mobile_sync_events_mailbox_sequence_idx` ON `mobile_sync_events` (`mailbox_id`,`sequence`);--> statement-breakpoint
INSERT INTO `mobile_sync_events` (`mailbox_id`, `resource_type`, `resource_id`, `operation`, `created_at`)
SELECT `id`, 'mailbox', `id`, 'upsert', unixepoch() * 1000 FROM `mailboxes`;--> statement-breakpoint
INSERT INTO `mobile_sync_events` (`mailbox_id`, `resource_type`, `resource_id`, `operation`, `created_at`)
SELECT `mailbox_id`, 'folder', `id`, 'upsert', unixepoch() * 1000 FROM `folders`;--> statement-breakpoint
INSERT INTO `mobile_sync_events` (`mailbox_id`, `resource_type`, `resource_id`, `operation`, `created_at`)
SELECT `mailbox_id`, 'message', `id`, 'upsert', unixepoch() * 1000 FROM `messages`;--> statement-breakpoint
CREATE TRIGGER `mobile_sync_mailboxes_insert` AFTER INSERT ON `mailboxes` BEGIN
	INSERT INTO `mobile_sync_events` (`mailbox_id`, `resource_type`, `resource_id`, `operation`, `created_at`)
	VALUES (NEW.`id`, 'mailbox', NEW.`id`, 'upsert', unixepoch() * 1000);
END;--> statement-breakpoint
CREATE TRIGGER `mobile_sync_mailboxes_update` AFTER UPDATE ON `mailboxes` BEGIN
	INSERT INTO `mobile_sync_events` (`mailbox_id`, `resource_type`, `resource_id`, `operation`, `created_at`)
	VALUES (NEW.`id`, 'mailbox', NEW.`id`, 'upsert', unixepoch() * 1000);
END;--> statement-breakpoint
CREATE TRIGGER `mobile_sync_mailboxes_delete` AFTER DELETE ON `mailboxes` BEGIN
	INSERT INTO `mobile_sync_events` (`mailbox_id`, `resource_type`, `resource_id`, `operation`, `created_at`)
	VALUES (OLD.`id`, 'mailbox', OLD.`id`, 'delete', unixepoch() * 1000);
END;--> statement-breakpoint
CREATE TRIGGER `mobile_sync_folders_insert` AFTER INSERT ON `folders` BEGIN
	INSERT INTO `mobile_sync_events` (`mailbox_id`, `resource_type`, `resource_id`, `operation`, `created_at`)
	VALUES (NEW.`mailbox_id`, 'folder', NEW.`id`, 'upsert', unixepoch() * 1000);
END;--> statement-breakpoint
CREATE TRIGGER `mobile_sync_folders_update` AFTER UPDATE ON `folders` BEGIN
	INSERT INTO `mobile_sync_events` (`mailbox_id`, `resource_type`, `resource_id`, `operation`, `created_at`)
	VALUES (NEW.`mailbox_id`, 'folder', NEW.`id`, 'upsert', unixepoch() * 1000);
END;--> statement-breakpoint
CREATE TRIGGER `mobile_sync_folders_delete` AFTER DELETE ON `folders` BEGIN
	INSERT INTO `mobile_sync_events` (`mailbox_id`, `resource_type`, `resource_id`, `operation`, `created_at`)
	VALUES (OLD.`mailbox_id`, 'folder', OLD.`id`, 'delete', unixepoch() * 1000);
END;--> statement-breakpoint
CREATE TRIGGER `mobile_sync_messages_insert` AFTER INSERT ON `messages` BEGIN
	INSERT INTO `mobile_sync_events` (`mailbox_id`, `resource_type`, `resource_id`, `operation`, `created_at`)
	VALUES (NEW.`mailbox_id`, 'message', NEW.`id`, 'upsert', unixepoch() * 1000);
END;--> statement-breakpoint
CREATE TRIGGER `mobile_sync_messages_update` AFTER UPDATE ON `messages` BEGIN
	INSERT INTO `mobile_sync_events` (`mailbox_id`, `resource_type`, `resource_id`, `operation`, `created_at`)
	VALUES (NEW.`mailbox_id`, 'message', NEW.`id`, 'upsert', unixepoch() * 1000);
END;--> statement-breakpoint
CREATE TRIGGER `mobile_sync_messages_delete` AFTER DELETE ON `messages` BEGIN
	INSERT INTO `mobile_sync_events` (`mailbox_id`, `resource_type`, `resource_id`, `operation`, `created_at`)
	VALUES (OLD.`mailbox_id`, 'message', OLD.`id`, 'delete', unixepoch() * 1000);
END;
