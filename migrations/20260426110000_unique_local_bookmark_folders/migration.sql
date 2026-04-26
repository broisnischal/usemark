DROP INDEX IF EXISTS `bookmark_folder_local_user_id_name_unique`;--> statement-breakpoint

UPDATE `bookmark`
SET `folder_id` = (
  SELECT keep.`id`
  FROM `bookmark_folder` keep
  WHERE keep.`user_id` = `bookmark`.`user_id`
    AND keep.`name` = (
      SELECT duplicate.`name`
      FROM `bookmark_folder` duplicate
      WHERE duplicate.`id` = `bookmark`.`folder_id`
    )
    AND keep.`source_type` = 'local'
  ORDER BY keep.`created_at`, keep.`id`
  LIMIT 1
)
WHERE `folder_id` IN (
  SELECT duplicate.`id`
  FROM `bookmark_folder` duplicate
  WHERE duplicate.`source_type` = 'local'
    AND EXISTS (
      SELECT 1
      FROM `bookmark_folder` keep
      WHERE keep.`source_type` = 'local'
        AND keep.`user_id` = duplicate.`user_id`
        AND keep.`name` = duplicate.`name`
        AND (keep.`created_at` < duplicate.`created_at` OR (keep.`created_at` = duplicate.`created_at` AND keep.`id` < duplicate.`id`))
    )
);--> statement-breakpoint

DELETE FROM `bookmark_folder`
WHERE `source_type` = 'local'
  AND EXISTS (
    SELECT 1
    FROM `bookmark_folder` keep
    WHERE keep.`source_type` = 'local'
      AND keep.`user_id` = `bookmark_folder`.`user_id`
      AND keep.`name` = `bookmark_folder`.`name`
      AND (keep.`created_at` < `bookmark_folder`.`created_at` OR (keep.`created_at` = `bookmark_folder`.`created_at` AND keep.`id` < `bookmark_folder`.`id`))
  );--> statement-breakpoint

DROP INDEX IF EXISTS `bookmark_folder_user_id_name_idx`;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `bookmark_folder_user_id_name_idx`
ON `bookmark_folder` (`user_id`, `name`);
