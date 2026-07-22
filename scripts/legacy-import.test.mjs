import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import pg from "pg";

import { createPool } from "../server/db/pool.mjs";
import { runMigrations } from "../server/db/migrate.mjs";
import { createOpportunityRepository } from "../server/db/opportunity-repository.mjs";
import { importLegacyArchives } from "./import-legacy-to-postgres.mjs";
import { checkPostgresParity } from "./check-postgres-parity.mjs";

const DATABASE_URL = process.env.DATABASE_URL;
const EXPECTED_DATABASE_URL = "postgresql://odds_test:odds_test@127.0.0.1:55432/odds_test";
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, "db", "migrations");
const UUID_SCHEMA = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const current = (overrides = {}) => ({
  matchId: "current-1", market: "moneyline", prediction: "home", odds: 2,
  chance: 0.6, edge: 0.1, savedAt: "2026-07-18T10:00:00Z",
  commenceTime: "2026-07-18T12:00:00Z", modelVersion: "fixture-v1", source: "fixture",
  ...overrides,
});
const result = (overrides = {}) => ({
  matchId: "current-1", market: "moneyline", actual: "home", source: "low",
  sourcePriority: 10, completedAt: "2026-07-18T13:00:00Z", ...overrides,
});

test("imports every physical row into an idempotent audit ledger and preserves source bytes", async (t) => {
  await withDatabase(t, async (pool) => {
    const root = await fixtureRoot(t, {
      "data/prediction-snapshots.jsonl": [
        current(),
        { matchId: "legacy-1", market: "moneyline", prediction: "away", savedAt: "2026-07-17T10:00:00Z" },
        current({ matchId: "invalid-1", odds: 1 }),
        current({ prediction: "duplicate-does-not-replace" }),
      ],
      "data/background-hdc-snapshots.jsonl": [
        current({ prediction: "cross-file-duplicate" }),
        current({ matchId: "current-2", prediction: "away" }),
      ],
      "data/result-archive.jsonl": [
        result(),
        result({ actual: "away", source: "high", sourcePriority: 20 }),
        result({ matchId: "current-2", actual: "away" }),
      ],
      "data/background-result-archive.jsonl": [result({ actual: "draw", sourcePriority: 5 })],
    }, { blankAfterFirst: true });
    const before = await sourceHashes(root);

    const first = await importLegacyArchives({ pool, sourceRoot: root });
    assert.deepEqual(first.totals, {
      sourceRows: 10, auditRowsAdded: 10, snapshotInserted: 3, snapshotDuplicate: 2,
      snapshotRejected: 1, resultRejected: 0, resultInserted: 2, resultUpdated: 1, resultIgnored: 1,
    });
    assert.deepEqual(await sourceHashes(root), before);

    const audit = await pool.query(`
      SELECT run.source_name, ir.record_kind, ir.source_row, ir.idempotency_key, ir.classification, ir.rejection_reason
      FROM import_rows ir JOIN import_runs run ON run.id = ir.import_run_id
      ORDER BY run.source_name, ir.source_row
    `);
    assert.equal(audit.rowCount, 10);
    assert.equal(audit.rows.filter(({ record_kind }) => record_kind === "snapshot").length, 6);
    assert.equal(audit.rows.filter(({ record_kind }) => record_kind === "result").length, 4);
    assert.equal(new Set(audit.rows.map(({ idempotency_key }) => idempotency_key)).size < 10, true);
    assert.deepEqual(
      audit.rows.filter(({ source_name }) => source_name === "data/prediction-snapshots.jsonl").map(({ classification, rejection_reason }) => [classification, rejection_reason]),
      [["valid-current", null], ["legacy", "legacy-model"], ["invalid", "invalid-odds"], ["valid-current", null]],
    );
    assert.deepEqual(
      audit.rows.filter(({ source_name }) => source_name === "data/prediction-snapshots.jsonl").map(({ source_row }) => source_row),
      [1, 3, 4, 5],
      "physical line numbers include blank lines",
    );

    await pool.query(`
      CREATE FUNCTION reject_completed_run_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'completed run must not update'; END $$
    `);
    await pool.query(`
      CREATE TRIGGER reject_completed_run_update BEFORE UPDATE ON import_runs
      FOR EACH ROW WHEN (OLD.status = 'complete') EXECUTE FUNCTION reject_completed_run_update()
    `);
    await pool.query("CREATE TABLE run_insert_probe (statement_count int NOT NULL DEFAULT 0, row_count int NOT NULL DEFAULT 0)");
    await pool.query("INSERT INTO run_insert_probe DEFAULT VALUES");
    await pool.query(`CREATE FUNCTION count_run_insert_statement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE run_insert_probe SET statement_count=statement_count+1; RETURN NULL; END $$`);
    await pool.query(`CREATE FUNCTION count_run_insert_row() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE run_insert_probe SET row_count=row_count+1; RETURN NEW; END $$`);
    await pool.query("CREATE TRIGGER count_run_insert_statement BEFORE INSERT ON import_runs FOR EACH STATEMENT EXECUTE FUNCTION count_run_insert_statement()");
    await pool.query("CREATE TRIGGER count_run_insert_row BEFORE INSERT ON import_runs FOR EACH ROW EXECUTE FUNCTION count_run_insert_row()");
    const second = await importLegacyArchives({ pool, sourceRoot: root });
    assert.deepEqual(second.totals, {
      sourceRows: 10, auditRowsAdded: 0, snapshotInserted: 0, snapshotDuplicate: 0,
      snapshotRejected: 0, resultRejected: 0, resultInserted: 0, resultUpdated: 0, resultIgnored: 0,
    });
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM import_rows")).rows[0].count, 10);
    assert.deepEqual((await pool.query("SELECT statement_count, row_count FROM run_insert_probe")).rows, [{ statement_count: 0, row_count: 0 }]);
    assert.deepEqual(await sourceHashes(root), before);

    const fixtureId = randomUUID();
    await pool.query(`
      INSERT INTO fixtures (id, home_team, away_team, normalized_home_team, normalized_away_team, commence_time)
      VALUES ($1, 'Unified Home', 'Unified Away', 'unified home', 'unified away', '2026-07-19T12:00:00Z')
    `, [fixtureId]);
    await createOpportunityRepository(pool).recordEvaluation({
      evaluatedAt: "2026-07-19T10:00:00Z",
      inputs: [],
      opportunities: [{
        fixtureId,
        matchId: "unified-1",
        homeTeam: "Unified Home",
        awayTeam: "Unified Away",
        commenceTime: "2026-07-19T12:00:00Z",
        market: "h2h",
        selection: "home",
        modelVersion: "consensus-v1",
        strategyVersion: "unified-buyable-v1",
        quotes: [{ bookmaker: "Book", provider: "fixture", odds: 2.1, chance: 0.55, edge: 0.155, minimumBuyOdds: 1.88, observedAt: "2026-07-19T09:59:00Z" }],
      }],
    });

    const parity = await checkPostgresParity({ pool, sourceRoot: root, now: Date.parse("2026-07-18T14:00:00Z") });
    assert.equal(parity.status, "ok");
    assert.equal(parity.snapshotRows, 6);
    assert.equal(parity.resultRows, 4);
    assert.equal(parity.strategyRows, 4);
    assert.equal(parity.legacyStrategyRows, 3);
    assert.equal(parity.unifiedStrategyRows, 1);
    assert.equal(parity.observationRows, 1);

    const reversedRepositoryPool = {
      connect: (...args) => pool.connect(...args),
      async query(sql, parameters) {
        const response = await pool.query(sql, parameters);
        if (/FROM\s+(prediction_snapshots|results)/i.test(String(sql))) response.rows.reverse();
        return response;
      },
    };
    assert.equal(
      (await checkPostgresParity({ pool: reversedRepositoryPool, sourceRoot: root, now: Date.parse("2026-07-18T14:00:00Z") })).status,
      "ok",
      "parity is independent of unordered repository query rows",
    );

    await pool.query(`
      UPDATE prediction_snapshots
      SET raw = jsonb_set(raw, '{prediction}', '"corrupted"'::jsonb)
      WHERE snapshot_status = 'legacy'
    `);
    await assert.rejects(
      checkPostgresParity({ pool, sourceRoot: root, now: Date.parse("2026-07-18T14:00:00Z") }),
      /parity mismatch: snapshot domain representatives/,
    );
  });
});

test("a failed file rolls back domain and audit rows, records failure, and retries the same identity", async (t) => {
  await withDatabase(t, async (pool, scopedUrl) => {
    const maxOnePool = new pg.Pool({ connectionString: scopedUrl, max: 1 });
    t.after(() => maxOnePool.end());
    const root = await fixtureRoot(t, {
      "data/prediction-snapshots.jsonl": [current({ matchId: "retry-1" }), current({ matchId: "fail-once" })],
      "data/background-hdc-snapshots.jsonl": [],
      "data/result-archive.jsonl": [],
      "data/background-result-archive.jsonl": [],
    });
    let releasedWith;
    const cleanupOrder = [];
    const clientSideFailure = new Error("injected client-side import failure");
    const rollbackFailure = new Error("injected rollback failure");
    const rollbackFailingPool = {
      async query(sql, parameters) {
        if (/SET status = 'failed'/.test(String(sql))) {
          cleanupOrder.push("status");
          if (!releasedWith) throw new Error("status update attempted before uncertain client release");
        }
        return maxOnePool.query(sql, parameters);
      },
      async connect() {
        const client = await maxOnePool.connect();
        let auditInserts = 0;
        return {
          async query(sql, parameters) {
            if (sql === "ROLLBACK") throw rollbackFailure;
            if (/INSERT INTO import_rows/.test(String(sql)) && ++auditInserts === 2) throw clientSideFailure;
            return client.query(sql, parameters);
          },
          release(error) {
            releasedWith = error;
            cleanupOrder.push("release");
            client.release(error);
          },
        };
      },
    };
    await assert.rejects(importLegacyArchives({ pool: rollbackFailingPool, sourceRoot: root }), (error) => {
      assert.equal(error, clientSideFailure);
      assert.equal(error.rollbackError, rollbackFailure);
      return true;
    });
    assert.equal(releasedWith, rollbackFailure);
    assert.deepEqual(cleanupOrder, ["release", "status"]);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM prediction_snapshots")).rows[0].count, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM import_rows")).rows[0].count, 0);
    assert.equal((await pool.query("SELECT status FROM import_runs WHERE source_name = 'data/prediction-snapshots.jsonl'")).rows[0].status, "failed");

    const retry = await importLegacyArchives({ pool, sourceRoot: root });
    assert.equal(retry.totals.snapshotInserted, 2);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM import_rows")).rows[0].count, 2);
    assert.equal((await pool.query("SELECT status FROM import_runs WHERE source_name = 'data/prediction-snapshots.jsonl'")).rows[0].status, "complete");
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM import_runs WHERE source_name = 'data/prediction-snapshots.jsonl'")).rows[0].count, 1);
  });
});

test("malformed nonblank JSON records one reusable failed run without audit or domain rows", async (t) => {
  await withDatabase(t, async (pool) => {
    const root = await fixtureRoot(t, {
      "data/prediction-snapshots.jsonl": [current({ matchId: "before-malformed" })],
      "data/background-hdc-snapshots.jsonl": [],
      "data/result-archive.jsonl": [],
      "data/background-result-archive.jsonl": [],
    });
    const filename = path.join(root, "data", "prediction-snapshots.jsonl");
    const validBytes = await readFile(filename, "utf8");
    await writeFile(filename, `${validBytes}{malformed}\n`, "utf8");

    const statusFailure = new Error("injected parse-status failure");
    const statusFailingPool = {
      connect: (...args) => pool.connect(...args),
      async query(sql, parameters) {
        if (/SET status = 'failed'/.test(String(sql))) throw statusFailure;
        return pool.query(sql, parameters);
      },
    };
    await assert.rejects(importLegacyArchives({ pool: statusFailingPool, sourceRoot: root }), (error) => {
      assert.match(error.message, /:2 contains malformed JSON/);
      assert.equal(error.statusUpdateError, statusFailure);
      return true;
    });
    await assert.rejects(importLegacyArchives({ pool, sourceRoot: root }), /:2 contains malformed JSON/);
    assert.deepEqual(
      (await pool.query("SELECT status, total_rows FROM import_runs")).rows,
      [{ status: "failed", total_rows: 2 }],
    );
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM import_rows")).rows[0].count, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM prediction_snapshots")).rows[0].count, 0);
  });
});

test("concurrent same-file callers execute domain and audit work once", async (t) => {
  await withDatabase(t, async (pool) => {
    const root = await fixtureRoot(t, {
      "data/prediction-snapshots.jsonl": [current({ matchId: "race" })],
      "data/background-hdc-snapshots.jsonl": [], "data/result-archive.jsonl": [], "data/background-result-archive.jsonl": [],
    });
    const outcomes = await Promise.all([importLegacyArchives({ pool, sourceRoot: root }), importLegacyArchives({ pool, sourceRoot: root })]);
    assert.equal(outcomes.reduce((sum, row) => sum + row.totals.auditRowsAdded, 0), 1);
    assert.equal(outcomes.reduce((sum, row) => sum + row.totals.snapshotInserted, 0), 1);
    assert.equal((await pool.query("SELECT count(*)::int count FROM import_rows")).rows[0].count, 1);
  });
});

test("ambiguous COMMIT destroys the client and retry observes committed completion", async (t) => {
  await withDatabase(t, async (pool) => {
    const root = await fixtureRoot(t, {
      "data/prediction-snapshots.jsonl": [current({ matchId: "ambiguous" })],
      "data/background-hdc-snapshots.jsonl": [], "data/result-archive.jsonl": [], "data/background-result-archive.jsonl": [],
    });
    const ambiguous = new Error("injected lost commit response");
    let injected = false;
    let releasedWith;
    const wrapper = {
      query: (...args) => pool.query(...args),
      async connect() {
        const client = await pool.connect();
        return {
          async query(sql, parameters) {
            const result = await client.query(sql, parameters);
            if (sql === "COMMIT" && !injected) { injected = true; throw ambiguous; }
            return result;
          },
          release(error) { releasedWith = error; client.release(error); },
        };
      },
    };
    await assert.rejects(importLegacyArchives({ pool: wrapper, sourceRoot: root }), ambiguous);
    assert.equal(releasedWith, ambiguous);
    assert.deepEqual((await pool.query("SELECT status FROM import_runs")).rows, [{ status: "complete" }]);
    const retry = await importLegacyArchives({ pool, sourceRoot: root });
    assert.equal(retry.files[0].status, "already-complete");
    assert.equal((await pool.query("SELECT count(*)::int count FROM import_rows")).rows[0].count, 1);
  });
});

test("valid JSON primitives are audited exactly and rejected from both domains", async (t) => {
  await withDatabase(t, async (pool) => {
    const primitives = [null, "text", 42, [1, 2]];
    const root = await fixtureRoot(t, {
      "data/prediction-snapshots.jsonl": primitives,
      "data/background-hdc-snapshots.jsonl": [],
      "data/result-archive.jsonl": primitives,
      "data/background-result-archive.jsonl": [],
    });
    const imported = await importLegacyArchives({ pool, sourceRoot: root });
    assert.equal(imported.totals.snapshotRejected, 4);
    assert.equal(imported.totals.resultRejected, 4);
    const audit = await pool.query("SELECT raw, classification, rejection_reason FROM import_rows ORDER BY record_kind, source_row");
    assert.equal(audit.rowCount, 8);
    assert.ok(audit.rows.every((row) => row.classification === "invalid"));
    assert.deepEqual(audit.rows.slice(0, 4).map((row) => row.raw), primitives);
    assert.deepEqual(audit.rows.slice(4).map((row) => row.raw), primitives);
    assert.equal((await pool.query("SELECT count(*)::int count FROM prediction_snapshots")).rows[0].count, 0);
    assert.equal((await pool.query("SELECT count(*)::int count FROM results")).rows[0].count, 0);
    const primitiveParity = await checkPostgresParity({ pool, sourceRoot: root });
    assert.equal(primitiveParity.status, "ok");
    assert.deepEqual({ snapshotInvalid: primitiveParity.snapshotInvalid, resultRejected: primitiveParity.resultRejected }, { snapshotInvalid: 4, resultRejected: 4 });
  });
});

test("resolved allowlisted paths cannot escape source root", async (t) => {
  const root = await fixtureRoot(t, {
    "data/prediction-snapshots.jsonl": [], "data/background-hdc-snapshots.jsonl": [],
    "data/result-archive.jsonl": [], "data/background-result-archive.jsonl": [],
  });
  const outside = await mkdtemp(path.join(os.tmpdir(), "odds-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const target = path.join(root, "data", "prediction-snapshots.jsonl");
  const escaped = path.join(outside, "escaped.jsonl");
  await writeFile(escaped, "\n", "utf8");
  await unlink(target);
  try { await symlink(escaped, target, "file"); }
  catch (error) { if (error.code === "EPERM") return t.skip("symlink privilege unavailable"); throw error; }
  await assert.rejects(importLegacyArchives({ pool: { query() {}, connect() {} }, sourceRoot: root }), /containment failed/);
});

async function fixtureRoot(t, files, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "odds-import-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [relative, rows] of Object.entries(files)) {
    const filename = path.join(root, ...relative.split("/"));
    await mkdir(path.dirname(filename), { recursive: true });
    const lines = rows.map((row) => JSON.stringify(row));
    if (options.blankAfterFirst && lines.length > 1) lines.splice(1, 0, "");
    await writeFile(filename, `${lines.join("\n")}${lines.length ? "\n" : ""}`, "utf8");
  }
  return root;
}

async function sourceHashes(root) {
  const relatives = [
    "data/prediction-snapshots.jsonl", "data/background-hdc-snapshots.jsonl",
    "data/result-archive.jsonl", "data/background-result-archive.jsonl",
  ];
  return Object.fromEntries(await Promise.all(relatives.map(async (relative) => {
    const bytes = await readFile(path.join(root, ...relative.split("/")));
    return [relative, createHash("sha256").update(bytes).digest("hex")];
  })));
}

async function withDatabase(t, callback) {
  assert.equal(DATABASE_URL, EXPECTED_DATABASE_URL, "DATABASE_URL must exactly match the disposable odds_test database");
  const schema = randomUUID();
  assert.match(schema, UUID_SCHEMA);
  const quoted = `"${schema}"`;
  const admin = createPool(DATABASE_URL);
  let pool;
  t.after(async () => {
    let firstError;
    try { if (pool) await pool.end(); } catch (error) { firstError = error; }
    try { assert.match(schema, UUID_SCHEMA); await admin.query(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`); } catch (error) { firstError ??= error; }
    try { await admin.end(); } catch (error) { firstError ??= error; }
    if (firstError) throw firstError;
  });
  await admin.query(`CREATE SCHEMA ${quoted}`);
  const scoped = new URL(DATABASE_URL);
  scoped.searchParams.set("options", `-c search_path=${quoted}`);
  pool = createPool(scoped.toString());
  await runMigrations(pool, MIGRATIONS_DIR);
  await callback(pool, scoped.toString());
}
