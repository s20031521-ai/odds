import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { runMigrations } from "../../server/db/migrate.mjs";
import { createPool } from "../../server/db/pool.mjs";
import { createOddsRepository } from "../../server/db/odds-repository.mjs";
import { createPostgresSink } from "./postgres-sink.mjs";

const DATABASE_URL = process.env.DATABASE_URL;
const EXPECTED_DATABASE_URL = "postgresql://odds_test:odds_test@127.0.0.1:55432/odds_test";
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, "db", "migrations");
const UUID_SCHEMA = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("postgres sink persists collector state and excludes concurrent named cycles", async (t) => {
  await withDatabase(t, async (pool) => {
    const first = createPostgresSink({ pool });
    const second = createPostgresSink({ pool });

    const outcome = await first.acquireCollectorLock("hkjc", async () => {
      assert.equal(await second.acquireCollectorLock("hkjc", async () => "should-not-run"), "busy");
      await first.saveCollectorState("hkjc", { page: 1, nested: { ok: true } });
      return "done";
    });

    assert.equal(outcome, "ran");
    assert.deepEqual(await second.loadCollectorState("hkjc"), { page: 1, nested: { ok: true } });
    assert.equal(await second.acquireCollectorLock("hkjc", async () => "after-release"), "ran");
  });
});

test("postgres sink writes immutable snapshots and source-priority results", async (t) => {
  await withDatabase(t, async (pool) => {
    const sink = createPostgresSink({ pool });
    const snapshot = currentSnapshot();

    assert.deepEqual(await sink.saveSnapshots([snapshot, { ...snapshot, odds: 9 }]), {
      inserted: 1,
      duplicate: 1,
      rejected: 0,
      rejectedByReason: {},
    });
    assert.deepEqual(await sink.saveSnapshots([{ ...snapshot, matchId: "invalid", odds: Number.NaN }]), {
      inserted: 0,
      duplicate: 0,
      rejected: 1,
      rejectedByReason: { "invalid-odds": 1 },
    });

    assert.deepEqual(await sink.saveResults([
      result({ actual: "home", sourcePriority: 10 }),
      result({ actual: "away", sourcePriority: 5 }),
      result({ actual: "draw", sourcePriority: 30 }),
    ]), { inserted: 1, updated: 1, ignored: 1 });

    const rows = await pool.query("SELECT raw FROM prediction_snapshots ORDER BY match_id");
    assert.deepEqual(rows.rows.map((row) => row.raw), [snapshot]);

    const resultRows = await pool.query("SELECT raw FROM results ORDER BY match_id");
    assert.deepEqual(resultRows.rows.map((row) => row.raw), [result({ actual: "draw", sourcePriority: 30 })]);
  });
});

test("postgres sink replaces only the requested provider live odds and rolls back failed replacements", async (t) => {
  await withDatabase(t, async (pool) => {
    const sink = createPostgresSink({ pool });
    const odds = createOddsRepository(pool);
    const observedAt = "2026-07-18T10:00:00.000Z";
    const providerAFirst = liveEntry({ id: "a1", matchId: "match-a", odds: 1.9 });
    const providerASecond = liveEntry({ id: "a2", matchId: "match-a2", odds: 2.1 });
    const providerB = liveEntry({ id: "b1", matchId: "match-b", odds: 2.5 });

    await sink.saveLiveOdds("provider-a", observedAt, [providerAFirst]);
    await sink.saveLiveOdds("provider-b", observedAt, [providerB]);
    await sink.saveLiveOdds("provider-a", observedAt, [providerASecond]);

    assert.deepEqual(sortById(await odds.listLive("2026-07-18T10:30:00.000Z")), sortById([
      { ...providerASecond, provider: "provider-a", observedAt },
      { ...providerB, provider: "provider-b", observedAt },
    ]));

    await assert.rejects(
      sink.saveLiveOdds("provider-a", observedAt, [{ ...providerASecond, id: "bad", odds: Number.NaN }]),
      /positive finite odds/,
    );
    assert.deepEqual(sortById(await odds.listLive("2026-07-18T10:30:00.000Z")), sortById([
      { ...providerASecond, provider: "provider-a", observedAt },
      { ...providerB, provider: "provider-b", observedAt },
    ]));
  });
});

test("postgres sink exposes the unified live-read, fixture-resolution, and evaluation pipeline", async (t) => {
  await withDatabase(t, async (pool) => {
    const sink = createPostgresSink({ pool });
    const observedAt = "2026-07-18T10:00:00.000Z";
    await sink.saveLiveOdds("provider-a", observedAt, [liveEntry({
      provider: "spoofed",
      bookmaker: "Book A",
      observedAt: "1999-01-01T00:00:00.000Z",
    })]);

    const liveRows = await sink.listLiveOdds("2026-07-18T10:30:00.000Z");
    assert.equal(liveRows.length, 1);
    assert.equal(liveRows[0].provider, "provider-a");
    assert.equal(liveRows[0].observedAt, observedAt);
    const resolved = await sink.resolveFixtures(liveRows);
    assert.equal(resolved.fixtures.length, 1);
    assert.match(resolved.fixtures[0].fixtureId, UUID_SCHEMA);

    const opportunity = {
      fixtureId: resolved.fixtures[0].fixtureId,
      matchId: liveRows[0].matchId,
      homeTeam: liveRows[0].homeTeam,
      awayTeam: liveRows[0].awayTeam,
      commenceTime: liveRows[0].commenceTime,
      strategyVersion: "unified-buyable-v1",
      modelVersion: "totals-loo-v1",
      market: "totals",
      selection: "over",
      line: 2.5,
      quotes: [{
        bookmaker: "Book A",
        provider: "provider-a",
        odds: 2.1,
        chance: 0.51,
        edge: 0.071,
        minimumBuyOdds: 2.02,
        observedAt,
      }],
    };
    assert.deepEqual(await sink.recordRecommendationEvaluation({
      evaluatedAt: "2026-07-18T10:30:00.000Z",
      inputs: resolved.fixtures,
      opportunities: [opportunity],
    }), {
      samplesInserted: 1,
      samplesUpdated: 0,
      observationsInserted: 1,
      observationsExtended: 0,
      skipped: 0,
    });
    assert.equal((await pool.query("SELECT 1 FROM recommendation_observations")).rowCount, 1);
  });
});

test("postgres sink source contains no JSON or JSONL file writes", () => {
  const source = readFileSync(path.join(PROJECT_ROOT, "scripts", "lib", "postgres-sink.mjs"), "utf8");

  assert.equal(source.includes("writeFile"), false);
  assert.equal(source.includes("appendFile"), false);
  assert.equal(source.includes("createWriteStream"), false);
  assert.equal(source.includes(".jsonl"), false);
});

function currentSnapshot(overrides = {}) {
  return {
    matchId: "sink-match-1",
    market: "大細波",
    prediction: "大",
    line: 2.5,
    odds: 2.05,
    chance: 0.58,
    edge: 0.05,
    savedAt: "2026-07-18T10:00:00.000Z",
    commenceTime: "2026-07-18T12:00:00.000Z",
    modelVersion: "sink-test-v1",
    source: "sink-test",
    ...overrides,
  };
}

function result(overrides = {}) {
  return {
    matchId: "sink-match-1",
    market: "大細波",
    actual: "大",
    score: "3-1",
    source: "sink-result",
    sourcePriority: 10,
    completedAt: "2026-07-18T14:00:00.000Z",
    ...overrides,
  };
}

function liveEntry(overrides = {}) {
  return {
    id: "live-1",
    matchId: "live-match-1",
    homeTeam: "Home",
    awayTeam: "Away",
    commenceTime: "2026-07-18T12:00:00.000Z",
    market: "totals",
    selection: "over",
    line: 2.5,
    odds: 1.95,
    expiresAt: "2026-07-18T11:00:00.000Z",
    ...overrides,
  };
}

function sortById(rows) {
  return [...rows].sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

async function withDatabase(t, callback) {
  requireDatabaseUrl();
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
  await callback(pool);
}

function requireDatabaseUrl() {
  assert.equal(DATABASE_URL, EXPECTED_DATABASE_URL, "DATABASE_URL must exactly match the disposable odds_test database");
}

function quoteOwnedSchema(schema) {
  assert.match(schema, UUID_SCHEMA, "refusing to use a schema that is not this test's generated UUID");
  return `"${schema}"`;
}
