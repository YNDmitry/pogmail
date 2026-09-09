CREATE TABLE `email_delivery_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`outbound_delivery_id` text NOT NULL,
	`type` text NOT NULL,
	`delivery_status` text NOT NULL,
	`bounce_type` text,
	`terminal` integer NOT NULL,
	`detail` text,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`outbound_delivery_id`) REFERENCES `outbound_deliveries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `email_delivery_events_delivery_idx` ON `email_delivery_events` (`outbound_delivery_id`,`occurred_at`);
