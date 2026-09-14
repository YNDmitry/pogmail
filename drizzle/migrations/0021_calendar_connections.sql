CREATE TABLE `calendar_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`name` text NOT NULL,
	`calendar_url` text NOT NULL,
	`username` text,
	`secret` text,
	`last_synced_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `calendar_connections_user_idx` ON `calendar_connections` (`user_id`,`provider`);--> statement-breakpoint
CREATE TABLE `calendar_event_links` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`event_id` text NOT NULL,
	`href` text NOT NULL,
	`etag` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `calendar_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `calendar_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_event_links_connection_event_unq` ON `calendar_event_links` (`connection_id`,`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_event_links_connection_href_unq` ON `calendar_event_links` (`connection_id`,`href`);
