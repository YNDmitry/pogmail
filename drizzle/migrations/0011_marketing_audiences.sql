ALTER TABLE `contacts` ADD `unsubscribed_at` integer;
--> statement-breakpoint
ALTER TABLE `contacts` ADD `unsubscribe_token` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_unsubscribe_token_unq` ON `contacts` (`unsubscribe_token`);
--> statement-breakpoint
CREATE TABLE `audiences` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audiences_user_name_unq` ON `audiences` (`user_id`,`name`);
--> statement-breakpoint
CREATE INDEX `audiences_user_created_idx` ON `audiences` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `audience_members` (
	`id` text PRIMARY KEY NOT NULL,
	`audience_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`audience_id`) REFERENCES `audiences`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audience_members_member_unq` ON `audience_members` (`audience_id`,`contact_id`);
--> statement-breakpoint
CREATE INDEX `audience_members_contact_idx` ON `audience_members` (`contact_id`);
