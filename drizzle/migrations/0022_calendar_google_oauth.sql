CREATE TABLE `calendar_oauth_states` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`user_id` text NOT NULL,
	`state` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `calendar_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_oauth_states_state_unq` ON `calendar_oauth_states` (`state`);--> statement-breakpoint
CREATE INDEX `calendar_oauth_states_expires_idx` ON `calendar_oauth_states` (`expires_at`);
