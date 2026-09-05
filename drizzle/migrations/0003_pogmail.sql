PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_app_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`app_name` text DEFAULT 'Pogmail' NOT NULL,
	`icon_key` text,
	`accent_color` text,
	`allow_registration` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_app_settings`("id", "app_name", "icon_key", "accent_color", "allow_registration", "created_at", "updated_at") SELECT "id", "app_name", "icon_key", "accent_color", "allow_registration", "created_at", "updated_at" FROM `app_settings`;--> statement-breakpoint
DROP TABLE `app_settings`;--> statement-breakpoint
ALTER TABLE `__new_app_settings` RENAME TO `app_settings`;--> statement-breakpoint
UPDATE `app_settings` SET `app_name` = 'Pogmail' WHERE `app_name` = 'Postbox';--> statement-breakpoint
PRAGMA foreign_keys=ON;