CREATE TABLE `update_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`repository` text,
	`branch` text DEFAULT 'main' NOT NULL,
	`github_token` text,
	`last_dispatch_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
