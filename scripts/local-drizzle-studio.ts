import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const wranglerPath = join(root, "wrangler.jsonc");
const d1StateRoot = join(root, ".wrangler/state/v3/d1");

function getFirstD1DatabaseId(): string | undefined {
  const text = readFileSync(wranglerPath, "utf8");
  const d1Idx = text.indexOf('"d1_databases"');
  if (d1Idx < 0) return undefined;
  const slice = text.slice(d1Idx, d1Idx + 4000);
  const m = slice.match(/"database_id"\s*:\s*"([^"]+)"/);
  return m?.[1];
}

function collectSqliteFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) collectSqliteFiles(p, acc);
    else if (ent.isFile() && p.endsWith(".sqlite")) acc.push(p);
  }
  return acc;
}

const files = collectSqliteFiles(d1StateRoot);
const dbId = getFirstD1DatabaseId();
const preferred = dbId ? files.filter((f) => f.includes(dbId)) : [];
const candidates = preferred.length > 0 ? preferred : files;

if (candidates.length === 0) {
  console.error(
    `No local D1 SQLite under ${d1StateRoot}. Start dev once (e.g. bun run dev) so Wrangler creates the local DB, then retry.`,
  );
  process.exit(1);
}

candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
const sqlitePath = candidates[0]!;

process.env.LOCAL_D1_SQLITE = pathToFileURL(sqlitePath).href;

const r = spawnSync("bunx", ["drizzle-kit", "studio"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
  shell: false,
});

process.exit(r.status === null ? 1 : r.status);
