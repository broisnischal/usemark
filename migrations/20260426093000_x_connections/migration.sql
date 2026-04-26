CREATE TABLE `x_connection` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `x_user_id` text NOT NULL,
  `username` text,
  `access_token` text NOT NULL,
  `refresh_token` text,
  `scope` text,
  `access_token_expires_at` integer,
  `created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `x_connection_user_id_idx` ON `x_connection` (`user_id`);
--> statement-breakpoint
CREATE INDEX `x_connection_x_user_id_idx` ON `x_connection` (`x_user_id`);
