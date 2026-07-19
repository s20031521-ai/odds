import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { loadServerConfig } from "../config.mjs";
import { createPool, withTransaction } from "./pool.mjs";
import { runMigrations } from "./migrate.mjs";
import { runMigrateCli } from "./migrate-cli.mjs";

const DATABASE_URL = process.env.DATABASE_URL;
const EXPECTED_TEST_DATABASE_URL = "postgresql://odds_test:odds_test@127.0.0.1:55432/odds_test";
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INITIAL_MIGRATIONS_DIR = path.join(PROJECT_ROOT, "db", "migrations");
const VALID_ENV = Object.freeze({
  DATABASE_URL: DATABASE_URL ?? EXPECTED_TEST_DATABASE_URL,
  SESSION_SECRET: "test-only-session-secret-32-bytes-minimum",
  PUBLIC_ORIGIN: "https://odds.ballballchu.com.hk",
});

test("loadServerConfig accepts the complete production-shaped environment", () => {
  assert.deepEqual(loadServerConfig(VALID_ENV), {
    databaseUrl: VALID_ENV.DATABASE_URL,
    sessionSecret: VALID_ENV.SESSION_SECRET,
    publicOrigin: VALID_ENV.PUBLIC_ORIGIN,
    runMigrations: true,
    trustedProxyCidrs: [],
  });
});

test("loadServerConfig rejects missing and invalid required values without echoing secrets", () => {
  const cases = [
    ["DATABASE_URL", undefined, /DATABASE_URL/],
    ["DATABASE_URL", "not-a-database-url", /DATABASE_URL/],
    ["DATABASE_URL", "mysql://user:password@localhost/database", /DATABASE_URL/],
    ["SESSION_SECRET", undefined, /SESSION_SECRET/],
    ["SESSION_SECRET", "too-short", /SESSION_SECRET/],
    ["PUBLIC_ORIGIN", undefined, /PUBLIC_ORIGIN/],
    ["PUBLIC_ORIGIN", "not-an-origin", /PUBLIC_ORIGIN/],
    ["PUBLIC_ORIGIN", "http://odds.ballballchu.com.hk", /PUBLIC_ORIGIN/],
    ["PUBLIC_ORIGIN", "https://odds.ballballchu.com.hk/api", /PUBLIC_ORIGIN/],
  ];

  for (const [name, value, expectedMessage] of cases) {
    const env = { ...VALID_ENV, [name]: value };
    assert.throws(() => loadServerConfig(env), (error) => {
      assert.match(error.message, expectedMessage);
      if (typeof value === "string" && name === "SESSION_SECRET") {
        assert.equal(error.message.includes(value), false);
      }
      if (typeof value === "string" && name === "DATABASE_URL" && value.includes("user:password")) {
        assert.equal(error.message.includes(value), false);
        assert.equal(error.message.includes("user:password"), false);
      }
      return true;
    });
  }
});

test("migration CLI sanitizes construction, connection, and cleanup failures", () => {
  const secretUrl = "postgresql://review_user:review_password@127.0.0.1:1/review_db";
  const child = spawnSync(process.execPath, [path.join(PROJECT_ROOT, "server", "db", "migrate-cli.mjs")], {
    cwd: PROJECT_ROOT, encoding: "utf8", env: { ...process.env, DATABASE_URL: secretUrl }, timeout: 10_000,
  });
  const output = `${child.stdout}${child.stderr}`;
  assert.notEqual(child.status, 0);
  assert.match(output, /^status=failed\s*$/);
  for (const forbidden of [secretUrl, "review_user", "review_password", "Error:", PROJECT_ROOT]) assert.equal(output.includes(forbidden), false);
});

test("migration CLI reports failure when cleanup fails after a successful migration", async () => {
  const output = [];
  const errors = [];
  const cleanupError = new Error("secret cleanup stack");
  const code = await runMigrateCli({
    databaseUrl: "postgresql://hidden_user:hidden_password@hidden/db",
    poolFactory: () => ({ end: async () => { throw cleanupError; } }),
    migrate: async () => ["001.sql"],
    stdout: (line) => output.push(line),
    stderr: (line) => errors.push(line),
  });
  assert.equal(code, 1);
  assert.deepEqual(output, []);
  assert.deepEqual(errors, ["status=failed"]);
});

test("withTransaction commits returned work and rolls back thrown work", async (t) => {
  requireDatabaseUrl();
  await withIsolatedSchema(t, async (pool) => {
    await pool.query("CREATE TABLE transaction_probe (value integer NOT NULL)");

    const result = await withTransaction(pool, async (client) => {
      await client.query("INSERT INTO transaction_probe (value) VALUES ($1)", [1]);
      return "committed";
    });
    assert.equal(result, "committed");

    await assert.rejects(
      withTransaction(pool, async (client) => {
        await client.query("INSERT INTO transaction_probe (value) VALUES ($1)", [2]);
        throw new Error("force rollback");
      }),
      /force rollback/,
    );

    const values = await pool.query("SELECT value FROM transaction_probe ORDER BY value");
    assert.deepEqual(values.rows, [{ value: 1 }]);
  });
});

test("withTransaction preserves the original error if rollback also fails", async (t) => {
  requireDatabaseUrl();
  await withIsolatedSchema(t, async (pool) => {
    let releasedWith;
    const rollbackFailingPool = {
      async connect() {
        const realClient = await pool.connect();
        return {
          async query(sql, parameters) {
            if (sql === "ROLLBACK") throw new Error("injected rollback failure");
            return realClient.query(sql, parameters);
          },
          release(error) {
            releasedWith = error;
            realClient.release(error);
          },
        };
      },
    };

    await assert.rejects(
      withTransaction(rollbackFailingPool, async (client) => {
        await client.query("SELECT 1");
        throw new Error("original transaction failure");
      }),
      (error) => {
        assert.equal(error.message, "original transaction failure");
        assert.equal(error.rollbackError?.message, "injected rollback failure");
        return true;
      },
    );
    assert.equal(releasedWith?.message, "injected rollback failure");
  });
});

test("runMigrations applies SQL files in lexical order and records SHA-256 checksums", async (t) => {
  requireDatabaseUrl();
  await withIsolatedSchema(t, async (pool) => {
    await withTempMigrations([
      ["010_second.sql", "INSERT INTO migration_order (position) VALUES (2);"],
      ["002_first.sql", "CREATE TABLE migration_order (position integer NOT NULL); INSERT INTO migration_order (position) VALUES (1);"],
      ["README.txt", "This is not a migration."],
    ], async (directory) => {
      const applied = await runMigrations(pool, directory);
      assert.deepEqual(applied, ["002_first.sql", "010_second.sql"]);

      const values = await pool.query("SELECT position FROM migration_order ORDER BY position");
      assert.deepEqual(values.rows, [{ position: 1 }, { position: 2 }]);

      const ledger = await pool.query("SELECT version, checksum_sha256 FROM schema_migrations ORDER BY version");
      assert.deepEqual(ledger.rows.map(({ version }) => version), ["002_first.sql", "010_second.sql"]);
      assert.ok(ledger.rows.every(({ checksum_sha256 }) => /^[a-f0-9]{64}$/.test(checksum_sha256)));
    });
  });
});

test("runMigrations is idempotent and rejects changed content for an applied version", async (t) => {
  requireDatabaseUrl();
  await withIsolatedSchema(t, async (pool) => {
    await withTempMigrations([
      ["001_counter.sql", "CREATE TABLE migration_counter (value integer NOT NULL); INSERT INTO migration_counter (value) VALUES (1);"],
    ], async (directory) => {
      assert.deepEqual(await runMigrations(pool, directory), ["001_counter.sql"]);
      assert.deepEqual(await runMigrations(pool, directory), []);

      const counter = await pool.query("SELECT value FROM migration_counter");
      assert.deepEqual(counter.rows, [{ value: 1 }]);

      await writeFile(path.join(directory, "001_counter.sql"), "SELECT 2;", "utf8");
      await assert.rejects(runMigrations(pool, directory), /checksum.*001_counter\.sql|001_counter\.sql.*checksum/i);

      const ledger = await pool.query("SELECT count(*)::integer AS count FROM schema_migrations");
      assert.deepEqual(ledger.rows, [{ count: 1 }]);
    });
  });
});

test("runMigrations rejects recorded migration history whose SQL file is missing", async (t) => {
  requireDatabaseUrl();
  await withIsolatedSchema(t, async (pool) => {
    await withTempMigrations([
      ["001_then_deleted.sql", "CREATE TABLE deleted_migration_probe (id integer);"],
    ], async (directory) => {
      assert.deepEqual(await runMigrations(pool, directory), ["001_then_deleted.sql"]);
      await rm(path.join(directory, "001_then_deleted.sql"));

      await assert.rejects(
        runMigrations(pool, directory),
        /recorded migration 001_then_deleted\.sql.*missing/i,
      );

      const ledger = await pool.query("SELECT version FROM schema_migrations ORDER BY version");
      assert.deepEqual(ledger.rows, [{ version: "001_then_deleted.sql" }]);
    });
  });
});

test("runMigrations destroys the client after an ambiguous advisory-lock acquisition failure", async (t) => {
  requireDatabaseUrl();
  await withIsolatedSchema(t, async (pool) => {
    let releasedWith;
    const acquisitionFailure = new Error("injected lost advisory-lock response");
    const uncertainLockPool = {
      async connect() {
        const realClient = await pool.connect();
        return {
          async query(sql, parameters) {
            const result = await realClient.query(sql, parameters);
            if (sql === "SELECT pg_advisory_lock($1)") throw acquisitionFailure;
            return result;
          },
          release(error) {
            releasedWith = error;
            realClient.release(error);
          },
        };
      },
    };

    await withTempMigrations([], async (directory) => {
      await assert.rejects(runMigrations(uncertainLockPool, directory), acquisitionFailure);
      assert.equal(releasedWith, acquisitionFailure);
    });
  });
});

test("runMigrations destroys the client after an ambiguous BEGIN failure", async (t) => {
  requireDatabaseUrl();
  await withIsolatedSchema(t, async (pool) => {
    let releasedWith;
    const beginFailure = new Error("injected lost BEGIN response");
    const uncertainBeginPool = {
      async connect() {
        const realClient = await pool.connect();
        return {
          async query(sql, parameters) {
            const result = await realClient.query(sql, parameters);
            if (sql === "BEGIN") throw beginFailure;
            return result;
          },
          release(error) {
            releasedWith = error;
            realClient.release(error);
          },
        };
      },
    };

    await withTempMigrations([
      ["001_ambiguous_begin.sql", "CREATE TABLE must_not_run_after_ambiguous_begin (id integer);"],
    ], async (directory) => {
      await assert.rejects(runMigrations(uncertainBeginPool, directory), beginFailure);
      assert.equal(releasedWith, beginFailure);
    });
  });
});

test("runMigrations serializes concurrent runners", async (t) => {
  requireDatabaseUrl();
  await withIsolatedSchema(t, async (pool) => {
    await withTempMigrations([
      ["001_concurrent.sql", "SELECT pg_sleep(0.1); CREATE TABLE concurrent_probe (id integer);"],
    ], async (directory) => {
      const results = await Promise.all([
        runMigrations(pool, directory),
        runMigrations(pool, directory),
      ]);
      assert.deepEqual(results.sort((left, right) => right.length - left.length), [["001_concurrent.sql"], []]);

      const ledger = await pool.query("SELECT count(*)::integer AS count FROM schema_migrations");
      assert.deepEqual(ledger.rows, [{ count: 1 }]);
    });
  });
});

test("runMigrations rejects a new migration that predates recorded history", async (t) => {
  requireDatabaseUrl();
  await withIsolatedSchema(t, async (pool) => {
    await withTempMigrations([
      ["010_later.sql", "CREATE TABLE lexical_history (id integer);"],
    ], async (directory) => {
      assert.deepEqual(await runMigrations(pool, directory), ["010_later.sql"]);
      await writeFile(path.join(directory, "005_earlier.sql"), "SELECT 5;", "utf8");

      await assert.rejects(
        runMigrations(pool, directory),
        /005_earlier\.sql.*before.*010_later\.sql/i,
      );

      const ledger = await pool.query("SELECT version FROM schema_migrations ORDER BY version");
      assert.deepEqual(ledger.rows, [{ version: "010_later.sql" }]);
    });
  });
});

test("runMigrations destroys the client if advisory unlock fails after a migration error", async (t) => {
  requireDatabaseUrl();
  await withIsolatedSchema(t, async (pool) => {
    let releasedWith;
    const unlockFailure = new Error("injected advisory unlock failure");
    const unlockFailingPool = {
      async connect() {
        const realClient = await pool.connect();
        return {
          async query(sql, parameters) {
            if (sql === "SELECT pg_advisory_unlock($1)") throw unlockFailure;
            return realClient.query(sql, parameters);
          },
          release(error) {
            releasedWith = error;
            realClient.release(error);
          },
        };
      },
    };

    await withTempMigrations([
      ["001_fails_and_unlock_fails.sql", "SELECT * FROM another_table_that_does_not_exist;"],
    ], async (directory) => {
      await assert.rejects(runMigrations(unlockFailingPool, directory), (error) => {
        assert.match(error.message, /another_table_that_does_not_exist/);
        assert.equal(error.unlockError, unlockFailure);
        return true;
      });
      assert.equal(releasedWith, unlockFailure);
    });
  });
});

test("a failed SQL migration is rolled back and is never marked applied", async (t) => {
  requireDatabaseUrl();
  await withIsolatedSchema(t, async (pool) => {
    await withTempMigrations([
      ["001_fails.sql", "CREATE TABLE must_be_rolled_back (id integer); SELECT * FROM table_that_does_not_exist;"],
    ], async (directory) => {
      await assert.rejects(runMigrations(pool, directory), /table_that_does_not_exist/);

      const table = await pool.query("SELECT to_regclass('must_be_rolled_back') AS name");
      assert.deepEqual(table.rows, [{ name: null }]);
      const ledger = await pool.query("SELECT version FROM schema_migrations WHERE version = $1", ["001_fails.sql"]);
      assert.deepEqual(ledger.rows, []);
    });
  });
});

test("the project migrations create the exact table, audit, uniqueness, and auth boundaries", async (t) => {
  requireDatabaseUrl();
  await withIsolatedSchema(t, async (pool) => {
    assert.deepEqual(await runMigrations(pool, INITIAL_MIGRATIONS_DIR), ["001_initial.sql", "002_import_row_audit.sql", "003_auth_constraints.sql"]);
    assert.deepEqual(await runMigrations(pool, INITIAL_MIGRATIONS_DIR), []);

    const tables = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    assert.deepEqual(tables.rows.map(({ table_name }) => table_name), [
      "collector_state",
      "import_rows",
      "import_runs",
      "live_odds",
      "login_attempts",
      "owners",
      "prediction_snapshots",
      "results",
      "schema_migrations",
      "sessions",
    ]);

    const uniqueConstraints = await pool.query(`
      SELECT relation.relname AS table_name,
             array_agg(attribute.attname::text ORDER BY key.ordinality) AS columns
      FROM pg_constraint AS constraint_record
      JOIN pg_class AS relation ON relation.oid = constraint_record.conrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      CROSS JOIN LATERAL unnest(constraint_record.conkey) WITH ORDINALITY AS key(attribute_number, ordinality)
      JOIN pg_attribute AS attribute
        ON attribute.attrelid = relation.oid AND attribute.attnum = key.attribute_number
      WHERE namespace.nspname = current_schema() AND constraint_record.contype = 'u'
      GROUP BY relation.relname, constraint_record.conname
      ORDER BY relation.relname, constraint_record.conname
    `);
    assert.deepEqual(uniqueConstraints.rows, [
      { table_name: "import_runs", columns: ["source_name", "source_sha256", "importer_version"] },
      { table_name: "live_odds", columns: ["identity_key"] },
      { table_name: "owners", columns: ["username"] },
      { table_name: "prediction_snapshots", columns: ["identity_key"] },
      { table_name: "results", columns: ["identity_key"] },
      { table_name: "sessions", columns: ["token_hash"] },
    ]);

    const foreignKeys = await pool.query(`
      SELECT source.relname AS table_name,
             array_agg(source_attribute.attname::text ORDER BY source_key.ordinality) AS columns,
             target.relname AS referenced_table,
             array_agg(target_attribute.attname::text ORDER BY source_key.ordinality) AS referenced_columns
      FROM pg_constraint AS constraint_record
      JOIN pg_class AS source ON source.oid = constraint_record.conrelid
      JOIN pg_class AS target ON target.oid = constraint_record.confrelid
      JOIN pg_namespace AS namespace ON namespace.oid = source.relnamespace
      CROSS JOIN LATERAL unnest(constraint_record.conkey) WITH ORDINALITY AS source_key(attribute_number, ordinality)
      JOIN pg_attribute AS source_attribute
        ON source_attribute.attrelid = source.oid AND source_attribute.attnum = source_key.attribute_number
      JOIN pg_attribute AS target_attribute
        ON target_attribute.attrelid = target.oid
       AND target_attribute.attnum = constraint_record.confkey[source_key.ordinality]
      WHERE namespace.nspname = current_schema() AND constraint_record.contype = 'f'
      GROUP BY source.relname, target.relname, constraint_record.conname
      ORDER BY source.relname, constraint_record.conname
    `);
    assert.deepEqual(foreignKeys.rows, [
      { table_name: "import_rows", columns: ["import_run_id"], referenced_table: "import_runs", referenced_columns: ["id"] },
      { table_name: "sessions", columns: ["owner_id"], referenced_table: "owners", referenced_columns: ["id"] },
    ]);

    const columns = await pool.query(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = current_schema()
      ORDER BY table_name, ordinal_position
    `);
    assert.deepEqual(columns.rows, expectedInitialColumns());

    const auditIndex = await pool.query(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = current_schema() AND indexname = 'import_rows_idempotency_key_idx'
    `);
    assert.equal(auditIndex.rowCount, 1);
    assert.equal(auditIndex.rows[0].indexdef.includes("UNIQUE"), false);

    const authIndexes = await pool.query(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = current_schema() AND indexname IN ('owners_singleton_idx', 'sessions_owner_id_idx')
      ORDER BY indexname
    `);
    assert.equal(authIndexes.rowCount, 2);
    assert.match(authIndexes.rows[0].indexdef, /UNIQUE/);

    await assert.rejects(
      pool.query("INSERT INTO owners (id, username, password_hash, created_at) VALUES ($1, 'Not-Normalized', 'hash', now())", [randomUUID()]),
      /check constraint/i,
    );
    await assert.rejects(
      pool.query("INSERT INTO login_attempts (scope_key, failed_count, window_started_at) VALUES ('raw-ip', -1, now())"),
      /check constraint/i,
    );

    const runId = randomUUID();
    await pool.query(`
      INSERT INTO import_runs (id, source_name, source_sha256, importer_version)
      VALUES ($1, 'fixture', 'hash', 'version')
    `, [runId]);
    await pool.query(`
      INSERT INTO import_rows (import_run_id, source_row, idempotency_key, classification, raw, record_kind)
      VALUES ($1, 1, 'duplicate-key', 'valid-current', '{}', 'snapshot'),
             ($1, 2, 'duplicate-key', 'result', '{}', 'result')
    `, [runId]);
    await assert.rejects(
      pool.query(`
        INSERT INTO import_rows (import_run_id, source_row, raw, record_kind)
        VALUES ($1, 3, '{}', 'unknown')
      `, [runId]),
      /check constraint/i,
    );

    await assert.rejects(
      pool.query("INSERT INTO prediction_snapshots (identity_key, odds, raw) VALUES ($1, $2, $3)", ["bad-zero-odds", 0, {}]),
      /check constraint/i,
    );
    await assert.rejects(
      pool.query("INSERT INTO prediction_snapshots (identity_key, odds, raw) VALUES ($1, $2, $3)", ["bad-infinite-odds", Number.POSITIVE_INFINITY, {}]),
      /check constraint/i,
    );
    await assert.rejects(
      pool.query("INSERT INTO prediction_snapshots (identity_key, odds, raw) VALUES ($1, $2, $3)", ["bad-nan-odds", Number.NaN, {}]),
      /check constraint/i,
    );
    await assert.rejects(
      pool.query("INSERT INTO prediction_snapshots (identity_key, chance, raw) VALUES ($1, $2, $3)", ["bad-chance", 1.01, {}]),
      /check constraint/i,
    );
    await assert.rejects(
      pool.query("INSERT INTO prediction_snapshots (identity_key, chance, raw) VALUES ($1, $2, $3)", ["bad-nan-chance", Number.NaN, {}]),
      /check constraint/i,
    );
    await assert.rejects(
      pool.query("INSERT INTO live_odds (identity_key, odds, raw) VALUES ($1, $2, $3)", ["bad-live-odds", Number.POSITIVE_INFINITY, {}]),
      /check constraint/i,
    );
    await assert.rejects(
      pool.query("INSERT INTO live_odds (identity_key, odds, raw) VALUES ($1, $2, $3)", ["bad-live-nan-odds", Number.NaN, {}]),
      /check constraint/i,
    );
  });
});

function expectedInitialColumns() {
  const timestamp = "timestamp with time zone";
  const definitions = {
    collector_state: [["state_key", "text", "NO"], ["state", "jsonb", "NO"], ["updated_at", timestamp, "NO"]],
    import_rows: [["import_run_id", "uuid", "NO"], ["source_row", "integer", "NO"], ["idempotency_key", "text", "YES"], ["classification", "text", "YES"], ["rejection_reason", "text", "YES"], ["raw", "jsonb", "NO"], ["record_kind", "text", "NO"]],
    import_runs: [["id", "uuid", "NO"], ["source_name", "text", "YES"], ["source_sha256", "text", "YES"], ["importer_version", "text", "YES"], ["status", "text", "YES"], ["total_rows", "integer", "YES"], ["accepted_rows", "integer", "YES"], ["rejected_rows", "integer", "YES"], ["started_at", timestamp, "YES"], ["finished_at", timestamp, "YES"]],
    live_odds: [["id", "bigint", "NO"], ["identity_key", "text", "NO"], ["entry_id", "text", "YES"], ["provider", "text", "YES"], ["match_id", "text", "YES"], ["home_team", "text", "YES"], ["away_team", "text", "YES"], ["commence_time", timestamp, "YES"], ["market", "text", "YES"], ["selection", "text", "YES"], ["line", "double precision", "YES"], ["odds", "double precision", "YES"], ["observed_at", timestamp, "YES"], ["expires_at", timestamp, "YES"], ["raw", "jsonb", "NO"]],
    login_attempts: [["scope_key", "text", "NO"], ["failed_count", "integer", "NO"], ["window_started_at", timestamp, "NO"], ["blocked_until", timestamp, "YES"]],
    owners: [["id", "uuid", "NO"], ["username", "text", "NO"], ["password_hash", "text", "NO"], ["disabled_at", timestamp, "YES"], ["created_at", timestamp, "NO"]],
    prediction_snapshots: [["id", "bigint", "NO"], ["identity_key", "text", "NO"], ["match_id", "text", "YES"], ["market", "text", "YES"], ["prediction", "text", "YES"], ["line", "double precision", "YES"], ["odds", "double precision", "YES"], ["chance", "double precision", "YES"], ["edge", "double precision", "YES"], ["saved_at", timestamp, "YES"], ["commence_time", timestamp, "YES"], ["model_version", "text", "YES"], ["source", "text", "YES"], ["snapshot_status", "text", "YES"], ["rejection_reason", "text", "YES"], ["raw", "jsonb", "NO"]],
    results: [["id", "bigint", "NO"], ["identity_key", "text", "NO"], ["match_id", "text", "YES"], ["market", "text", "YES"], ["actual", "text", "YES"], ["source", "text", "YES"], ["source_priority", "integer", "YES"], ["completed_at", timestamp, "YES"], ["raw", "jsonb", "NO"]],
    schema_migrations: [["version", "text", "NO"], ["checksum_sha256", "text", "NO"], ["applied_at", timestamp, "NO"]],
    sessions: [["id", "uuid", "NO"], ["owner_id", "uuid", "NO"], ["token_hash", "bytea", "NO"], ["csrf_hash", "bytea", "NO"], ["created_at", timestamp, "NO"], ["last_seen_at", timestamp, "NO"], ["idle_expires_at", timestamp, "NO"], ["absolute_expires_at", timestamp, "NO"], ["revoked_at", timestamp, "YES"]],
  };

  return Object.entries(definitions).flatMap(([table_name, tableColumns]) => (
    tableColumns.map(([column_name, data_type, is_nullable]) => ({ table_name, column_name, data_type, is_nullable }))
  ));
}

function requireDatabaseUrl() {
  assert.equal(
    DATABASE_URL === EXPECTED_TEST_DATABASE_URL,
    true,
    "DATABASE_URL must be the controller-provided disposable odds_test database",
  );
}

async function withIsolatedSchema(t, callback) {
  const adminPool = createPool(DATABASE_URL);
  const schema = `task2_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schema}"`;
  let pool;

  t.after(async () => {
    let firstError;
    try { if (pool) await pool.end(); } catch (error) { firstError = error; }
    try {
      assert.match(schema, /^task2_[0-9a-f]{32}$/);
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    } catch (error) { firstError ??= error; }
    try { await adminPool.end(); } catch (error) { firstError ??= error; }
    if (firstError) throw firstError;
  });

  await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);
  const scopedUrl = new URL(DATABASE_URL);
  scopedUrl.searchParams.set("options", `-c search_path=${schema}`);
  pool = createPool(scopedUrl.toString());

  await callback(pool);
}

async function withTempMigrations(files, callback) {
  const directory = await mkdtemp(path.join(tmpdir(), "odds-migrations-"));
  try {
    for (const [filename, contents] of files) {
      await writeFile(path.join(directory, filename), contents, "utf8");
    }
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
