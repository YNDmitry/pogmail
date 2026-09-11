CREATE TABLE `email_campaign_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`mailbox_id` text NOT NULL,
	`contact_ids` text NOT NULL DEFAULT '[]',
	`audience_id` text,
	`tag` text,
	`subject` text NOT NULL DEFAULT '',
	`body_text` text NOT NULL DEFAULT '',
	`body_html` text,
	`track_opens` integer NOT NULL DEFAULT false,
	`track_clicks` integer NOT NULL DEFAULT false,
	`scheduled_for` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `email_campaign_drafts_user_updated_idx` ON `email_campaign_drafts` (`user_id`,`updated_at`);
