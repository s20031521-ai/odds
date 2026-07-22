import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createOddsRepository } from "../server/db/odds-repository.mjs";
import { createPostgresSink } from "./lib/postgres-sink.mjs";
import { withDatabase } from "./lib/test-db.mjs";
import { createPostgresStore, dueScoreSports, flattenSportEntries, scoreRows } from "./hdc-collector.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const DATA_FILES = [
  "data/hdc-collector-state.json",
  "data/background-hdc-snapshots.jsonl",
  "data/background-result-archive.jsonl",
  "data/background-hdc-odds.json",
];
const COMMENCE = "2026-07-18T12:00:00.000Z";
const NOW = Date.parse("2026-07-18T10:00:00.000Z");
const QUERY_NOW = "2026-07-18T13:00:00.000Z";

test("hdc-collector pg store round-trips collector state through the injected store", async (t) => {
  await withDatabase(t, async (pool) => {
    const store = createPostgresStore(createPostgresSink({ pool }));

    assert.deepEqual(await store.loadState(), { events: {}, lastOddsAt: {}, lastScoresAt: {}, completedIds: [] });
    const state = { events: { epl: [{ id: "m1" }] }, lastOddsAt: { epl: "2026-07-18T10:00:00.000Z" }, lastScoresAt: {}, completedIds: ["m0"], quotaRemaining: 412 };
    await store.saveState(state);
    assert.deepEqual(await store.loadState(), state);
  });
});

test("hdc-collector pg store keeps snapshots immutable and upserts results by source priority", async (t) => {
  await withDatabase(t, async (pool) => {
    const store = createPostgresStore(createPostgresSink({ pool }));
    const snapshot = {
      matchId: "hdc-store-match-1",
      market: "亞洲讓球",
      prediction: "主",
      line: -0.5,
      odds: 2.05,
      chance: 0.58,
      edge: 0.05,
      savedAt: "2026-07-18T10:00:00.000Z",
      commenceTime: COMMENCE,
      modelVersion: "hdc-loo-v2",
      source: "background:epl:leave-one-out",
    };

    assert.deepEqual(await store.saveSnapshots([snapshot]), { inserted: 1, duplicate: 0, rejected: 0, rejectedByReason: {} });
    const again = await store.saveSnapshots([{ ...snapshot, odds: 9.9 }]);
    assert.deepEqual(again, { inserted: 0, duplicate: 1, rejected: 0, rejectedByReason: {} });

    const rows = await pool.query("SELECT raw FROM prediction_snapshots");
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].raw.odds, 2.05, "first snapshot wins");

    const low = { matchId: "hdc-store-match-1", market: "亞洲讓球", actual: "主", score: "2-0", source: "background:epl", sourcePriority: 5, completedAt: "2026-07-18T14:00:00.000Z" };
    const high = { ...low, actual: "客", score: "0-1", sourcePriority: 30 };
    assert.deepEqual(await store.saveResults([low]), { inserted: 1, updated: 0, ignored: 0 });
    assert.deepEqual(await store.saveResults([high]), { inserted: 0, updated: 1, ignored: 0 });
    assert.deepEqual(await store.saveResults([low]), { inserted: 0, updated: 0, ignored: 1 });

    const resultRows = await pool.query("SELECT raw FROM results");
    assert.equal(resultRows.rows[0].raw.actual, "客", "higher source priority wins");
  });
});

test("hdc-collector pg store flattens per-sport bundles into the live-odds contract", async (t) => {
  await withDatabase(t, async (pool) => {
    const sink = createPostgresSink({ pool });
    const store = createPostgresStore(sink);
    const odds = createOddsRepository(pool);

    await store.saveLive({ soccer_epl: sportBundle({ bookmaker: "BookA" }) }, NOW);
    let live = await odds.listLive(QUERY_NOW);
    assert.equal(live.length, 9, "3 h2h + 2 spreads + 2 totals + 2 corner selections");

    const byKey = new Map(live.map((row) => [`${row.market}|${row.selection}`, row]));
    assert.equal(byKey.get("h2h|home").odds, 2.1);
    assert.equal(byKey.get("h2h|draw").odds, 3.4);
    assert.equal(byKey.get("h2h|away").odds, 3.6);
    assert.equal(byKey.get("spreads|home").line, -0.5);
    assert.equal(byKey.get("spreads|home").odds, 1.95);
    assert.equal(byKey.get("spreads|away").line, -0.5, "away row shares the home line so the frontend group pairs both sides");
    assert.equal(byKey.get("spreads|away").odds, 1.9);
    assert.equal(byKey.get("totals|over").line, 2.5);
    assert.equal(byKey.get("totals|under").odds, 1.95);
    assert.equal(byKey.get("alternate_totals_corners|over").line, 9.5);
    assert.equal(byKey.get("alternate_totals_corners|under").odds, 2.0);
    assert.equal(byKey.get("h2h|home").expiresAt, "2026-07-18T15:00:00.000Z", "expiresAt = commenceTime + 3h");
    assert.equal(byKey.get("totals|over").raw.line, 2.5, "original entry travels under raw");

    // Provider-scoped replacement: re-saving one sport replaces only that provider.
    await store.saveLive({ soccer_epl: sportBundle({ bookmaker: "BookB", h2hOnly: true }) }, NOW);
    await store.saveLive({ soccer_laliga: sportBundle({ bookmaker: "BookC", h2hOnly: true }) }, NOW);
    live = await odds.listLive(QUERY_NOW);
    const bookmakers = new Set(live.map((row) => row.bookmaker));
    assert.deepEqual([...bookmakers].sort(), ["BookB", "BookC"], "first epl snapshot replaced; laliga untouched by it");
    assert.equal(live.length, 6, "two providers x 3 h2h selections");
  });
});

test("hdc-collector pg store leaves previous live rows intact when a save fails", async (t) => {
  await withDatabase(t, async (pool) => {
    const sink = createPostgresSink({ pool });
    const store = createPostgresStore(sink);
    const odds = createOddsRepository(pool);

    await store.saveLive({ soccer_epl: sportBundle({ bookmaker: "BookA" }) }, NOW);
    const before = await odds.listLive(QUERY_NOW);
    assert.equal(before.length, 9);

    const broken = sportBundle({ bookmaker: "BookBroken" });
    broken.h2hEntries[0].odds = { home: Number.NaN, draw: 3.4, away: 3.6 };
    await assert.rejects(store.saveLive({ soccer_epl: broken }), /positive finite odds/);

    const after = await odds.listLive(QUERY_NOW);
    assert.deepEqual(after, before, "failed save rolls back; previous rows intact");
  });
});

test("hdc-collector pg store acquireLock reports busy while the named cycle is held", async (t) => {
  await withDatabase(t, async (pool) => {
    const sink = createPostgresSink({ pool });
    const store = createPostgresStore(sink);

    const outcome = await store.acquireLock(async () => {
      assert.equal(await store.acquireLock(async () => "should-not-run"), "busy");
      return "done";
    });
    assert.equal(outcome, "ran");
    assert.equal(await store.acquireLock(async () => "after-release"), "ran");
  });
});

test("hdc-collector pg store writes no JSON or JSONL files", async (t) => {
  await withDatabase(t, async (pool) => {
    const before = await readDataFiles();
    const store = createPostgresStore(createPostgresSink({ pool }));

    await store.saveState({ events: {}, lastOddsAt: {}, lastScoresAt: {}, completedIds: [], quotaRemaining: 100 });
    await store.saveSnapshots([{
      matchId: "no-files-match",
      market: "大細波",
      prediction: "大",
      line: 2.5,
      odds: 2.05,
      chance: 0.58,
      edge: 0.05,
      savedAt: "2026-07-18T10:00:00.000Z",
      commenceTime: COMMENCE,
      modelVersion: "totals-loo-v1",
      source: "background:epl:leave-one-out",
    }]);
    await store.saveResults([{ matchId: "no-files-match", market: "大細波", actual: "大", score: "3-1", source: "background:epl", sourcePriority: 10, completedAt: "2026-07-18T14:00:00.000Z" }]);
    await store.saveLive({ soccer_epl: sportBundle({ bookmaker: "BookA" }) }, NOW);

    assert.deepEqual(await readDataFiles(), before, "pg mode must not touch JSON/JSONL data files");
  });
});

test("flattenSportEntries is pure and covers every market vocabulary", () => {
  const flat = flattenSportEntries(sportBundle({ bookmaker: "BookA" }));
  assert.equal(flat.length, 9);
  assert.deepEqual(
    [...new Set(flat.map((row) => `${row.market}:${row.selection}`))].sort(),
    [
      "alternate_totals_corners:over",
      "alternate_totals_corners:under",
      "h2h:away",
      "h2h:draw",
      "h2h:home",
      "spreads:away",
      "spreads:home",
      "totals:over",
      "totals:under",
    ],
  );
  assert.equal(flattenSportEntries(undefined).length, 0);
  assert.equal(flattenSportEntries({}).length, 0);
});

test("flattenSportEntries passes league through to flat rows and omits it when missing", () => {
  const bundle = sportBundle({ bookmaker: "BookA" });
  bundle.h2hEntries[0].league = "Liga MX";
  const flat = flattenSportEntries(bundle);
  assert.equal(flat.filter((row) => row.market === "h2h").every((row) => row.league === "Liga MX"), true);
  assert.equal(flat.filter((row) => row.market !== "h2h").every((row) => !("league" in row)), true);
});

test("The Odds API score conversion emits h2h plus existing handicap and totals results", () => {
  const rows = scoreRows([{
    id: "score-event",
    completed: true,
    commence_time: "2026-07-18T12:00:00.000Z",
    home_team: "Home",
    away_team: "Away",
    scores: [{ name: "Home", score: "2" }, { name: "Away", score: "1" }],
  }], "soccer_epl");

  assert.deepEqual(rows.map(({ market }) => market), ["h2h", "亞洲讓球", "大細波"]);
  assert.equal(rows[0].actual, "2-1");
  assert.equal(rows[2].actual, "3 球");
  assert.equal(rows.every((row) => row.provider === "the-odds-api:soccer_epl"), true);
});

test("The Odds API cancellation conversion emits explicit terminal void rows", () => {
  const rows = scoreRows([{
    id: "void-event",
    status: "cancelled",
    commence_time: "2026-07-18T12:00:00.000Z",
    home_team: "Home",
    away_team: "Away",
  }], "soccer_epl");

  assert.deepEqual(rows.map(({ market }) => market), ["h2h", "亞洲讓球", "大細波"]);
  assert.equal(rows.every((row) => row.status === "void" && row.actual === "void"), true);
});

test("score polling never retries completed or seven-day-terminal events", () => {
  const now = Date.parse("2026-07-25T12:00:00.000Z");
  const event = (id, ageMs) => ({ id, commence_time: new Date(now - ageMs).toISOString() });
  const state = {
    events: { soccer_epl: [
      event("retry", 2 * 24 * 60 * 60_000),
      event("terminal", 7 * 24 * 60 * 60_000),
      event("void", 2 * 24 * 60 * 60_000),
    ] },
    completedIds: ["void"],
    lastScoresAt: {},
  };

  assert.deepEqual(dueScoreSports(state, now), ["soccer_epl"]);
  state.completedIds.push("retry");
  assert.deepEqual(dueScoreSports(state, now), []);
});

function sportBundle({ bookmaker, h2hOnly = false }) {
  const base = { matchId: "m1", homeTeam: "Home", awayTeam: "Away", commenceTime: COMMENCE, bookmaker };
  return {
    updatedAt: "2026-07-18T10:00:00.000Z",
    h2hEntries: [{ ...base, id: "m1-bk", odds: { home: 2.1, draw: 3.4, away: 3.6 } }],
    handicapEntries: h2hOnly ? [] : [{ ...base, id: "m1-bk-hdc--0.5", line: -0.5, homeOdds: 1.95, awayOdds: 1.9 }],
    totalEntries: h2hOnly ? [] : [{ ...base, id: "m1-bk-totals-2.5", line: 2.5, overOdds: 1.9, underOdds: 1.95 }],
    cornerEntries: h2hOnly ? [] : [{ ...base, id: "m1-bk-corners-9.5", line: 9.5, overOdds: 1.85, underOdds: 2.0 }],
  };
}

async function readDataFiles() {
  const entries = [];
  for (const file of DATA_FILES) {
    const content = await readFile(path.join(PROJECT_ROOT, file)).catch(() => null);
    entries.push([file, content?.toString("base64") ?? null]);
  }
  return entries;
}
