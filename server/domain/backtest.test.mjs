import test from "node:test";
import assert from "node:assert/strict";
import {
  bucket,
  buildBacktest,
  buildHealth,
  flattenLiveCache,
  groupSummary,
  mergeResults,
  mergeSnapshots,
  oddsScoreRows,
  selectBacktestResults,
  summarize,
} from "./backtest.mjs";
import { liveOddsIdentity, providerResultIdentity, resultIdentity, snapshotIdentity } from "./identity.mjs";
import { classifySnapshot } from "../../shared/snapshot-policy.mjs";

const NOW = Date.parse("2026-07-11T12:00:00Z");
const TOTALS = "大細波";
const HANDICAP = "亞洲讓球";
const CORNERS = "角球";

function validSnapshot(overrides = {}) {
  const snapshot = {
    odds: 2,
    chance: 0.55,
    savedAt: "2026-07-11T05:00:00Z",
    commenceTime: "2026-07-11T06:00:00Z",
    modelVersion: "self-test-v1",
    ...overrides,
  };
  if (!Number.isFinite(Date.parse(snapshot.savedAt))) snapshot.savedAt = "2026-07-11T05:00:00Z";
  if (!Number.isFinite(Date.parse(snapshot.commenceTime))) snapshot.commenceTime = "2026-07-11T06:00:00Z";
  if (!Number.isFinite(snapshot.odds) || snapshot.odds <= 1) snapshot.odds = 2;
  if (!Number.isFinite(snapshot.chance)) snapshot.chance = 0.55;
  if (!snapshot.modelVersion) snapshot.modelVersion = "self-test-v1";
  return snapshot;
}

test("preserves quarter-line settlement and push denominators", () => {
  const snapshots = [
    { matchId: "win", market: TOTALS, prediction: "大", line: 2.25 },
    { matchId: "half-win", market: TOTALS, prediction: "大", line: 2.75 },
    { matchId: "push", market: TOTALS, prediction: "大", line: 3 },
    { matchId: "half-loss", market: TOTALS, prediction: "大", line: 3.25 },
    { matchId: "loss", market: TOTALS, prediction: "大", line: 3.25 },
  ].map(validSnapshot);
  const response = buildBacktest(snapshots, [
    { matchId: "win", market: TOTALS, actual: "3 球" },
    { matchId: "half-win", market: TOTALS, actual: "3 球" },
    { matchId: "push", market: TOTALS, actual: "3 球" },
    { matchId: "half-loss", market: TOTALS, actual: "3 球" },
    { matchId: "loss", market: TOTALS, actual: "2 球" },
  ], NOW);

  assert.deepEqual(response.rows.map((row) => row.settlement), ["win", "half-win", "push", "half-loss", "loss"]);
  assert.equal(response.summary.hitRate, 3 / 6);
});

test("preserves every inline-self-test Asian handicap and corner settlement branch", () => {
  const response = buildBacktest([
    { matchId: "corner-half-win", market: CORNERS, prediction: "大角", line: 9.75 },
    { matchId: "corner-half-loss", market: CORNERS, prediction: "大角", line: 9.25 },
    { matchId: "hdc-half-win", market: HANDICAP, prediction: "主", line: -0.75 },
    { matchId: "hdc-half-loss", market: HANDICAP, prediction: "主", line: -0.25 },
    { matchId: "hdc-push", market: HANDICAP, prediction: "主", line: -1 },
    { matchId: "hdc-away", market: HANDICAP, prediction: "客", line: -0.25 },
  ].map(validSnapshot), [
    { matchId: "corner-half-win", market: CORNERS, actual: "10 角球" },
    { matchId: "corner-half-loss", market: CORNERS, actual: "9 角球" },
    { matchId: "hdc-half-win", market: HANDICAP, actual: "2-1" },
    { matchId: "hdc-half-loss", market: HANDICAP, actual: "1-1" },
    { matchId: "hdc-push", market: HANDICAP, actual: "2-1" },
    { matchId: "hdc-away", market: HANDICAP, actual: "1-1" },
  ], NOW);

  assert.deepEqual(response.rows.map((row) => row.settlement), ["half-win", "half-loss", "half-win", "half-loss", "push", "half-win"]);
});

test("preserves handicap settlement and classification while excluding legacy snapshots from active readiness", () => {
  const snapshots = [
    { matchId: "hdc", market: HANDICAP, prediction: "主", line: -0.75 },
    { matchId: "upcoming", market: TOTALS, prediction: "細", line: 2.5, commenceTime: "2026-07-11T13:00:00Z", modelVersion: "totals-loo-v1" },
    { matchId: "overdue", market: TOTALS, prediction: "大", line: 2.5, commenceTime: "2026-07-11T06:00:00Z", modelVersion: "totals-loo-v1" },
    { matchId: "overdue", market: TOTALS, prediction: "大", line: 3, commenceTime: "2026-07-11T06:00:00Z", modelVersion: "totals-loo-v1" },
  ].map(validSnapshot);
  snapshots.push(
    { ...validSnapshot({ matchId: "invalid", market: TOTALS, prediction: "大", line: 2.5 }), commenceTime: undefined },
    { ...validSnapshot({ matchId: "legacy", market: TOTALS, prediction: "大", line: 2.5 }), modelVersion: undefined },
  );
  const response = buildBacktest(snapshots, [
    { matchId: "hdc", market: HANDICAP, actual: "2-1" },
    { matchId: "invalid", market: TOTALS, actual: "3 球" },
    { matchId: "legacy", market: TOTALS, actual: "3 球" },
  ], NOW);
  assert.equal(response.rows[0].settlement, "half-win");
  assert.deepEqual(response.readiness, []);
  assert.equal(response.snapshotQuality.validCurrent, 4);
  assert.equal(response.snapshotQuality.legacy, 1);
  assert.equal(response.snapshotQuality.invalid, 1);
  assert.equal(response.rows.filter((row) => row.snapshotStatus === "valid-current").length, 1);
});

test("freezes versioned identities and result-source priority", () => {
  const duplicate = validSnapshot({ matchId: "same", market: TOTALS, prediction: "大", line: 2.5, modelVersion: "totals-v1" });
  const merged = mergeSnapshots([], [duplicate, { ...duplicate, odds: 9 }]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].odds, duplicate.odds);
  assert.equal(snapshotIdentity(duplicate), "same|大細波|2.5|totals-v1");
  assert.equal(snapshotIdentity({ matchId: "same", market: TOTALS, modelVersion: "totals-v1" }), "same|大細波||totals-v1");
  assert.equal(snapshotIdentity({ matchId: "same", market: TOTALS, line: 2.5 }), "same|大細波|2.5|legacy-v0");
  assert.equal(resultIdentity({ matchId: "same", market: TOTALS }), "same|大細波");
  assert.equal(providerResultIdentity({ id: "odds-1" }), "odds-1");
  assert.equal(providerResultIdentity({ matchId: "same", market: TOTALS }), "same-大細波");
  assert.equal(liveOddsIdentity({ provider: "p", matchId: "same", market: TOTALS, selection: "over", line: null }), "p|same|大細波|over|");
  assert.equal(liveOddsIdentity({ provider: "p", matchId: "same", market: TOTALS, selection: "over", line: 2.25, observedAt: "2026-07-11T01:00:00Z" }), "p|same|大細波|over|2.25");
  assert.equal(liveOddsIdentity({ provider: "p", matchId: "same", market: TOTALS, selection: "over", line: 2.25, observedAt: "2026-07-12T01:00:00Z" }), "p|same|大細波|over|2.25");
  assert.notEqual(liveOddsIdentity({ provider: "P", matchId: "same", market: TOTALS, selection: "over", line: 2.25 }), liveOddsIdentity({ provider: "p", matchId: "same", market: TOTALS, selection: "over", line: 2.25 }));
  assert.notEqual(liveOddsIdentity({ provider: "p", matchId: "same", market: TOTALS, selection: "Over", line: 2.25 }), liveOddsIdentity({ provider: "p", matchId: "same", market: TOTALS, selection: "over", line: 2.25 }));
  assert.equal(liveOddsIdentity({ provider: "p", matchId: "m", market: "h2h", selection: "home", line: null, bookmaker: "Bet365" }), "p|m|h2h|home||Bet365");
  assert.equal(liveOddsIdentity({ provider: "p", matchId: "m", market: "h2h", selection: "home", line: null, bookmaker: "Pinnacle" }), "p|m|h2h|home||Pinnacle");
  assert.equal(liveOddsIdentity({ provider: "p", matchId: "m", market: "h2h", selection: "home", line: null, bookmaker: "  " }), "p|m|h2h|home|");
  assert.equal(mergeResults([{ matchId: "m", market: HANDICAP, actual: "1-0" }], [{ matchId: "m", market: HANDICAP, actual: "2-0" }])[0].actual, "2-0");
  assert.equal(selectBacktestResults([{ matchId: "live" }], [{ matchId: "archive" }])[0].matchId, "archive");
});

test("keeps live cache, score conversion, and health shapes", () => {
  const live = flattenLiveCache({ soccer_test: { h2hEntries: [{ id: "h2h" }], handicapEntries: [{ id: "hdc" }], totalEntries: [{ id: "totals" }], cornerEntries: [{ id: "corners" }] } });
  const scores = oddsScoreRows([{ id: "odds-1", completed: true, commence_time: "2026-07-11T00:00:00Z", home_team: "A", away_team: "B", scores: [{ name: "A", score: "2" }, { name: "B", score: "1" }] }]);
  const health = buildHealth({ collector: "2026-07-11T11:40:00Z", hkjc: "2026-07-11T11:50:00Z" }, NOW);

  assert.deepEqual(live, { h2hEntries: [{ id: "h2h" }], handicapEntries: [{ id: "hdc" }], totalEntries: [{ id: "totals" }], cornerEntries: [{ id: "corners" }] });
  assert.equal(scores[1].actual, "3 球");
  assert.equal(scores[1].market, TOTALS);
  assert.deepEqual({ ok: health.ok, dataFresh: health.dataFresh, staleSources: health.staleSources }, { ok: true, dataFresh: true, staleSources: [] });
  const stale = buildHealth({ collector: "2026-07-11T10:00:00Z" }, NOW);
  assert.deepEqual({ ok: stale.ok, dataFresh: stale.dataFresh, staleSources: stale.staleSources, collectorStale: stale.sources.collector.stale, hkjcStale: stale.sources.hkjc.stale }, { ok: true, dataFresh: false, staleSources: ["collector", "hkjc"], collectorStale: true, hkjcStale: true });
});

test("freezes representative selection order, profit, ROI, and chance buckets", () => {
  const rows = [
    { matchId: "distinct", market: TOTALS, modelVersion: "totals-v1", prediction: "細", settlement: "loss", hit: false, odds: 2, edge: 0.04, savedAt: "2026-07-09T01:00:00Z", line: 2.5, chance: 0.44 },
    { matchId: "distinct", market: TOTALS, modelVersion: "totals-v1", prediction: "大", settlement: "win", hit: true, odds: 2, edge: 0.08, savedAt: "2026-07-09T02:00:00Z", line: 3, chance: 0.81 },
  ];
  const summary = summarize(rows.slice(0, 2));
  const grouped = groupSummary(rows.slice(0, 2), (row) => row.market);
  const buckets = groupSummary(rows.slice(0, 2), (row) => bucket(row.chance));

  assert.deepEqual(summary, { finished: 1, hit: 1, miss: 0, push: 0, hitRate: 1, priced: 1, profit: 1, roi: 1, yield: 1 });
  assert.deepEqual(grouped[TOTALS], summary);
  assert.deepEqual(Object.keys(buckets), ["80-85%"]);
  assert.deepEqual(buckets["80-85%"], summary);
});

test("freezes equal-edge representative tie-breakers through summary outputs", () => {
  const common = { matchId: "tie", market: TOTALS, modelVersion: "totals-v1", edge: 0.08 };
  const bySavedAt = summarize([
    { ...common, settlement: "win", hit: true, odds: 3, savedAt: "2026-07-09T01:00:00Z", line: 3 },
    { ...common, settlement: "loss", hit: false, odds: 2, savedAt: "2026-07-09T02:00:00Z", line: 2.5 },
  ]);
  const byLine = summarize([
    { ...common, settlement: "loss", hit: false, odds: 2, savedAt: "2026-07-09T01:00:00Z", line: 2.5 },
    { ...common, settlement: "win", hit: true, odds: 3, savedAt: "2026-07-09T01:00:00Z", line: 3 },
  ]);
  const byInsertionOrder = summarize([
    { ...common, settlement: "loss", hit: false, odds: 2, savedAt: "2026-07-09T01:00:00Z", line: 2.5 },
    { ...common, settlement: "win", hit: true, odds: 3, savedAt: "2026-07-09T01:00:00Z", line: 2.5 },
  ]);

  assert.deepEqual(bySavedAt, { finished: 1, hit: 1, miss: 0, push: 0, hitRate: 1, priced: 1, profit: 2, roi: 2, yield: 2 });
  assert.deepEqual(byLine, { finished: 1, hit: 0, miss: 1, push: 0, hitRate: 0, priced: 1, profit: -1, roi: -1, yield: -1 });
  assert.deepEqual(byInsertionOrder, { finished: 1, hit: 0, miss: 1, push: 0, hitRate: 0, priced: 1, profit: -1, roi: -1, yield: -1 });
});

test("freezes detailed current, legacy, and invalid snapshot classification reasons", () => {
  const valid = validSnapshot({ matchId: "quality-valid", market: TOTALS, prediction: "大", line: 2.5, edge: 0.04, modelVersion: "totals-loo-v1", source: "test" });
  const cases = [
    [{ ...valid, matchId: "" }, "invalid", "missing-match-id"],
    [{ ...valid, market: "" }, "invalid", "missing-market"],
    [{ ...valid, prediction: "" }, "invalid", "invalid-prediction"],
    [{ ...valid, savedAt: "" }, "invalid", "missing-saved-at"],
    [{ ...valid, modelVersion: undefined }, "legacy", "legacy-model"],
    [{ ...valid, commenceTime: undefined }, "invalid", "missing-commence-time"],
    [{ ...valid, savedAt: "not-a-date" }, "invalid", "invalid-saved-at"],
    [{ ...valid, commenceTime: "not-a-date" }, "invalid", "invalid-commence-time"],
    [{ ...valid, savedAt: valid.commenceTime }, "invalid", "post-kickoff"],
    [{ ...valid, odds: 1 }, "invalid", "invalid-odds"],
    [{ ...valid, chance: 2 }, "invalid", "invalid-chance"],
    [{ ...valid, edge: Number.NaN }, "invalid", "invalid-edge"],
    [{ ...valid, line: undefined }, "invalid", "missing-line"],
    [{ ...valid, line: 2.3 }, "invalid", "invalid-line"],
  ];

  assert.deepEqual(cases.map(([snapshot, status, reason]) => {
    const actual = classifySnapshot(snapshot);
    return [actual.status, actual.reason, status, reason];
  }), cases.map(([, status, reason]) => [status, reason, status, reason]));
});

test("lists unsettled valid-current snapshots as pending rows with kickoff status", () => {
  const snapshots = [
    { matchId: "upcoming", market: TOTALS, prediction: "細", line: 2.5, commenceTime: "2026-07-11T13:00:00Z", modelVersion: "totals-loo-v1" },
    { matchId: "settling", market: HANDICAP, prediction: "主", line: -0.5, commenceTime: "2026-07-11T10:30:00Z", modelVersion: "hdc-loo-v2" },
    { matchId: "overdue", market: TOTALS, prediction: "大", line: 2.5, commenceTime: "2026-07-11T06:00:00Z", modelVersion: "totals-loo-v1" },
    { matchId: "settled", market: TOTALS, prediction: "大", line: 2.5, commenceTime: "2026-07-11T06:00:00Z", modelVersion: "totals-loo-v1" },
    { ...validSnapshot({ matchId: "legacy", market: TOTALS, prediction: "大", line: 2.5, commenceTime: "2026-07-11T13:00:00Z" }), modelVersion: undefined },
  ].map((item) => (item.modelVersion === undefined ? item : validSnapshot(item)));
  const response = buildBacktest(snapshots, [
    { matchId: "settled", market: TOTALS, actual: "3 球" },
  ], NOW);

  assert.deepEqual(response.pending.map((row) => `${row.matchId}:${row.status}`), ["overdue:overdue", "settling:settling", "upcoming:upcoming"]);
  const upcoming = response.pending.find((row) => row.matchId === "upcoming");
  assert.deepEqual(
    { market: upcoming.market, prediction: upcoming.prediction, line: upcoming.line, odds: upcoming.odds, chance: upcoming.chance, savedAt: upcoming.savedAt, modelVersion: upcoming.modelVersion, source: upcoming.source },
    { market: TOTALS, prediction: "細", line: 2.5, odds: 2, chance: 0.55, savedAt: "2026-07-11T05:00:00Z", modelVersion: "totals-loo-v1", source: null },
  );
  assert.equal(response.pending.some((row) => row.matchId === "settled"), false);
  assert.equal(response.pending.some((row) => row.matchId === "legacy"), false);
});

test("settles unified opportunities independently with return ranges and distinct fixture-market readiness", () => {
  const snapshots = [
    unifiedOpportunity({
      sampleId: 1,
      fixtureId: "fixture-1",
      selection: "over",
      line: 2.5,
      observations: [
        observation("2026-07-11T08:00:00Z", [unifiedQuote("Book A", 2), unifiedQuote("Book B", 2.4)]),
        observation("2026-07-11T09:55:00Z", []),
      ],
    }),
    unifiedOpportunity({
      sampleId: 2,
      fixtureId: "fixture-1",
      selection: "under",
      line: 3,
      observations: [
        observation("2026-07-11T08:05:00Z", [unifiedQuote("Book A", 2.1)]),
        observation("2026-07-11T09:50:00Z", [unifiedQuote("Book B", 2.3)]),
      ],
    }),
    unifiedOpportunity({ sampleId: 3, fixtureId: "fixture-void", selection: "over", line: 2.5 }),
    unifiedOpportunity({ sampleId: 4, fixtureId: "fixture-unsettleable", selection: "over", line: 2.5 }),
    validSnapshot({ matchId: "legacy", market: TOTALS, prediction: "大", line: 2.5 }),
  ];
  const response = buildBacktest(snapshots, [
    { fixtureId: "fixture-1", matchId: "provider-fixture-1", market: "totals", actual: "3 球" },
    { fixtureId: "fixture-void", market: "totals", actual: "void", status: "void" },
    { fixtureId: "fixture-unsettleable", market: "totals", status: "unsettleable" },
    { matchId: "legacy", market: TOTALS, actual: "3 球" },
  ], NOW);

  const unifiedRows = response.rows.filter((row) => row.strategyVersion === "unified-buyable-v1");
  assert.deepEqual(unifiedRows.slice(0, 2).map((row) => [row.sampleId, row.settlement]), [[1, "win"], [2, "push"]]);
  assert.equal(response.rows.find((row) => row.matchId === "legacy")?.settlement, "win", "legacy audit rows survive alongside unified performance");
  assert.deepEqual(unifiedRows[0].unitProfitRange, { lower: 1, upper: 1.4 });
  assert.deepEqual(unifiedRows[1].unitProfitRange, { lower: 0, upper: 0 });
  assert.equal(unifiedRows[0].closingBenchmark, "N/A");
  assert.deepEqual(unifiedRows[1].closingBenchmark, {
    evaluatedAt: "2026-07-11T09:50:00Z",
    quoteRange: { min: 2.3, max: 2.3, count: 1 },
  });

  assert.equal(response.summary.finished, 2, "void, unsettleable, and legacy strategies do not enter active performance");
  assert.deepEqual({ hit: response.summary.hit, miss: response.summary.miss, push: response.summary.push }, { hit: 1, miss: 0, push: 1 });
  assert.deepEqual(response.summary.profitRange, { lower: 1, upper: 1.4 });
  assert.deepEqual(response.summary.roiRange, { lower: 0.5, upper: 0.7 });
  const readiness = response.readiness.find((row) => row.market === "totals" && row.modelVersion === "totals-loo-v1");
  assert.equal(readiness.strategyVersion, "unified-buyable-v1");
  assert.equal(readiness.settled, 1, "two settled selections on the same fixture and market count once");
  assert.equal(readiness.settledMatches, 1);
  assert.equal(response.readiness.some((row) => row.strategyVersion !== "unified-buyable-v1"), false);
});

function unifiedOpportunity(overrides = {}) {
  return {
    sampleId: 1,
    fixtureId: "fixture-1",
    matchId: "provider-fixture-1",
    homeTeam: "Alpha",
    awayTeam: "Beta",
    commenceTime: "2026-07-11T10:00:00Z",
    market: "totals",
    selection: "over",
    line: 2.5,
    modelVersion: "totals-loo-v1",
    strategyVersion: "unified-buyable-v1",
    firstQualifiedAt: "2026-07-11T08:00:00Z",
    lastQualifiedAt: "2026-07-11T09:50:00Z",
    observations: [observation("2026-07-11T08:00:00Z", [unifiedQuote("Book A", 2)])],
    ...overrides,
  };
}

function observation(lastEvaluatedAt, buyableQuotes) {
  return { firstEvaluatedAt: lastEvaluatedAt, lastEvaluatedAt, inputs: [], buyableQuotes };
}

function unifiedQuote(bookmaker, odds) {
  return { bookmaker, provider: "test", odds, chance: 0.5, edge: odds * 0.5 - 1, minimumBuyOdds: 2.06, observedAt: "2026-07-11T07:55:00Z" };
}
