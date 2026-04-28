import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const localSqlite = process.env.LOCAL_D1_SQLITE;

export default defineConfig(
  localSqlite
    ? {
        schema: "./src/lib/db/schema/index.ts",
        breakpoints: true,
        verbose: true,
        strict: true,
        casing: "snake_case",
        out: "./migrations",
        dialect: "sqlite",
        dbCredentials: {
          url: localSqlite,
        },
      }
    : {
        schema: "./src/lib/db/schema/index.ts",
        breakpoints: true,
        verbose: true,
        strict: true,
        casing: "snake_case",
        out: "./migrations",
        dialect: "sqlite",
        driver: "d1-http",
        dbCredentials: {
          accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
          databaseId: process.env.CLOUDFLARE_DATABASE_ID!,
          token: process.env.CLOUDFLARE_D1_TOKEN!,
        },
      },
);
