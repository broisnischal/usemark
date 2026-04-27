CREATE TABLE `bookmark_folder` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`source_type` text DEFAULT 'local' NOT NULL,
	`sync_enabled` integer DEFAULT false NOT NULL,
	`is_pinned` integer DEFAULT false NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`external_account_id` text,
	`external_resource_id` text,
	`unseen_count` integer DEFAULT 0 NOT NULL,
	`last_synced_at` integer,
	`sync_interval_minutes` integer DEFAULT 30 NOT NULL,
	`rss_fetch_limit` integer DEFAULT 100 NOT NULL,
	`rss_keep_recent_count` integer DEFAULT 500 NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	CONSTRAINT `fk_bookmark_folder_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `x_connection` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`x_user_id` text NOT NULL,
	`username` text,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`scope` text,
	`access_token_expires_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	CONSTRAINT `fk_x_connection_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `user` ADD `utm_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `utm_source` text DEFAULT 'usemark' NOT NULL;--> statement-breakpoint
ALTER TABLE `bookmark` ADD `content_type` text DEFAULT 'link' NOT NULL;--> statement-breakpoint
ALTER TABLE `bookmark` ADD `tag` text NOT NULL;--> statement-breakpoint
ALTER TABLE `bookmark` ADD `save_for_later` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `bookmark` ADD `is_important` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `bookmark` ADD `is_completed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `bookmark` ADD `visibility` text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE `bookmark` ADD `source_item_id` text;--> statement-breakpoint
ALTER TABLE `bookmark` ADD `seen_at` integer;--> statement-breakpoint
ALTER TABLE `bookmark` ADD `folder_id` text NOT NULL REFERENCES bookmark_folder(id);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_bookmark` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`content_type` text DEFAULT 'link' NOT NULL,
	`url` text NOT NULL,
	`title` text,
	`note` text,
	`tag` text NOT NULL,
	`save_for_later` integer DEFAULT false NOT NULL,
	`is_important` integer DEFAULT false NOT NULL,
	`is_completed` integer DEFAULT false NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`source_item_id` text,
	`seen_at` integer,
	`folder_id` text NOT NULL,
	`embedding` text,
	`embedding_model` text,
	`embedding_status` text DEFAULT 'pending' NOT NULL,
	`embedding_error` text,
	`embedded_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	CONSTRAINT `fk_bookmark_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_bookmark_folder_id_bookmark_folder_id_fk` FOREIGN KEY (`folder_id`) REFERENCES `bookmark_folder`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_bookmark`(`id`, `user_id`, `title`, `url`, `note`, `embedding`, `embedding_model`, `embedding_status`, `embedding_error`, `embedded_at`, `created_at`, `updated_at`) SELECT `id`, `user_id`, `title`, `url`, `note`, `embedding`, `embedding_model`, `embedding_status`, `embedding_error`, `embedded_at`, `created_at`, `updated_at` FROM `bookmark`;--> statement-breakpoint
DROP TABLE `bookmark`;--> statement-breakpoint
ALTER TABLE `__new_bookmark` RENAME TO `bookmark`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX IF EXISTS `bookmark_user_category_idx`;--> statement-breakpoint
CREATE INDEX `bookmark_user_id_idx` ON `bookmark` (`user_id`);--> statement-breakpoint
CREATE INDEX `bookmark_user_tag_idx` ON `bookmark` (`user_id`,`tag`);--> statement-breakpoint
CREATE INDEX `bookmark_user_folder_id_idx` ON `bookmark` (`user_id`,`folder_id`);--> statement-breakpoint
CREATE INDEX `bookmark_user_source_item_id_idx` ON `bookmark` (`user_id`,`source_item_id`);--> statement-breakpoint
CREATE INDEX `bookmark_user_created_at_idx` ON `bookmark` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `bookmark_folder_user_id_name_idx` ON `bookmark_folder` (`user_id`,`name`);--> statement-breakpoint
CREATE INDEX `bookmark_folder_user_source_type_idx` ON `bookmark_folder` (`user_id`,`source_type`);--> statement-breakpoint
CREATE INDEX `x_connection_user_id_idx` ON `x_connection` (`user_id`);--> statement-breakpoint
CREATE INDEX `x_connection_x_user_id_idx` ON `x_connection` (`x_user_id`);