import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth.schema";

const defaultTimestampMs = sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`;

export const bookmarkFolder = sqliteTable(
  "bookmark_folder",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sourceType: text("source_type").notNull().default("local"),
    syncEnabled: integer("sync_enabled", { mode: "boolean" }).notNull().default(false),
    isPinned: integer("is_pinned", { mode: "boolean" }).notNull().default(false),
    visibility: text("visibility", { enum: ["private", "public"] })
      .notNull()
      .default("private"),
    externalAccountId: text("external_account_id"),
    externalResourceId: text("external_resource_id"),
    unseenCount: integer("unseen_count").notNull().default(0),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
    syncIntervalMinutes: integer("sync_interval_minutes").notNull().default(30),
    rssFetchLimit: integer("rss_fetch_limit").notNull().default(100),
    rssKeepRecentCount: integer("rss_keep_recent_count").notNull().default(500),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(defaultTimestampMs)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(defaultTimestampMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("bookmark_folder_user_id_name_idx").on(table.userId, table.name),
    index("bookmark_folder_user_source_type_idx").on(table.userId, table.sourceType),
  ],
);

export const bookmark = sqliteTable(
  "bookmark",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    contentType: text("content_type", { enum: ["link", "text"] })
      .notNull()
      .default("link"),
    url: text("url").notNull(),
    title: text("title"),
    note: text("note"),
    tag: text("tag").notNull(),
    saveForLater: integer("save_for_later", { mode: "boolean" }).notNull().default(false),
    isImportant: integer("is_important", { mode: "boolean" }).notNull().default(false),
    isCompleted: integer("is_completed", { mode: "boolean" }).notNull().default(false),
    visibility: text("visibility", { enum: ["private", "public"] })
      .notNull()
      .default("private"),
    sourceItemId: text("source_item_id"),
    seenAt: integer("seen_at", { mode: "timestamp_ms" }),
    folderId: text("folder_id")
      .notNull()
      .references(() => bookmarkFolder.id, { onDelete: "cascade" }),
    embedding: text("embedding"),
    embeddingModel: text("embedding_model"),
    embeddingStatus: text("embedding_status").notNull().default("pending"),
    embeddingError: text("embedding_error"),
    embeddedAt: integer("embedded_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(defaultTimestampMs)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(defaultTimestampMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("bookmark_user_id_idx").on(table.userId),
    index("bookmark_user_tag_idx").on(table.userId, table.tag),
    index("bookmark_user_folder_id_idx").on(table.userId, table.folderId),
    index("bookmark_user_source_item_id_idx").on(table.userId, table.sourceItemId),
    index("bookmark_user_created_at_idx").on(table.userId, table.createdAt),
  ],
);

export const xConnection = sqliteTable(
  "x_connection",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    xUserId: text("x_user_id").notNull(),
    username: text("username"),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    scope: text("scope"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(defaultTimestampMs)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(defaultTimestampMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("x_connection_user_id_idx").on(table.userId),
    index("x_connection_x_user_id_idx").on(table.xUserId),
  ],
);
