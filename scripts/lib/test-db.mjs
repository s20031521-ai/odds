// Shared disposable-schema helper for PostgreSQL integration tests.
// Mirrors the withDatabase pattern from scripts/lib/postgres-sink.test.mjs,
// but skips cleanly when DATABASE_URL is not set.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runMigrations } from "../../server/db/migrate.mjs";
import { createPool } from "../../server/db/pool.mjs";

const DATABASE_URL = process.env.DATABASE_URL;
const EXPECTED_DATABASE_URL = "postgresql://odds_test:odds_test@127.0.0.1:55432/odds_test";
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, "db", "migrations");
const UUID_SCHEMA = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export async function withDatabase(t, callback) {
  await withDatabaseUrl(t, async (pool) => callback(pool));
}

// Same as withDatabase but also hands the schema-scoped connection URL to the
// callback, so tests can spawn child processes against the disposable schema.
export async function withDatabaseUrl(t, callback) {
  if (!DATABASE_URL) {
    t.skip("DATABASE_URL is not set; skipping disposable PostgreSQL test");
    return;
  }
  assert.equal(DATABASE_URL, EXPECTED_DATABASE_URL, "DATABASE_URL must exactly match the disposable odds_test database");
  const schema = randomUUID();
  assert.match(schema, UUID_SCHEMA);
  const adminPool = createPool(DATABASE_URL);
  let pool;

  t.after(async () => {
    let cleanupError;
    if (pool) {
      try { await pool.end(); } catch (error) { cleanupError = error; }
    }
    try { await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteOwnedSchema(schema)} CASCADE`); } catch (error) { cleanupError ??= error; }
    try { await adminPool.end(); } catch (error) { cleanupError ??= error; }
    if (cleanupError) throw cleanupError;
  });

  await adminPool.query(`CREATE SCHEMA ${quoteOwnedSchema(schema)}`);
  const scopedUrl = new URL(DATABASE_URL);
  scopedUrl.searchParams.set("options", `-c search_path=${quoteOwnedSchema(schema)}`);
  pool = createPool(scopedUrl.toString());
  await runMigrations(pool, MIGRATIONS_DIR);
  await callback(pool, scopedUrl.toString());
}

function quoteOwnedSchema(schema) {
  assert.match(schema, UUID_SCHEMA, "refusing to use a schema that is not this test's generated UUID");
  return `"${schema}"`;
}
