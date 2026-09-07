CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`scopes` text NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_token_unq` ON `api_keys` (`token_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_user_idx` ON `api_keys` (`user_id`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`target_user_id` text,
	`mailbox_id` text,
	`message_id` text,
	`action` text NOT NULL,
	`metadata` text,
	`ip` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_logs_actor_idx` ON `audit_logs` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_action_idx` ON `audit_logs` (`action`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`user_agent` text,
	`ip` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unq` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`reset_email` text,
	`forwarding_email` text,
	`password_hash` text NOT NULL,
	`avatar_key` text,
	`role` text DEFAULT 'user' NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`can_manage_mailboxes` integer DEFAULT false NOT NULL,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unq` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `domain_records` (
	`id` text PRIMARY KEY NOT NULL,
	`domain_id` text NOT NULL,
	`cloudflare_record_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `domain_records_domain_idx` ON `domain_records` (`domain_id`);--> statement-breakpoint
CREATE TABLE `domains` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`hostname` text NOT NULL,
	`zone_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`routing_status` text,
	`routing_enabled` integer DEFAULT false NOT NULL,
	`sending_subdomain_tag` text,
	`sending_enabled` integer DEFAULT false NOT NULL,
	`last_error` text,
	`verified_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domains_hostname_unq` ON `domains` (`hostname`);--> statement-breakpoint
CREATE INDEX `domains_user_idx` ON `domains` (`user_id`);--> statement-breakpoint
CREATE TABLE `auto_reply_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`recipient` text NOT NULL,
	`sent_at` integer NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auto_reply_deliveries_unq` ON `auto_reply_deliveries` (`mailbox_id`,`recipient`);--> statement-breakpoint
CREATE INDEX `auto_reply_deliveries_sent_idx` ON `auto_reply_deliveries` (`sent_at`);--> statement-breakpoint
CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `folders_name_unq` ON `folders` (`mailbox_id`,`name`);--> statement-breakpoint
CREATE TABLE `mailbox_access` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`user_id` text NOT NULL,
	`permission` text DEFAULT 'read_only' NOT NULL,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mailbox_access_unq` ON `mailbox_access` (`mailbox_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `mailbox_access_user_idx` ON `mailbox_access` (`user_id`);--> statement-breakpoint
CREATE TABLE `mailbox_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`domain_id` text NOT NULL,
	`local_part` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mailbox_aliases_address_unq` ON `mailbox_aliases` (`domain_id`,`local_part`);--> statement-breakpoint
CREATE INDEX `mailbox_aliases_mailbox_idx` ON `mailbox_aliases` (`mailbox_id`);--> statement-breakpoint
CREATE TABLE `mailboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`domain_id` text NOT NULL,
	`local_part` text NOT NULL,
	`display_name` text,
	`signature` text,
	`avatar_key` text,
	`type` text DEFAULT 'personal' NOT NULL,
	`use_all_domains` integer DEFAULT false NOT NULL,
	`auto_reply_enabled` integer DEFAULT false NOT NULL,
	`auto_reply_subject` text DEFAULT 'Out of office' NOT NULL,
	`auto_reply_body` text DEFAULT '' NOT NULL,
	`cloudflare_rule_id` text,
	`disabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mailboxes_address_unq` ON `mailboxes` (`domain_id`,`local_part`);--> statement-breakpoint
CREATE INDEX `mailboxes_user_idx` ON `mailboxes` (`user_id`);--> statement-breakpoint
CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`mailbox_id` text,
	`message_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`attendees` text DEFAULT '[]' NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `calendar_events_user_starts_idx` ON `calendar_events` (`user_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`source` text DEFAULT 'inbound' NOT NULL,
	`blocked` integer DEFAULT false NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`last_seen_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_email_unq` ON `contacts` (`user_id`,`email`);--> statement-breakpoint
CREATE INDEX `contacts_blocked_idx` ON `contacts` (`blocked`);--> statement-breakpoint
CREATE TABLE `email_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`body_text` text DEFAULT '' NOT NULL,
	`body_html` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `email_templates_user_idx` ON `email_templates` (`user_id`);--> statement-breakpoint
CREATE TABLE `message_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`disposition` text DEFAULT 'attachment' NOT NULL,
	`content_id` text,
	`r2_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `message_attachments_message_idx` ON `message_attachments` (`message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `message_attachments_key_unq` ON `message_attachments` (`r2_key`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`author_user_id` text,
	`direction` text NOT NULL,
	`message_id` text,
	`in_reply_to` text,
	`thread_id` text NOT NULL,
	`status` text NOT NULL,
	`folder_id` text,
	`subject` text,
	`from_address` text NOT NULL,
	`from_name` text,
	`to_addresses` text NOT NULL,
	`cc_addresses` text,
	`bcc_addresses` text,
	`reply_to` text,
	`snippet` text,
	`body_text` text,
	`body_html` text,
	`raw_key` text,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`has_attachments` integer DEFAULT false NOT NULL,
	`read` integer DEFAULT false NOT NULL,
	`starred` integer DEFAULT false NOT NULL,
	`snoozed_until` integer,
	`spam_score` integer,
	`received_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `messages_folder_idx` ON `messages` (`mailbox_id`,`status`,`received_at`);--> statement-breakpoint
CREATE INDEX `messages_thread_idx` ON `messages` (`mailbox_id`,`thread_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `messages_starred_idx` ON `messages` (`mailbox_id`,`starred`,`received_at`);--> statement-breakpoint
CREATE INDEX `messages_custom_folder_idx` ON `messages` (`folder_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `messages_snoozed_idx` ON `messages` (`snoozed_until`);--> statement-breakpoint
CREATE UNIQUE INDEX `messages_dedupe_unq` ON `messages` (`mailbox_id`,`message_id`);--> statement-breakpoint
CREATE TABLE `outbound_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`scheduled_for` integer,
	`sent_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `outbound_jobs_status_idx` ON `outbound_jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `routing_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`domain_id` text,
	`mailbox_id` text,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`conditions` text NOT NULL,
	`match_all` integer DEFAULT true NOT NULL,
	`action` text NOT NULL,
	`action_target` text,
	`reject_reason` text,
	`stop_processing` integer DEFAULT false NOT NULL,
	`match_count` integer DEFAULT 0 NOT NULL,
	`last_matched_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `routing_rules_domain_idx` ON `routing_rules` (`scope`,`domain_id`,`enabled`,`priority`);--> statement-breakpoint
CREATE INDEX `routing_rules_mailbox_idx` ON `routing_rules` (`scope`,`mailbox_id`,`enabled`,`priority`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`event` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`response_status` integer,
	`error_snippet` text,
	`duration_ms` integer,
	`next_retry_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_webhook_idx` ON `webhook_deliveries` (`webhook_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_retry_idx` ON `webhook_deliveries` (`status`,`next_retry_at`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`url` text NOT NULL,
	`events` text NOT NULL,
	`secret` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhooks_mailbox_idx` ON `webhooks` (`mailbox_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`app_name` text DEFAULT 'Pogmail' NOT NULL,
	`icon_key` text,
	`accent_color` text,
	`allow_registration` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `backup_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`schedule_type` text DEFAULT 'daily' NOT NULL,
	`schedule_value` integer,
	`retention_enabled` integer DEFAULT false NOT NULL,
	`retention_days` integer DEFAULT 30 NOT NULL,
	`last_run_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `backups` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`trigger` text NOT NULL,
	`r2_key` text,
	`filename` text,
	`size_bytes` integer,
	`table_counts` text,
	`error` text,
	`created_by_user_id` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `backups_created_idx` ON `backups` (`created_at`);--> statement-breakpoint
CREATE INDEX `backups_status_idx` ON `backups` (`status`);
