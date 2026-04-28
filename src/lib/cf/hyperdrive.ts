import "@tanstack/react-start/server-only";
import { env as workerEnv } from "cloudflare:workers";

/**
 * Cloudflare Hyperdrive binding (Postgres / MySQL over TCP).
 * @see https://developers.cloudflare.com/hyperdrive/configuration/connect-to-postgres/
 */
export type HyperdriveBinding = {
  connectionString: string;
};

type WorkerEnvWithOptionalHyperdrive = typeof workerEnv & {
  HYPERDRIVE?: HyperdriveBinding;
};

/**
 * Hyperdrive **accelerates regional Postgres/MySQL** (connection pooling + query cache).
 * It does **not** wrap D1 — this app’s primary DB remains `workerEnv.bmark` + Drizzle D1.
 *
 * When you add a `hyperdrive` entry in `wrangler.jsonc` and run `wrangler types`, wire a
 * `pg` / `mysql2` client with `connectionString: getHyperdrivePostgresUrl()` (see Cloudflare docs).
 */
export function getHyperdrivePostgresUrl(): string | null {
  const hyperdrive = (workerEnv as WorkerEnvWithOptionalHyperdrive).HYPERDRIVE;
  const url = hyperdrive?.connectionString?.trim();
  return url && url.length > 0 ? url : null;
}
