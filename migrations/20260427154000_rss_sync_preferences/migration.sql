ALTER TABLE `bookmark_folder`
ADD COLUMN `sync_interval_minutes` integer NOT NULL DEFAULT 30;

ALTER TABLE `bookmark_folder`
ADD COLUMN `rss_fetch_limit` integer NOT NULL DEFAULT 100;

ALTER TABLE `bookmark_folder`
ADD COLUMN `rss_keep_recent_count` integer NOT NULL DEFAULT 500;
