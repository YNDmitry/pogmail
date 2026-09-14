CREATE TABLE `telegram_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`telegram_bot_token` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
