DELETE FROM `bookmark`
WHERE `id` IN (
  SELECT duplicate.`id`
  FROM `bookmark` AS duplicate
  INNER JOIN `bookmark` AS keeper
    ON duplicate.`user_id` = keeper.`user_id`
    AND duplicate.`folder_id` = keeper.`folder_id`
    AND duplicate.`url` = keeper.`url`
    AND duplicate.`id` < keeper.`id`
);

CREATE UNIQUE INDEX IF NOT EXISTS `bookmark_user_folder_url_unique_idx`
ON `bookmark` (`user_id`, `folder_id`, `url`);
