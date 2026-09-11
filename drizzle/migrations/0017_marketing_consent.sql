ALTER TABLE `contacts` ADD `marketing_status` text NOT NULL DEFAULT 'subscribed';
--> statement-breakpoint
ALTER TABLE `contacts` ADD `confirmation_token` text;
--> statement-breakpoint
ALTER TABLE `contacts` ADD `confirmed_at` integer;
--> statement-breakpoint
UPDATE `contacts` SET `marketing_status` = 'unsubscribed' WHERE `unsubscribed_at` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_confirmation_token_unq` ON `contacts` (`confirmation_token`);
--> statement-breakpoint
CREATE INDEX `contacts_marketing_status_idx` ON `contacts` (`user_id`, `marketing_status`);
