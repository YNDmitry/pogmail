ALTER TABLE `contacts` ADD `confirmation_mailbox_id` text REFERENCES `mailboxes`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `contacts` ADD `welcome_sent_at` integer;
