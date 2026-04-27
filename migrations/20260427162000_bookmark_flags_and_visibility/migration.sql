ALTER TABLE `bookmark`
ADD COLUMN `save_for_later` integer NOT NULL DEFAULT 0;

ALTER TABLE `bookmark`
ADD COLUMN `is_important` integer NOT NULL DEFAULT 0;

ALTER TABLE `bookmark`
ADD COLUMN `visibility` text NOT NULL DEFAULT 'private';
