import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createPool } from "./pool.mjs";
import { runMigrations } from "./migrate.mjs";
import { createCollectorStateRepository } from "./collector-state-repository.mjs";
import { createOddsRepository } from "./odds-repository.mjs";
import { createResultRepository } from "./result-repository.mjs";
import { createSnapshotRepository } from "./snapshot-repository.mjs";
import { resultIdentity } from "../domain/identity.mjs";

const DATABASE_URL = process.env.DATABASE_URL;
const EXPECTED_DATABASE_URL = "postgresql://odds_test:odds_test@127.0.0.1:55432/odds_test";
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, "db", "migrations");
const UUID_SCHEMA = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function currentSnapshot(overrides = {}) {
  return {
    matchId: "match-1",
    market: "moneyline",
    prediction: "home",
    odds: 2.05,
    chance: 0.61,
    edge: 0.04,
    savedAt: "2026-07-18T10:00:00.000Z",
    commenceTime: "2026-07-18T12:00:00.000Z",
    modelVersion: "model-v1",
    source: "test-source",
    nested: { exact: "caller value" },
    ...overrides,
  };
}

function result(overrides = {}) {
  return {
    matchId: "match-1",
    market: "moneyline",
    actual: "home",
    source: "provider-low",
    sourcePriority: 10,
    completedAt: "2026-07-18T13:00:00.000Z",
    nested: { exact: "result value" },
    ...overrides,
  };
}

function liveEntry(overrides = {}) {
  return {
    id: "entry-1",
    matchId: "match-1",
    homeTeam: "Home",
    awayTeam: "Away",
    commenceTime: "2026-07-18T12:00:00.000Z",
    market: "totals",
    selection: "over",
    line: 2.25,
    odds: 1.98,
    expiresAt: "2026-07-18T11:00:00.000Z",
    nested: { exact: "odds value" },
    ...overrides,
  };
}

test("snapshot insert is immutable, versioned, idempotent, and partially rejects invalid rows", async (t) => {
  await withDatabase(t, async (pool) => {
    const repository = createSnapshotRepository(pool);
    const first = currentSnapshot();
    const duplicateWithLaterSave = { ...first, odds: 9, savedAt: "2026-07-18T10:30:00.000Z" };
    const newVersion = { ...first, odds: 2.2, modelVersion: "model-v2" };
    const legacy = {
      matchId: "legacy-1",
      market: "moneyline",
      prediction: "away",
      savedAt: "2026-07-17T10:00:00.000Z",
      source: "legacy-source",
      legacyText: "preserve exactly",
    };
    const invalid = { ...first, matchId: "invalid-1", odds: Number.NaN };

    assert.deepEqual(await repository.insertBatch([first, duplicateWithLaterSave, newVersion, legacy, invalid]), {
      inserted: 3,
      duplicate: 1,
      rejected: 1,
      rejectedByReason: { "invalid-odds": 1 },
    });
    assert.deepEqual(await repository.insertBatch([first, newVersion, invalid]), {
      inserted: 0,
      duplicate: 2,
      rejected: 1,
      rejectedByReason: { "invalid-odds": 1 },
    });

    const all = await repository.listAll();
    assert.equal(all.length, 3);
    assert.deepEqual(all.find((row) => row.modelVersion === "model-v1"), first);
    assert.deepEqual(all.find((row) => row.modelVersion === "model-v2"), newVersion);
    assert.deepEqual(all.find((row) => row.matchId === "legacy-1"), legacy);
    assert.deepEqual(
      (await repository.listCurrent()).sort((left, right) => left.modelVersion.localeCompare(right.modelVersion)),
      [first, newVersion].sort((left, right) => left.modelVersion.localeCompare(right.modelVersion)),
    );
    assert.equal(all.some((row) => row.matchId === "invalid-1"), false);
  });
});

test("concurrent snapshot inserts keep exactly one first writer", async (t) => {
  await withDatabase(t, async (pool) => {
    const repository = createSnapshotRepository(pool);
    const candidates = Array.from({ length: 12 }, (_, index) => currentSnapshot({ odds: 2 + index / 100 }));
    const outcomes = await Promise.all(candidates.map((candidate) => repository.insertBatch([candidate])));

    assert.equal(outcomes.reduce((sum, outcome) => sum + outcome.inserted, 0), 1);
    assert.equal(outcomes.reduce((sum, outcome) => sum + outcome.duplicate, 0), 11);
    const stored = await repository.listAll();
    assert.equal(stored.length, 1);
    assert.equal(candidates.some((candidate) => candidate.odds === stored[0].odds), true);
  });
});

test("legacy rows with malformed typed projections preserve raw JSON without rolling back valid rows", async (t) => {
  await withDatabase(t, async (pool) => {
    const repository = createSnapshotRepository(pool);
    const valid = currentSnapshot({ matchId: "valid-alongside-legacy" });
    const legacy = {
      matchId: "malformed-legacy",
      market: "moneyline",
      prediction: "away",
      savedAt: "not-a-date",
      commenceTime: "also-not-a-date",
      odds: -4,
      chance: 3,
      edge: "not-a-number",
      source: "legacy-source",
      nested: { exact: "malformed projections remain raw" },
    };

    assert.deepEqual(await repository.insertBatch([valid, legacy]), {
      inserted: 2,
      duplicate: 0,
      rejected: 0,
      rejectedByReason: {},
    });
    assert.deepEqual(
      (await repository.listAll()).sort((left, right) => left.matchId.localeCompare(right.matchId)),
      [valid, legacy].sort((left, right) => left.matchId.localeCompare(right.matchId)),
    );
    assert.deepEqual(await repository.listCurrent(), [valid]);
  });
});

test("results update only for strictly higher source priority, including concurrent writers", async (t) => {
  await withDatabase(t, async (pool) => {
    const repository = createResultRepository(pool);
    const low = result();
    const equal = result({ actual: "draw", source: "provider-equal" });
    const lower = result({ actual: "away", sourcePriority: 5, source: "provider-lower" });
    const high = result({ actual: "away", sourcePriority: 20, source: "provider-high", nested: { exact: "higher wins" } });

    assert.deepEqual(await repository.upsertBatch([low]), { inserted: 1, updated: 0, ignored: 0 });
    assert.deepEqual(await repository.upsertBatch([equal, lower]), { inserted: 0, updated: 0, ignored: 2 });
    assert.deepEqual(await repository.upsertBatch([high]), { inserted: 0, updated: 1, ignored: 0 });
    assert.deepEqual(await repository.listAll(), [high]);

    const concurrent = Array.from({ length: 10 }, (_, index) => result({
      matchId: "concurrent-result",
      actual: `priority-${index}`,
      sourcePriority: index,
    }));
    await Promise.all(concurrent.map((row) => repository.upsertBatch([row])));
    assert.deepEqual((await repository.listAll()).find((row) => row.matchId === "concurrent-result"), concurrent.at(-1));
  });
});

test("a numeric result priority updates a directly stored NULL priority", async (t) => {
  await withDatabase(t, async (pool) => {
    const repository = createResultRepository(pool);
    const seeded = result({ matchId: "null-priority", actual: "seeded-null", sourcePriority: undefined });
    const incoming = result({ matchId: "null-priority", actual: "numeric-wins", sourcePriority: -100 });
    await pool.query(`
      INSERT INTO results (
        identity_key, match_id, market, actual, source,
        source_priority, completed_at, raw
      ) VALUES ($1, $2, $3, $4, $5, NULL, $6, $7)
    `, [
      resultIdentity(seeded),
      seeded.matchId,
      seeded.market,
      seeded.actual,
      seeded.source,
      seeded.completedAt,
      seeded,
    ]);

    assert.deepEqual(await repository.upsertBatch([incoming]), { inserted: 0, updated: 1, ignored: 0 });
    assert.deepEqual((await repository.listAll()).find((row) => row.matchId === incoming.matchId), incoming);
  });
});

test("snapshot and result repositories participate in an existing client transaction", async (t) => {
  await withDatabase(t, async (pool) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const snapshots = createSnapshotRepository(client);
      const results = createResultRepository(client);
      assert.deepEqual(await snapshots.insertBatch([currentSnapshot({ matchId: "client-rollback" })]), {
        inserted: 1,
        duplicate: 0,
        rejected: 0,
        rejectedByReason: {},
      });
      assert.deepEqual(await results.upsertBatch([result({ matchId: "client-rollback" })]), {
        inserted: 1,
        updated: 0,
        ignored: 0,
      });
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    assert.equal((await createSnapshotRepository(pool).listAll()).length, 0);
    assert.equal((await createResultRepository(pool).listAll()).length, 0);
  });
});

test("live odds replacement is provider-scoped, allows an empty clear, and excludes expiry boundaries", async (t) => {
  await withDatabase(t, async (pool) => {
    const repository = createOddsRepository(pool);
    const observedAt = "2026-07-18T10:00:00.000Z";
    const p1First = liveEntry({ id: "p1-old" });
    const p2 = liveEntry({ id: "p2", matchId: "match-2", selection: "away" });

    await repository.replaceProviderSnapshot("provider-1", observedAt, [p1First]);
    await repository.replaceProviderSnapshot("provider-2", observedAt, [p2]);
    const replacement = liveEntry({ id: "p1-new", selection: "under", line: null });
    const expiresAtBoundary = liveEntry({ id: "p1-boundary", matchId: "match-3", expiresAt: "2026-07-18T10:30:00.000Z" });
    await repository.replaceProviderSnapshot("provider-1", "2026-07-18T10:15:00.000Z", [replacement, expiresAtBoundary]);

    assert.deepEqual(
      (await repository.listLive("2026-07-18T10:30:00.000Z")).sort((left, right) => left.id.localeCompare(right.id)),
      [replacement, p2].sort((left, right) => left.id.localeCompare(right.id)),
    );
    await repository.replaceProviderSnapshot("provider-1", "2026-07-18T10:31:00.000Z", []);
    assert.deepEqual(await repository.listLive("2026-07-18T10:31:00.000Z"), [p2]);
  });
});

test("live odds from multiple bookmakers for the same match coexist in one provider snapshot", async (t) => {
  await withDatabase(t, async (pool) => {
    const repository = createOddsRepository(pool);
    const bet365 = liveEntry({ id: "m1:home:bet365", market: "h2h", selection: "home", line: null, bookmaker: "Bet365", odds: 2.1 });
    const pinnacle = liveEntry({ id: "m1:home:pinnacle", market: "h2h", selection: "home", line: null, bookmaker: "Pinnacle", odds: 2.2 });
    await repository.replaceProviderSnapshot("the-odds-api:sport", "2026-07-18T10:00:00.000Z", [bet365, pinnacle]);

    assert.deepEqual(
      (await repository.listLive("2026-07-18T10:30:00.000Z")).sort((left, right) => left.id.localeCompare(right.id)),
      [bet365, pinnacle].sort((left, right) => left.id.localeCompare(right.id)),
    );
  });
});

test("a malformed live row rolls back provider deletion and all replacement inserts", async (t) => {
  await withDatabase(t, async (pool) => {
    const repository = createOddsRepository(pool);
    const original = liveEntry({ id: "original" });
    await repository.replaceProviderSnapshot("provider-1", "2026-07-18T10:00:00.000Z", [original]);

    await assert.rejects(
      repository.replaceProviderSnapshot("provider-1", "2026-07-18T10:10:00.000Z", [
        liveEntry({ id: "would-be-new", selection: "under" }),
        liveEntry({ id: "malformed", odds: Number.POSITIVE_INFINITY }),
      ]),
      /positive finite odds/i,
    );

    assert.deepEqual(await repository.listLive("2026-07-18T10:30:00.000Z"), [original]);
  });
});

test("non-finite live lines are rejected without replacing or JSON-coercing the provider snapshot", async (t) => {
  await withDatabase(t, async (pool) => {
    const repository = createOddsRepository(pool);
    const original = [
      liveEntry({ id: "original-over", selection: "over" }),
      liveEntry({ id: "original-under", selection: "under" }),
    ];
    await repository.replaceProviderSnapshot("provider-line", "2026-07-18T10:00:00.000Z", original);

    for (const line of [Number.NaN, Number.POSITIVE_INFINITY]) {
      await assert.rejects(
        repository.replaceProviderSnapshot("provider-line", "2026-07-18T10:10:00.000Z", [
          liveEntry({ id: "would-be-new", selection: "home", line: 1.5 }),
          liveEntry({ id: "malformed-line", selection: "away", line }),
        ]),
        /line.*finite/i,
      );
      assert.deepEqual(
        (await repository.listLive("2026-07-18T10:30:00.000Z")).sort((left, right) => left.id.localeCompare(right.id)),
        [...original].sort((left, right) => left.id.localeCompare(right.id)),
      );
    }
  });
});

test("concurrent same-provider replacements finish with one complete snapshot, never a union", async (t) => {
  await withDatabase(t, async (pool) => {
    const repository = createOddsRepository(pool);
    const makeSet = (prefix) => Array.from({ length: 100 }, (_, index) => liveEntry({
      id: `${prefix}-${index}`,
      matchId: `${prefix}-match-${index}`,
      selection: `${prefix}-selection-${index}`,
    }));
    const first = makeSet("first");
    const second = makeSet("second");

    await Promise.all([
      repository.replaceProviderSnapshot("provider-race", "2026-07-18T10:00:00.000Z", first),
      repository.replaceProviderSnapshot("provider-race", "2026-07-18T10:00:01.000Z", second),
    ]);

    const ids = new Set((await repository.listLive("2026-07-18T10:30:00.000Z")).map(({ id }) => id));
    const firstWon = first.every(({ id }) => ids.has(id));
    const secondWon = second.every(({ id }) => ids.has(id));
    assert.equal(ids.size, 100);
    assert.equal(firstWon || secondWon, true);
  });
});

test("collector state round-trips caller JSON and replaces one key", async (t) => {
  await withDatabase(t, async (pool) => {
    const repository = createCollectorStateRepository(pool);
    assert.equal(await repository.get("collector"), undefined);
    await repository.set("collector", { quota: 7, nested: { exact: "state" } }, "2026-07-18T10:00:00.000Z");
    assert.deepEqual(await repository.get("collector"), { quota: 7, nested: { exact: "state" } });
    await repository.set("collector", { quota: 6 }, "2026-07-18T10:01:00.000Z");
    assert.deepEqual(await repository.get("collector"), { quota: 6 });
  });
});

function requireDatabaseUrl() {
  assert.equal(
    DATABASE_URL,
    EXPECTED_DATABASE_URL,
    "DATABASE_URL must exactly match the controller-provided disposable odds_test database",
  );
}

async function withDatabase(t, callback) {
  requireDatabaseUrl();
  const schema = randomUUID();
  assert.match(schema, UUID_SCHEMA);
  const quotedSchema = quoteOwnedSchema(schema);
  const adminPool = createPool(DATABASE_URL);
  let pool;

  t.after(async () => {
    let cleanupError;
    if (pool) {
      try {
        await pool.end();
      } catch (error) {
        cleanupError = error;
      }
    }
    try {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteOwnedSchema(schema)} CASCADE`);
    } catch (error) {
      cleanupError ??= error;
    }
    try {
      await adminPool.end();
    } catch (error) {
      cleanupError ??= error;
    }
    if (cleanupError) throw cleanupError;
  });

  await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);
  const scopedUrl = new URL(DATABASE_URL);
  scopedUrl.searchParams.set("options", `-c search_path=${quotedSchema}`);
  pool = createPool(scopedUrl.toString());
  await runMigrations(pool, MIGRATIONS_DIR);
  await callback(pool);
}

function quoteOwnedSchema(schema) {
  assert.match(schema, UUID_SCHEMA, "refusing to use a schema that is not this test's generated UUID");
  return `"${schema}"`;
}
