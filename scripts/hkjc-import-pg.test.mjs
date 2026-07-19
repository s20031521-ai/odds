import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createOddsRepository } from "../server/db/odds-repository.mjs";
import { createPostgresSink } from "./lib/postgres-sink.mjs";
import { withDatabase } from "./lib/test-db.mjs";
import { createPostgresStore, flattenHkjcLive, resultSourcePriority } from "./hkjc-import.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const DATA_FILES = [
  "data/result-archive.jsonl",
  "data/prediction-snapshots.jsonl",
  "data/api-football-state.json",
  "public/hkjc-odds.json",
];
const GENERATED_AT = "2026-07-18T10:00:00.000Z";
const COMMENCE = "2026-07-19T19:30:00.000+08:00";
const COMMENCE_UTC = "2026-07-19T11:30:00.000Z";
const QUERY_NOW = "2026-07-18T12:00:00.000Z";

test("hkjc-import pg store round-trips API-Football state via collector state key", async (t) => {
  await withDatabase(t, async (pool) => {
    const store = createPostgresStore({ sink: createPostgresSink({ pool }), pool });

    assert.deepEqual(await store.loadState(), {});
    const state = { utcDay: "2026-07-18", calls: 7, resultCalls: 2, quotaExhausted: false, fixtureIds: { "hkjc-m1": 123 }, cornerOdds: [] };
    await store.saveState(state);
    assert.deepEqual(await store.loadState(), state);
  });
});

test("hkjc-import pg store reads snapshots and results through the repositories", async (t) => {
  await withDatabase(t, async (pool) => {
    const sink = createPostgresSink({ pool });
    const store = createPostgresStore({ sink, pool });

    const snapshot = {
      matchId: "hkjc-m1",
      market: "角球",
      prediction: "大角",
      line: 9.5,
      odds: 1.9,
      chance: 0.55,
      edge: 0.04,
      savedAt: GENERATED_AT,
      commenceTime: COMMENCE_UTC,
      modelVersion: "corner-loo-v1",
      source: "market-consensus",
    };
    await sink.saveSnapshots([snapshot]);
    assert.deepEqual(await store.loadSnapshots(), [snapshot]);

    await store.saveResults([liveResult({ actual: "主勝" })]);
    const results = await store.loadResults();
    assert.equal(results.length, 1);
    assert.equal(results[0].actual, "主勝");
    assert.equal(results[0].sourcePriority, 10, "loadResults returns stored raws including assigned priority");
  });
});

test("hkjc-import pg store applies source-priority correction order to results", async (t) => {
  await withDatabase(t, async (pool) => {
    const store = createPostgresStore({ sink: createPostgresSink({ pool }), pool });

    // HKJC live (10) then corrected HKJC historic (20): historic replaces live.
    assert.deepEqual(await store.saveResults([liveResult({ actual: "客勝" })]), { inserted: 1, updated: 0, ignored: 0 });
    assert.deepEqual(await store.saveResults([historicResult({ actual: "和局" })]), { inserted: 0, updated: 1, ignored: 0 });
    assert.deepEqual(await store.saveResults([liveResult({ actual: "客勝" })]), { inserted: 0, updated: 0, ignored: 1 });

    // Corner identity: historic (20) < API-Football (30) < manual:FOTMOB (40).
    assert.deepEqual(await store.saveResults([historicCornerResult({ actual: "7 角球" })]), { inserted: 1, updated: 0, ignored: 0 });
    assert.deepEqual(await store.saveResults([apiFootballCornerResult({ actual: "9 角球" })]), { inserted: 0, updated: 1, ignored: 0 });
    assert.deepEqual(await store.saveResults([manualCornerResult({ actual: "10 角球" })]), { inserted: 0, updated: 1, ignored: 0 });
    assert.deepEqual(await store.saveResults([apiFootballCornerResult({ actual: "9 角球" })]), { inserted: 0, updated: 0, ignored: 1 });
    assert.deepEqual(await store.saveResults([historicCornerResult({ actual: "7 角球" })]), { inserted: 0, updated: 0, ignored: 1 });

    const rows = await pool.query("SELECT market, actual, source_priority FROM results ORDER BY market");
    assert.deepEqual(rows.rows, [
      { market: "主客和", actual: "和局", source_priority: 20 },
      { market: "角球", actual: "10 角球", source_priority: 40 },
    ]);
  });
});

test("hkjc-import pg store flattens the live payload and replaces only the hkjc provider", async (t) => {
  await withDatabase(t, async (pool) => {
    const sink = createPostgresSink({ pool });
    const store = createPostgresStore({ sink, pool });
    const odds = createOddsRepository(pool);

    // Another provider's rows must survive hkjc replacement.
    await sink.saveLiveOdds("the-odds-api:epl", GENERATED_AT, [{
      id: "other-1",
      matchId: "other-match",
      homeTeam: "X",
      awayTeam: "Y",
      commenceTime: COMMENCE_UTC,
      market: "totals",
      selection: "over",
      line: 2.5,
      odds: 1.9,
      expiresAt: "2026-07-19T14:30:00.000Z",
    }]);

    await store.saveLive(livePayload());
    let live = await odds.listLive(QUERY_NOW);
    assert.equal(live.length, 10, "9 hkjc rows + 1 other-provider row; resultEntries excluded");

    const hkjc = live.filter((row) => row.bookmaker === "HKJC");
    const byKey = new Map(hkjc.map((row) => [`${row.market}|${row.selection}`, row]));
    assert.equal(byKey.get("h2h|home").odds, 2.1);
    assert.equal(byKey.get("h2h|draw").odds, 3.2);
    assert.equal(byKey.get("h2h|away").odds, 3.4);
    assert.equal(byKey.get("totals|over").line, 2.5);
    assert.equal(byKey.get("totals|under").odds, 2.0);
    assert.equal(byKey.get("corners|over").market, "corners");
    assert.equal(byKey.get("corners|over").line, 8.5);
    assert.equal(byKey.get("corners|under").odds, 1.83);
    assert.equal(byKey.get("spreads|home").line, 0.25);
    assert.equal(byKey.get("spreads|away").line, 0.25, "both spread sides share the same line");
    assert.equal(byKey.get("spreads|away").odds, 2.0);
    assert.equal(byKey.get("h2h|home").expiresAt, "2026-07-19T14:30:00.000Z", "expiresAt = commenceTime + 3h");
    assert.equal(byKey.get("corners|over").raw.overOdds, 1.91, "original entry travels under raw");

    // Provider-scoped replacement: second hkjc save replaces hkjc rows only.
    const updated = livePayload();
    updated.entries[0].odds = { home: 2.5, draw: 3.2, away: 3.4 };
    updated.totalEntries = [];
    updated.cornerEntries = [];
    updated.handicapEntries = [];
    await store.saveLive(updated);
    live = await odds.listLive(QUERY_NOW);
    assert.equal(live.length, 4, "3 updated hkjc h2h rows + 1 untouched other-provider row");
    assert.equal(live.filter((row) => row.bookmaker === "HKJC").every((row) => row.market === "h2h" && (row.selection !== "home" || row.odds === 2.5)), true);
    assert.equal(live.some((row) => row.matchId === "other-match"), true);
  });
});

test("hkjc-import pg store writes no JSON or JSONL files", async (t) => {
  await withDatabase(t, async (pool) => {
    const before = await readDataFiles();
    const store = createPostgresStore({ sink: createPostgresSink({ pool }), pool });

    await store.saveState({ utcDay: "2026-07-18", calls: 1, cornerOdds: [] });
    await store.saveResults([liveResult({ actual: "主勝" }), manualCornerResult({ actual: "10 角球" })]);
    await store.saveLive(livePayload());
    await store.loadSnapshots();
    await store.loadResults();

    assert.deepEqual(await readDataFiles(), before, "pg mode must not touch JSON/JSONL data files");
  });
});

test("flattenHkjcLive keeps spread sides on the same line and filters invalid odds", () => {
  const payload = livePayload();
  payload.entries.push({ id: "hkjc-bad", matchId: "hkjc-bad", homeTeam: "H", awayTeam: "A", commenceTime: COMMENCE, bookmaker: "HKJC", odds: { home: Number.NaN, draw: 3.0, away: 3.1 } });
  payload.totalEntries.push({ id: "hkjc-bad-t", matchId: "hkjc-bad", homeTeam: "H", awayTeam: "A", commenceTime: COMMENCE, bookmaker: "HKJC", line: 2.5, overOdds: 0, underOdds: 1.9 });

  const flat = flattenHkjcLive(payload);
  assert.equal(flat.length, 12, "9 valid + draw/away of broken h2h + under of broken totals");
  assert.equal(flat.some((row) => row.id === "hkjc-bad:home"), false, "NaN odds dropped");
  assert.equal(flat.some((row) => row.id === "hkjc-bad-t:over"), false, "zero odds dropped");
  const home = flat.find((row) => row.market === "spreads" && row.selection === "home");
  const away = flat.find((row) => row.market === "spreads" && row.selection === "away");
  assert.equal(home.line, away.line, "same line for both spread sides (frontend groups by line)");
  assert.equal(flat.every((row) => row.market !== "result"), true);
  assert.equal(flattenHkjcLive({}).length, 0);
  assert.equal(flattenHkjcLive(undefined).length, 0);
});

test("flattenHkjcLive falls back to generatedAt + 3h for unparseable commenceTime", () => {
  const payload = livePayload();
  payload.entries[0].commenceTime = "not-a-date";
  const flat = flattenHkjcLive(payload);
  const h2h = flat.filter((row) => row.market === "h2h");
  assert.equal(h2h[0].expiresAt, "2026-07-18T13:00:00.000Z");
});

test("flattenHkjcLive passes league through to flat rows and omits it when missing", () => {
  const payload = livePayload();
  payload.entries[0].league = "English Premier League";
  const flat = flattenHkjcLive(payload);
  assert.equal(flat.filter((row) => row.market === "h2h").every((row) => row.league === "English Premier League"), true);
  assert.equal(flat.filter((row) => row.market !== "h2h").every((row) => !("league" in row)), true);
});

test("flattenHkjcLive passes Chinese team names through to flat rows and omits them when missing", () => {
  const payload = livePayload();
  payload.entries[0].homeTeamZh = "主隊";
  payload.entries[0].awayTeamZh = "客隊";
  const flat = flattenHkjcLive(payload);
  assert.equal(flat.filter((row) => row.market === "h2h").every((row) => row.homeTeamZh === "主隊" && row.awayTeamZh === "客隊"), true);
  assert.equal(flat.filter((row) => row.market !== "h2h").every((row) => !("homeTeamZh" in row) && !("awayTeamZh" in row)), true);
});

test("flattenHkjcLive passes leagueZh through to flat rows and omits it when missing", () => {
  const payload = livePayload();
  payload.entries[0].leagueZh = "英格蘭超級聯賽";
  const flat = flattenHkjcLive(payload);
  assert.equal(flat.filter((row) => row.market === "h2h").every((row) => row.leagueZh === "英格蘭超級聯賽"), true);
  assert.equal(flat.filter((row) => row.market !== "h2h").every((row) => !("leagueZh" in row)), true);
});

test("resultSourcePriority encodes manual > API-Football > historic > live", () => {
  assert.equal(resultSourcePriority(manualCornerResult({})), 40);
  assert.equal(resultSourcePriority(apiFootballCornerResult({})), 30);
  assert.equal(resultSourcePriority(historicResult({})), 20);
  assert.equal(resultSourcePriority(liveResult({})), 10);
  assert.equal(resultSourcePriority({}), 10);
  assert.ok(resultSourcePriority(manualCornerResult({})) > resultSourcePriority(apiFootballCornerResult({})));
  assert.ok(resultSourcePriority(apiFootballCornerResult({})) > resultSourcePriority(historicResult({})));
  assert.ok(resultSourcePriority(historicResult({})) > resultSourcePriority(liveResult({})));
});

function livePayload() {
  return {
    generatedAt: GENERATED_AT,
    entries: [{ id: "hkjc-m1", matchId: "hkjc-m1", homeTeam: "Home", awayTeam: "Away", commenceTime: COMMENCE, bookmaker: "HKJC", odds: { home: 2.1, draw: 3.2, away: 3.4 } }],
    totalEntries: [{ id: "hkjc-m1-hil-2.5", matchId: "hkjc-m1", homeTeam: "Home", awayTeam: "Away", commenceTime: COMMENCE, bookmaker: "HKJC", line: 2.5, overOdds: 1.7, underOdds: 2.0 }],
    cornerEntries: [{ id: "hkjc-m1-chl-8.5", matchId: "hkjc-m1", homeTeam: "Home", awayTeam: "Away", commenceTime: COMMENCE, bookmaker: "HKJC", line: 8.5, overOdds: 1.91, underOdds: 1.83 }],
    handicapEntries: [{ id: "hkjc-m1-hdc-0.25", matchId: "hkjc-m1", homeTeam: "Home", awayTeam: "Away", homeTeamEn: "Home", awayTeamEn: "Away", commenceTime: COMMENCE, bookmaker: "HKJC", line: 0.25, homeOdds: 1.72, awayOdds: 2.0 }],
    resultEntries: [liveResult({ actual: "主勝" })],
  };
}

function liveResult(overrides) {
  return { id: "hkjc-m1-had-result", matchId: "hkjc-m1", market: "主客和", prediction: "主勝", actual: "主勝", hit: true, score: "2-1", commenceTime: COMMENCE, ...overrides };
}

function historicResult(overrides) {
  return { id: "hkjc-m1-historic-had", matchId: "hkjc-m1", market: "主客和", prediction: "未有賽前快照", actual: "和局", hit: null, score: "1-1", commenceTime: COMMENCE, ...overrides };
}

function historicCornerResult(overrides) {
  return { id: "hkjc-m1-historic-corners", matchId: "hkjc-m1", market: "角球", prediction: "未有賽前快照", actual: "7 角球", hit: null, score: "1-1", commenceTime: COMMENCE, ...overrides };
}

function apiFootballCornerResult(overrides) {
  return { id: "hkjc-m1-historic-corners", matchId: "hkjc-m1", market: "角球", prediction: "未有賽前快照", actual: "9 角球", hit: null, score: "1-1", commenceTime: COMMENCE, source: "API-Football", ...overrides };
}

function manualCornerResult(overrides) {
  return { id: "hkjc-m1-manual-corners", matchId: "hkjc-m1", market: "角球", prediction: "未有賽前快照", actual: "10 角球", hit: null, score: "1-1", commenceTime: COMMENCE, source: "manual:FOTMOB", sourceUrl: "https://www.fotmob.com/matches/example", verifiedAt: GENERATED_AT, ...overrides };
}

async function readDataFiles() {
  const entries = [];
  for (const file of DATA_FILES) {
    const content = await readFile(path.join(PROJECT_ROOT, file)).catch(() => null);
    entries.push([file, content?.toString("base64") ?? null]);
  }
  return entries;
}
