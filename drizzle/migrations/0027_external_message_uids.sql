ALTER TABLE `messages` ADD `external_folder_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `external_uid` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `messages_external_uid_unq` ON `messages` (`external_folder_id`,`external_uid`);
