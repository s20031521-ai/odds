import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createPool } from "./pool.mjs";
import { runMigrations } from "./migrate.mjs";
import { createCollectorStateRepository } from "./collector-state-repository.mjs";
import { createFixtureRepository } from "./fixture-repository.mjs";
import { createOddsRepository } from "./odds-repository.mjs";
import { createOpportunityRepository } from "./opportunity-repository.mjs";
import { createResultRepository } from "./result-repository.mjs";
import { createSnapshotRepository } from "./snapshot-repository.mjs";
import { opportunityIdentity, resultIdentity } from "../domain/identity.mjs";

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

function legacySnapshot(snapshot) {
  return { ...snapshot, strategyVersion: snapshot.strategyVersion ?? "legacy-v0" };
}

function storedLive(entry, provider, observedAt) {
  return { ...entry, id: entry.id ?? null, provider, matchId: entry.matchId ?? null, observedAt, expiresAt: entry.expiresAt ?? null };
}

function fixtureRow(overrides = {}) {
  return {
    provider: "provider-a",
    matchId: "provider-match-1",
    homeTeam: "Alpha FC",
    awayTeam: "Beta United",
    commenceTime: "2026-07-18T12:00:00.000Z",
    league: "Premier League",
    market: "h2h",
    selection: "home",
    odds: 2.1,
    ...overrides,
  };
}

function opportunity(overrides = {}) {
  return {
    fixtureId: "00000000-0000-4000-8000-000000000001",
    matchId: "provider-match-1",
    homeTeam: "Alpha FC",
    awayTeam: "Beta United",
    commenceTime: "2026-07-18T12:00:00.000Z",
    league: "Premier League",
    strategyVersion: "unified-buyable-v1",
    modelVersion: "consensus-v1",
    market: "h2h",
    selection: "home",
    quotes: [{
      bookmaker: "Book A",
      provider: "provider-a",
      odds: 2.1,
      chance: 0.51,
      edge: 0.071,
      minimumBuyOdds: 2.02,
      observedAt: "2026-07-18T10:00:00.000Z",
    }],
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
    assert.deepEqual(all.find((row) => row.modelVersion === "model-v1"), legacySnapshot(first));
    assert.deepEqual(all.find((row) => row.modelVersion === "model-v2"), legacySnapshot(newVersion));
    assert.deepEqual(all.find((row) => row.matchId === "legacy-1"), legacySnapshot(legacy));
    assert.deepEqual(
      (await repository.listCurrent()).sort((left, right) => left.modelVersion.localeCompare(right.modelVersion)),
      [first, newVersion].map(legacySnapshot).sort((left, right) => left.modelVersion.localeCompare(right.modelVersion)),
    );
    assert.equal(all.some((row) => row.matchId === "invalid-1"), false);
  });
});

test("legacy snapshot writes reject the server-only unified strategy and reads map missing strategy to legacy-v0", async (t) => {
  await withDatabase(t, async (pool) => {
    const repository = createSnapshotRepository(pool);
    const legacy = currentSnapshot({ matchId: "legacy-strategy" });
    const unified = currentSnapshot({ matchId: "browser-unified", strategyVersion: "unified-buyable-v1" });
    assert.deepEqual(await repository.insertBatch([legacy, unified]), {
      inserted: 1,
      duplicate: 0,
      rejected: 1,
      rejectedByReason: { "server-only-strategy": 1 },
    });
    assert.deepEqual(await repository.listAll(), [{ ...legacy, strategyVersion: "legacy-v0" }]);
    const stored = await pool.query("SELECT raw, strategy_version FROM prediction_snapshots");
    assert.deepEqual(stored.rows, [{ raw: legacy, strategy_version: null }]);
  });
});

test("opportunity identity includes fixture, selection, model, and strategy", () => {
  const base = opportunity();
  const identities = [
    opportunityIdentity(base),
    opportunityIdentity({ ...base, selection: "away" }),
    opportunityIdentity({ ...base, modelVersion: "consensus-v2" }),
    opportunityIdentity({ ...base, strategyVersion: "unified-buyable-v2" }),
  ];
  assert.equal(new Set(identities).size, identities.length);
  assert.equal(identities[0], "00000000-0000-4000-8000-000000000001|h2h|home||consensus-v1|unified-buyable-v1");
});

test("opportunity observations bind JSON arrays, including empty arrays, as valid JSON", async () => {
  let observationParameters;
  const client = {
    release() {},
    async query(sql, parameters = []) {
      if (sql.includes("snapshot.identity_key <> ALL")) return { rowCount: 0, rows: [] };
      if (sql.includes("pg_advisory_xact_lock")) return { rowCount: 1, rows: [{}] };
      if (sql.includes("SELECT id FROM prediction_snapshots")) return { rowCount: 1, rows: [{ id: "sample-1" }] };
      if (sql.includes("SELECT id FROM recommendation_observations")) return { rowCount: 0, rows: [] };
      if (sql.includes("INSERT INTO recommendation_observations")) {
        observationParameters = parameters;
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };

  await createOpportunityRepository(client).recordEvaluation({
    evaluatedAt: "2026-07-18T10:05:00.000Z",
    inputs: [],
    opportunities: [{ ...opportunity(), inputs: [], quotes: [] }],
  });

  assert.equal(observationParameters[3], "[]");
  assert.equal(observationParameters[4], "[]");
  assert.deepEqual(JSON.parse(observationParameters[3]), []);
  assert.deepEqual(JSON.parse(observationParameters[4]), []);
});

test("current opportunities select the observation evaluated most recently", async () => {
  let currentQuery;
  const db = {
    async query(sql) {
      currentQuery = sql;
      return { rowCount: 0, rows: [] };
    },
  };
  await createOpportunityRepository(db).listCurrent("2026-07-18T10:05:00.000Z");
  assert.match(currentQuery, /ORDER BY last_evaluated_at DESC, id DESC/);
});

test("opportunity replay updates use monotonic qualification and evaluation timestamps", async () => {
  const updateQueries = [];
  const client = {
    release() {},
    async query(sql) {
      if (sql.includes("snapshot.identity_key <> ALL")) return { rowCount: 0, rows: [] };
      if (sql.includes("pg_advisory_xact_lock")) return { rowCount: 1, rows: [{}] };
      if (sql.includes("SELECT id FROM prediction_snapshots")) return { rowCount: 1, rows: [{ id: "sample-1" }] };
      if (sql.includes("SELECT id FROM recommendation_observations")) return { rowCount: 1, rows: [{ id: "observation-1" }] };
      if (sql.includes("UPDATE prediction_snapshots") || sql.includes("UPDATE recommendation_observations")) {
        updateQueries.push(sql);
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };

  await createOpportunityRepository(client).recordEvaluation({
    evaluatedAt: "2026-07-18T10:05:00.000Z",
    inputs: [],
    opportunities: [opportunity()],
  });

  assert.equal(updateQueries.length, 2);
  assert.match(updateQueries[0], /SET last_qualified_at = GREATEST\(last_qualified_at, \$2\)/);
  assert.match(updateQueries[1], /SET last_evaluated_at = GREATEST\(last_evaluated_at, \$2\)/);
});

test("opportunity persistence keeps selection and strategy identities distinct", async (t) => {
  await withDatabase(t, async (pool) => {
    const [{ fixtureId }] = (await createFixtureRepository(pool).resolveBatch([fixtureRow()])).fixtures;
    const repository = createOpportunityRepository(pool);
    const evaluatedAt = "2026-07-18T10:05:00.000Z";
    const base = opportunity({ fixtureId });
    await repository.recordEvaluation({
      evaluatedAt,
      inputs: [],
      opportunities: [
        base,
        { ...base, selection: "away" },
        { ...base, strategyVersion: "unified-buyable-v2" },
      ],
    });
    const identities = await pool.query("SELECT identity_key FROM prediction_snapshots ORDER BY identity_key");
    assert.equal(identities.rowCount, 3);
    assert.equal(new Set(identities.rows.map(({ identity_key }) => identity_key)).size, 3);
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
      [valid, legacy].map(legacySnapshot).sort((left, right) => left.matchId.localeCompare(right.matchId)),
    );
    assert.deepEqual(await repository.listCurrent(), [legacySnapshot(valid)]);
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
      [
        storedLive(replacement, "provider-1", "2026-07-18T10:15:00.000Z"),
        storedLive(p2, "provider-2", observedAt),
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );
    await repository.replaceProviderSnapshot("provider-1", "2026-07-18T10:31:00.000Z", []);
    assert.deepEqual(await repository.listLive("2026-07-18T10:31:00.000Z"), [storedLive(p2, "provider-2", observedAt)]);
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
      [bet365, pinnacle].map((entry) => storedLive(entry, "the-odds-api:sport", "2026-07-18T10:00:00.000Z")).sort((left, right) => left.id.localeCompare(right.id)),
    );
  });
});

test("listLive overlays trusted provider observation and source identity metadata", async (t) => {
  await withDatabase(t, async (pool) => {
    const repository = createOddsRepository(pool);
    const raw = liveEntry({
      id: "trusted-entry",
      matchId: "trusted-match",
      expiresAt: "2026-07-18T11:00:00.000Z",
      provider: "spoofed-provider",
      observedAt: "1999-01-01T00:00:00.000Z",
    });
    await repository.replaceProviderSnapshot("trusted-provider", "2026-07-18T10:00:00.000Z", [raw]);
    const [stored] = await repository.listLive("2026-07-18T10:30:00.000Z");
    assert.deepEqual(stored, {
      ...raw,
      id: "trusted-entry",
      provider: "trusted-provider",
      matchId: "trusted-match",
      observedAt: "2026-07-18T10:00:00.000Z",
      expiresAt: "2026-07-18T11:00:00.000Z",
    });
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

    assert.deepEqual(await repository.listLive("2026-07-18T10:30:00.000Z"), [storedLive(original, "provider-1", "2026-07-18T10:00:00.000Z")]);
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
        original.map((entry) => storedLive(entry, "provider-line", "2026-07-18T10:00:00.000Z")).sort((left, right) => left.id.localeCompare(right.id)),
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

test("fixture resolution reuses exact aliases before matching metadata", async (t) => {
  await withDatabase(t, async (pool) => {
    const repository = createFixtureRepository(pool);
    const first = fixtureRow();
    const initial = await repository.resolveBatch([first]);
    assert.equal(initial.unmatched.length, 0);
    assert.equal(initial.fixtures.length, 1);
    assert.match(initial.fixtures[0].fixtureId, UUID_SCHEMA);

    const changedMetadata = fixtureRow({
      homeTeam: "Completely Different",
      awayTeam: "Another Team",
      commenceTime: undefined,
    });
    const exact = await repository.resolveBatch([changedMetadata]);
    assert.equal(exact.fixtures[0].fixtureId, initial.fixtures[0].fixtureId);
    const aliases = await pool.query("SELECT provider, provider_match_id, fixture_id FROM fixture_aliases");
    assert.equal(aliases.rowCount, 1);
  });
});

test("fixture resolution auto-links one normalized same-direction candidate within ten minutes", async (t) => {
  await withDatabase(t, async (pool) => {
    const repository = createFixtureRepository(pool);
    const [seed] = (await repository.resolveBatch([fixtureRow()])).fixtures;
    const [linked] = (await repository.resolveBatch([fixtureRow({
      provider: "provider-b",
      matchId: "other-match",
      homeTeam: " alpha-fc ",
      awayTeam: "BETA UNITED",
      commenceTime: "2026-07-18T12:10:00.000Z",
      league: " premier league ",
    })])).fixtures;
    assert.equal(linked.fixtureId, seed.fixtureId);

    const [reversed] = (await repository.resolveBatch([fixtureRow({
      provider: "provider-c",
      matchId: "reversed-match",
      homeTeam: "Beta United",
      awayTeam: "Alpha FC",
      commenceTime: "2026-07-18T12:05:00.000Z",
    })])).fixtures;
    assert.notEqual(reversed.fixtureId, seed.fixtureId);
  });
});

test("ambiguous fixture matches are audited and left unmatched", async (t) => {
  await withDatabase(t, async (pool) => {
    const repository = createFixtureRepository(pool);
    await repository.resolveBatch([fixtureRow({ matchId: "seed-one", commenceTime: "2026-07-18T11:55:00.000Z" })]);
    await repository.resolveBatch([fixtureRow({ matchId: "seed-two", commenceTime: "2026-07-18T12:05:00.000Z", league: "Other League" })]);
    const { league: _league, ...ambiguousRow } = fixtureRow({ provider: "provider-b", matchId: "ambiguous" });
    const result = await repository.resolveBatch([ambiguousRow]);
    assert.deepEqual(result.fixtures, []);
    assert.deepEqual(result.unmatched, [ambiguousRow]);
    const audit = await pool.query("SELECT reason, candidate_fixture_ids, matched_fixture_id, raw FROM fixture_match_audit");
    assert.equal(audit.rowCount, 1);
    assert.equal(audit.rows[0].reason, "ambiguous-match");
    assert.equal(audit.rows[0].candidate_fixture_ids.length, 2);
    assert.equal(audit.rows[0].matched_fixture_id, null);
    assert.deepEqual(audit.rows[0].raw, ambiguousRow);
    assert.equal((await pool.query("SELECT 1 FROM fixture_aliases WHERE provider = 'provider-b' AND provider_match_id = 'ambiguous'")).rowCount, 0);
  });
});

test("exact fixture aliases accept a recognized postponed kickoff and backtest reads the registry time", async (t) => {
  await withDatabase(t, async (pool) => {
    const fixtures = createFixtureRepository(pool);
    const [{ fixtureId }] = (await fixtures.resolveBatch([fixtureRow()])).fixtures;
    const postponed = "2026-07-20T12:00:00.000Z";
    const exact = await fixtures.resolveBatch([fixtureRow({ commenceTime: postponed })]);
    assert.equal(exact.fixtures[0].fixtureId, fixtureId);

    const fixture = await pool.query("SELECT commence_time FROM fixtures WHERE id = $1", [fixtureId]);
    assert.equal(fixture.rows[0].commence_time.toISOString(), postponed);

    const opportunities = createOpportunityRepository(pool);
    await opportunities.recordEvaluation({
      evaluatedAt: "2026-07-18T10:05:00.000Z",
      inputs: [],
      opportunities: [opportunity({ fixtureId })],
    });
    const [stored] = await opportunities.listForBacktest();
    assert.equal(stored.commenceTime, postponed, "current registry kickoff supersedes the sampled kickoff");
    const current = await opportunities.listCurrent("2026-07-19T12:00:00.000Z");
    assert.equal(current.length, 1, "postponed opportunity remains current after its original kickoff");
    assert.equal(current[0].commenceTime, postponed);
  });
});

test("result persistence resolves provider aliases and deduplicates same-fixture markets by priority", async (t) => {
  await withDatabase(t, async (pool) => {
    const fixtures = createFixtureRepository(pool);
    const [{ fixtureId }] = (await fixtures.resolveBatch([fixtureRow({ provider: "the-odds-api:soccer_epl", matchId: "odds-event" })])).fixtures;
    await fixtures.resolveBatch([fixtureRow({ provider: "hkjc", matchId: "hkjc-event" })]);
    const results = createResultRepository(pool);

    assert.deepEqual(await results.upsertBatch([result({
      provider: "the-odds-api:soccer_epl",
      matchId: "odds-event",
      market: "totals",
      actual: "3 球",
      sourcePriority: 0,
    })]), { inserted: 1, updated: 0, ignored: 0 });
    assert.deepEqual(await results.upsertBatch([result({
      provider: "hkjc",
      matchId: "hkjc-event",
      market: "totals",
      actual: "4 球",
      sourcePriority: 20,
    })]), { inserted: 0, updated: 1, ignored: 0 });

    const [stored] = await results.listAll();
    assert.equal(stored.fixtureId, fixtureId);
    assert.equal(stored.matchId, "hkjc-event", "winning provider ID remains auditable");
    assert.equal(stored.actual, "4 球");
  });
});

test("fixture result identity canonicalizes provider market vocabulary before applying priority", async (t) => {
  await withDatabase(t, async (pool) => {
    const fixtures = createFixtureRepository(pool);
    const [{ fixtureId }] = (await fixtures.resolveBatch([fixtureRow({ provider: "the-odds-api:soccer_epl", matchId: "odds-h2h" })])).fixtures;
    await fixtures.resolveBatch([fixtureRow({ provider: "hkjc", matchId: "hkjc-h2h" })]);
    const results = createResultRepository(pool);
    await results.upsertBatch([result({ provider: "the-odds-api:soccer_epl", matchId: "odds-h2h", market: "h2h", sourcePriority: 0 })]);
    await results.upsertBatch([result({ provider: "hkjc", matchId: "hkjc-h2h", market: "主客和", sourcePriority: 20 })]);

    const stored = await results.listAll();
    assert.equal(stored.length, 1);
    assert.equal(stored[0].fixtureId, fixtureId);
    assert.equal(stored[0].market, "主客和");
  });
});

test("opportunity evaluations preserve the first sample and append only changed fingerprints", async (t) => {
  await withDatabase(t, async (pool) => {
    const fixtures = createFixtureRepository(pool);
    const [{ fixtureId }] = (await fixtures.resolveBatch([fixtureRow()])).fixtures;
    const repository = createOpportunityRepository(pool);
    const firstOpportunity = opportunity({ fixtureId });
    const firstInputs = [fixtureRow({ fixtureId, bookmaker: "Book A", observedAt: "2026-07-18T10:00:00.000Z" })];

    assert.deepEqual(await repository.recordEvaluation({
      evaluatedAt: "2026-07-18T10:05:00.000Z",
      inputs: firstInputs,
      opportunities: [firstOpportunity],
    }), { samplesInserted: 1, samplesUpdated: 0, observationsInserted: 1, observationsExtended: 0, skipped: 0 });
    assert.deepEqual(await repository.recordEvaluation({
      evaluatedAt: "2026-07-18T10:10:00.000Z",
      inputs: firstInputs,
      opportunities: [firstOpportunity],
    }), { samplesInserted: 0, samplesUpdated: 1, observationsInserted: 0, observationsExtended: 1, skipped: 0 });

    const changed = opportunity({ fixtureId, quotes: [{ ...firstOpportunity.quotes[0], odds: 2.2, edge: 0.122 }] });
    await repository.recordEvaluation({
      evaluatedAt: "2026-07-18T10:15:00.000Z",
      inputs: firstInputs,
      opportunities: [changed],
    });
    await repository.recordEvaluation({
      evaluatedAt: "2026-07-18T10:20:00.000Z",
      inputs: firstInputs,
      opportunities: [{ ...changed, quotes: [] }],
    });

    const samples = await pool.query(`
      SELECT id, raw, odds, chance, edge, first_qualified_at, last_qualified_at
      FROM prediction_snapshots WHERE strategy_version = 'unified-buyable-v1'
    `);
    assert.equal(samples.rowCount, 1);
    assert.deepEqual(samples.rows[0].raw, firstOpportunity);
    assert.equal(samples.rows[0].odds, 2.1);
    assert.equal(samples.rows[0].chance, 0.51);
    assert.equal(samples.rows[0].edge, 0.071);
    assert.equal(samples.rows[0].first_qualified_at.toISOString(), "2026-07-18T10:05:00.000Z");
    assert.equal(samples.rows[0].last_qualified_at.toISOString(), "2026-07-18T10:15:00.000Z");

    const observations = await repository.listObservations(samples.rows[0].id);
    assert.equal(observations.length, 3);
    assert.equal(observations[0].firstEvaluatedAt, "2026-07-18T10:05:00.000Z");
    assert.equal(observations[0].lastEvaluatedAt, "2026-07-18T10:10:00.000Z");
    assert.deepEqual(observations.at(-1).buyableQuotes, []);
    const current = await repository.listCurrent("2026-07-18T10:30:00.000Z");
    assert.equal(current.length, 1);
    assert.deepEqual(current[0].quotes, []);
    assert.equal(current[0].strategyVersion, "unified-buyable-v1");
    assert.equal((await repository.listForBacktest()).length, 1);
  });
});

test("omitted pre-kickoff opportunities receive one recurring empty observation", async (t) => {
  await withDatabase(t, async (pool) => {
    const [{ fixtureId }] = (await createFixtureRepository(pool).resolveBatch([fixtureRow()])).fixtures;
    const repository = createOpportunityRepository(pool);
    const qualified = opportunity({ fixtureId });
    await repository.recordEvaluation({
      evaluatedAt: "2026-07-18T10:05:00.000Z",
      inputs: [],
      opportunities: [qualified],
    });
    await repository.recordEvaluation({
      evaluatedAt: "2026-07-18T10:10:00.000Z",
      inputs: [],
      opportunities: [],
    });
    await repository.recordEvaluation({
      evaluatedAt: "2026-07-18T10:15:00.000Z",
      inputs: [],
      opportunities: [],
    });

    const [current] = await repository.listCurrent("2026-07-18T10:15:00.000Z");
    assert.deepEqual(current.quotes, []);
    assert.equal(current.lastQualifiedAt, "2026-07-18T10:05:00.000Z");
    const observations = await repository.listObservations(current.sampleId);
    assert.equal(observations.length, 2);
    assert.deepEqual(observations.at(-1).inputs, []);
    assert.deepEqual(observations.at(-1).buyableQuotes, []);
    assert.equal(observations.at(-1).firstEvaluatedAt, "2026-07-18T10:10:00.000Z");
    assert.equal(observations.at(-1).lastEvaluatedAt, "2026-07-18T10:15:00.000Z");
  });
});

test("omitted post-kickoff opportunities are not reconciled", async (t) => {
  await withDatabase(t, async (pool) => {
    const [{ fixtureId }] = (await createFixtureRepository(pool).resolveBatch([fixtureRow()])).fixtures;
    const repository = createOpportunityRepository(pool);
    await repository.recordEvaluation({
      evaluatedAt: "2026-07-18T10:05:00.000Z",
      inputs: [],
      opportunities: [opportunity({ fixtureId })],
    });
    await repository.recordEvaluation({
      evaluatedAt: "2026-07-18T12:00:00.000Z",
      inputs: [],
      opportunities: [],
    });

    const samples = await pool.query("SELECT id FROM prediction_snapshots WHERE strategy_version = 'unified-buyable-v1'");
    assert.equal(samples.rowCount, 1);
    const observations = await repository.listObservations(samples.rows[0].id);
    assert.equal(observations.length, 1);
    assert.equal(observations[0].lastEvaluatedAt, "2026-07-18T10:05:00.000Z");
  });
});

test("A-B-A observations stay current and out-of-order replays never regress timestamps", async (t) => {
  await withDatabase(t, async (pool) => {
    const [{ fixtureId }] = (await createFixtureRepository(pool).resolveBatch([fixtureRow()])).fixtures;
    const repository = createOpportunityRepository(pool);
    const first = opportunity({ fixtureId });
    const second = opportunity({ fixtureId, quotes: [{ ...first.quotes[0], odds: 2.2, edge: 0.122 }] });
    const record = (evaluatedAt, value) => repository.recordEvaluation({
      evaluatedAt,
      inputs: [],
      opportunities: [value],
    });

    await record("2026-07-18T10:10:00.000Z", first);
    await record("2026-07-18T10:20:00.000Z", second);
    await record("2026-07-18T10:30:00.000Z", first);
    await record("2026-07-18T10:15:00.000Z", second);

    const [current] = await repository.listCurrent("2026-07-18T10:35:00.000Z");
    assert.equal(current.quotes[0].odds, 2.1);
    assert.equal(current.lastEvaluatedAt, "2026-07-18T10:30:00.000Z");
    assert.equal(current.lastQualifiedAt, "2026-07-18T10:30:00.000Z");

    const observations = await repository.listObservations(current.sampleId);
    assert.deepEqual(observations.map(({ firstEvaluatedAt, lastEvaluatedAt }) => ({ firstEvaluatedAt, lastEvaluatedAt })), [
      { firstEvaluatedAt: "2026-07-18T10:10:00.000Z", lastEvaluatedAt: "2026-07-18T10:30:00.000Z" },
      { firstEvaluatedAt: "2026-07-18T10:20:00.000Z", lastEvaluatedAt: "2026-07-18T10:20:00.000Z" },
    ]);
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
