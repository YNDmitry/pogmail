CREATE TABLE `campaign_link_clicks` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL REFERENCES `messages`(`id`) ON DELETE cascade,
	`token` text NOT NULL,
	`destination` text NOT NULL,
	`clicked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_link_clicks_token_unq` ON `campaign_link_clicks` (`token`);
--> statement-breakpoint
CREATE INDEX `campaign_link_clicks_message_idx` ON `campaign_link_clicks` (`message_id`);
--> statement-breakpoint
CREATE INDEX `campaign_link_clicks_clicked_idx` ON `campaign_link_clicks` (`clicked_at`);
