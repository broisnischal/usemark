ALTER TABLE `user`
ADD COLUMN `utm_enabled` integer NOT NULL DEFAULT 0;

ALTER TABLE `user`
ADD COLUMN `utm_source` text NOT NULL DEFAULT 'usemark';
