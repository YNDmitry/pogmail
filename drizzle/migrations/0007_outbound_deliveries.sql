CREATE TABLE `outbound_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`outbound_job_id` text NOT NULL,
	`recipient` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`sent_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`outbound_job_id`) REFERENCES `outbound_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbound_deliveries_recipient_unq` ON `outbound_deliveries` (`outbound_job_id`,`recipient`);
--> statement-breakpoint
CREATE INDEX `outbound_deliveries_status_idx` ON `outbound_deliveries` (`outbound_job_id`,`status`);
