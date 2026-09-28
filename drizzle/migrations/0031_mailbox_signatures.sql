CREATE TABLE IF NOT EXISTS `mailbox_signatures` (
  `id` text PRIMARY KEY NOT NULL,
  `mailbox_id` text NOT NULL REFERENCES `mailboxes`(`id`) ON DELETE CASCADE,
  `name` text NOT NULL,
  `body_text` text NOT NULL DEFAULT '',
  `body_html` text NOT NULL DEFAULT '',
  `is_default` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `mailbox_signatures_name_unq` ON `mailbox_signatures` (`mailbox_id`, `name`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `mailbox_signatures_default_unq` ON `mailbox_signatures` (`mailbox_id`) WHERE `is_default` = 1;
--> statement-breakpoint
INSERT OR IGNORE INTO `mailbox_signatures` (`id`, `mailbox_id`, `name`, `body_text`, `body_html`, `is_default`, `created_at`, `updated_at`)
SELECT `id`, `id`, 'Signature', COALESCE(`signature`, ''), COALESCE(`signature_html`, ''), 1, CAST(strftime('%s','now') AS integer) * 1000, CAST(strftime('%s','now') AS integer) * 1000
FROM `mailboxes` WHERE COALESCE(`signature`, '') != '' OR COALESCE(`signature_html`, '') != '';
