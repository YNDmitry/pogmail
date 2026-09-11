ALTER TABLE `messages` ADD `open_tracking_token` text;
--> statement-breakpoint
ALTER TABLE `messages` ADD `opened_at` integer;
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_open_tracking_token_unq` ON `messages` (`open_tracking_token`);
--> statement-breakpoint
CREATE INDEX `messages_campaign_opened_idx` ON `messages` (`campaign_id`, `opened_at`);
