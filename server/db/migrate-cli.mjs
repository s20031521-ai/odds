import path from "node:path";
import { fileURLToPath } from "node:url";

import { runMigrations } from "./migrate.mjs";
import { createPool } from "./pool.mjs";

export async function runMigrateCli({
  databaseUrl = process.env.DATABASE_URL,
  poolFactory = createPool,
  migrate = runMigrations,
  migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../db/migrations"),
  stdout = console.log,
  stderr = console.error,
} = {}) {
  if (!databaseUrl) throw new Error("missing database");
  let pool;
  try {
    pool = poolFactory(databaseUrl);
    const applied = await migrate(pool, migrationsDir);
    await pool.end();
    pool = undefined;
    stdout(`migrationsApplied=${applied.length}`);
    stdout("status=complete");
    return 0;
  } catch {
    if (pool) await pool.end().catch(() => {});
    stderr("status=failed");
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigrateCli().then((code) => { process.exitCode = code; }).catch(() => { console.error("status=failed"); process.exitCode = 1; });
}
