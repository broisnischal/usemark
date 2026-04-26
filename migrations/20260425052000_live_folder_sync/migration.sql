ALTER TABLE `bookmark_folder` ADD `visibility` text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE `bookmark_folder` ADD `unseen_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bookmark` ADD `source_item_id` text;--> statement-breakpoint
ALTER TABLE `bookmark` ADD `seen_at` integer;--> statement-breakpoint
CREATE INDEX `bookmark_user_source_item_id_idx` ON `bookmark` (`user_id`,`source_item_id`);--> statement-breakpoint
