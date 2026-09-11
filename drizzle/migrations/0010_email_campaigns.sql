CREATE TABLE `email_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`mailbox_id` text NOT NULL,
	`subject` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`recipient_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `email_campaigns_user_created_idx` ON `email_campaigns` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `email_campaigns_mailbox_idx` ON `email_campaigns` (`mailbox_id`,`created_at`);
--> statement-breakpoint
ALTER TABLE `messages` ADD `campaign_id` text REFERENCES `email_campaigns`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX `messages_campaign_idx` ON `messages` (`campaign_id`,`received_at`);
