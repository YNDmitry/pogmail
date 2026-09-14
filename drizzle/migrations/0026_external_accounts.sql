PRAGMA foreign_keys = OFF;--> statement-breakpoint
CREATE TABLE `mailboxes_new` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`domain_id` text,
	`local_part` text NOT NULL,
	`source` text DEFAULT 'cloudflare' NOT NULL,
	`external_address` text,
	`display_name` text,
	`signature` text,
	`signature_html` text,
	`avatar_key` text,
	`type` text DEFAULT 'personal' NOT NULL,
	`use_all_domains` integer DEFAULT false NOT NULL,
	`auto_reply_enabled` integer DEFAULT false NOT NULL,
	`auto_reply_subject` text DEFAULT 'Out of office' NOT NULL,
	`auto_reply_body` text DEFAULT '' NOT NULL,
	`auto_reply_html` text,
	`cloudflare_rule_id` text,
	`disabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `mailboxes_new` (
	`id`, `user_id`, `domain_id`, `local_part`, `display_name`, `signature`, `signature_html`, `avatar_key`, `type`, `use_all_domains`, `auto_reply_enabled`, `auto_reply_subject`, `auto_reply_body`, `auto_reply_html`, `cloudflare_rule_id`, `disabled`, `created_at`, `updated_at`
)
SELECT
	`id`, `user_id`, `domain_id`, `local_part`, `display_name`, `signature`, `signature_html`, `avatar_key`, `type`, `use_all_domains`, `auto_reply_enabled`, `auto_reply_subject`, `auto_reply_body`, `auto_reply_html`, `cloudflare_rule_id`, `disabled`, `created_at`, `updated_at`
FROM `mailboxes`;--> statement-breakpoint
DROP TABLE `mailboxes`;--> statement-breakpoint
ALTER TABLE `mailboxes_new` RENAME TO `mailboxes`;--> statement-breakpoint
CREATE UNIQUE INDEX `mailboxes_address_unq` ON `mailboxes` (`domain_id`,`local_part`);--> statement-breakpoint
CREATE UNIQUE INDEX `mailboxes_external_address_unq` ON `mailboxes` (`external_address`);--> statement-breakpoint
CREATE INDEX `mailboxes_user_idx` ON `mailboxes` (`user_id`);--> statement-breakpoint
CREATE INDEX `mailboxes_source_idx` ON `mailboxes` (`source`);--> statement-breakpoint
CREATE TABLE `external_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`user_id` text NOT NULL,
	`imap_host` text NOT NULL,
	`imap_port` integer NOT NULL,
	`imap_security` text NOT NULL,
	`imap_username` text NOT NULL,
	`imap_secret` text NOT NULL,
	`smtp_host` text NOT NULL,
	`smtp_port` integer NOT NULL,
	`smtp_security` text NOT NULL,
	`smtp_username` text NOT NULL,
	`smtp_secret` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_synced_at` integer,
	`last_error` text,
	`sync_lease_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `external_accounts_mailbox_unq` ON `external_accounts` (`mailbox_id`);--> statement-breakpoint
CREATE INDEX `external_accounts_status_idx` ON `external_accounts` (`status`,`last_synced_at`);--> statement-breakpoint
CREATE INDEX `external_accounts_user_idx` ON `external_accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `external_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`remote_name` text NOT NULL,
	`local_folder_id` text,
	`uid_validity` integer,
	`last_uid` integer DEFAULT 0 NOT NULL,
	`is_inbox` integer DEFAULT false NOT NULL,
	`is_sent` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `external_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`local_folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE UNIQUE INDEX `external_folders_account_name_unq` ON `external_folders` (`account_id`,`remote_name`);--> statement-breakpoint
CREATE INDEX `external_folders_account_idx` ON `external_folders` (`account_id`);--> statement-breakpoint
PRAGMA foreign_keys = ON;
