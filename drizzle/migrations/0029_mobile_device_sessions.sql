CREATE TABLE `mobile_device_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`refresh_token_hash` text NOT NULL,
	`device_name` text NOT NULL,
	`platform` text DEFAULT 'android' NOT NULL,
	`app_version` text,
	`ip` text,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `mobile_device_sessions_refresh_unq` ON `mobile_device_sessions` (`refresh_token_hash`);--> statement-breakpoint
CREATE INDEX `mobile_device_sessions_user_idx` ON `mobile_device_sessions` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `mobile_access_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`device_session_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`device_session_id`) REFERENCES `mobile_device_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `mobile_access_tokens_token_unq` ON `mobile_access_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `mobile_access_tokens_session_idx` ON `mobile_access_tokens` (`device_session_id`,`expires_at`);
