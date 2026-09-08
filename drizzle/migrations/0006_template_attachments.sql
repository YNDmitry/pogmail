CREATE TABLE `template_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`content_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `email_templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `template_attachments_template_idx` ON `template_attachments` (`template_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `template_attachments_key_unq` ON `template_attachments` (`r2_key`);
