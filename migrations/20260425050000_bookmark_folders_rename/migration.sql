PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP INDEX IF EXISTS `bookmark_category_user_id_name_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `bookmark_user_category_id_idx`;--> statement-breakpoint
ALTER TABLE `bookmark_category` RENAME TO `bookmark_folder`;--> statement-breakpoint
ALTER TABLE `bookmark` RENAME COLUMN `category_id` TO `folder_id`;--> statement-breakpoint
ALTER TABLE `bookmark_folder` ADD `source_type` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `bookmark_folder` ADD `sync_enabled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bookmark_folder` ADD `external_account_id` text;--> statement-breakpoint
ALTER TABLE `bookmark_folder` ADD `external_resource_id` text;--> statement-breakpoint
ALTER TABLE `bookmark_folder` ADD `last_synced_at` integer;--> statement-breakpoint
CREATE INDEX `bookmark_folder_user_id_name_idx` ON `bookmark_folder` (`user_id`,`name`);--> statement-breakpoint
CREATE INDEX `bookmark_folder_user_source_type_idx` ON `bookmark_folder` (`user_id`,`source_type`);--> statement-breakpoint
CREATE INDEX `bookmark_user_folder_id_idx` ON `bookmark` (`user_id`,`folder_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
