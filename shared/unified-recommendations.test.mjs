import assert from "node:assert/strict";
import test from "node:test";

import {
  BUY_EDGE_THRESHOLD,
  FRESHNESS_MS,
  UNIFIED_STRATEGY_VERSION,
  canonicalBookmaker,
  dedupeFreshQuotes,
  evaluateUnifiedOdds,
  minimumBuyOdds,
  observationFingerprint,
} from "./unified-recommendations.mjs";

const EVALUATED_AT = "2026-07-22T12:00:00.000Z";
const OBSERVED_AT = "2026-07-22T11:45:00.000Z";
const KICKOFF = "2026-07-22T15:00:00.000Z";

test("exports the fixed strategy constants and rounds minimum buy odds up to two decimals", () => {
  assert.equal(UNIFIED_STRATEGY_VERSION, "unified-buyable-v1");
  assert.equal(BUY_EDGE_THRESHOLD, 0.03);
  assert.equal(FRESHNESS_MS, 45 * 60_000);
  assert.equal(minimumBuyOdds(0.55), 1.88);
});

test("keeps the exact freshness boundary and rejects future observations", () => {
  const boundary = quote({ observedAt: "2026-07-22T11:15:00.000Z" });
  const stale = quote({ id: "stale", bookmaker: "Book B", observedAt: "2026-07-22T11:14:59.999Z" });
  const future = quote({ id: "future", bookmaker: "Book C", observedAt: "2026-07-22T12:00:00.001Z" });

  const fresh = dedupeFreshQuotes([boundary, stale, future], EVALUATED_AT);
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].bookmaker, "Book A");
  assert.equal(fresh[0].observedAt, boundary.observedAt);
});

test("dedupes canonical bookmaker aliases to the newest quote", () => {
  assert.equal(canonicalBookmaker(" Bet 365 "), canonicalBookmaker("BET365"));
  const older = quote({ bookmaker: "Bet 365", odds: 2.1, observedAt: "2026-07-22T11:40:00.000Z" });
  const newer = quote({ id: "newer", bookmaker: "BET365", odds: 2.25, observedAt: "2026-07-22T11:50:00.000Z" });

  const deduped = dedupeFreshQuotes([older, newer], EVALUATED_AT);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].odds, 2.25);
});

test("prefers the native HKJC provider for equal-time canonical HKJC quotes", () => {
  assert.equal(canonicalBookmaker("Hong Kong Jockey Club"), canonicalBookmaker("HKJC"));
  const relayed = quote({ bookmaker: "Hong Kong Jockey Club", provider: "relay", odds: 2.4 });
  const native = quote({ id: "native", bookmaker: "HKJC", provider: "hkjc", odds: 2.2 });

  const deduped = dedupeFreshQuotes([relayed, native], EVALUATED_AT);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].provider, "hkjc");
  assert.equal(deduped[0].odds, 2.2);
});

test("drops ambiguous equal-time duplicates and malformed or unresolved rows", () => {
  const ambiguousA = quote({ bookmaker: "Book A", provider: "feed-a", odds: 2.1 });
  const ambiguousB = quote({ id: "ambiguous-b", bookmaker: " book-a ", provider: "feed-b", odds: 2.2 });
  const malformed = quote({ id: "malformed", bookmaker: "Book B", odds: 1 });
  const unresolved = { ...quote({ id: "unresolved", bookmaker: "Book C" }), fixtureId: undefined };

  assert.deepEqual(dedupeFreshQuotes([ambiguousA, ambiguousB, malformed, unresolved], EVALUATED_AT), []);
});

test("drops equal-time canonical duplicates with conflicting output metadata in either input order", () => {
  const first = quote({ bookmaker: "Book A", provider: "feed-a", odds: 2.1, matchId: "source-a", homeTeam: "Home FC" });
  const conflicting = quote({ bookmaker: "book-a", provider: "feed-a", odds: 2.1, matchId: "source-b", homeTeam: "Different Home" });

  assert.deepEqual(dedupeFreshQuotes([first, conflicting], EVALUATED_AT), []);
  assert.deepEqual(dedupeFreshQuotes([conflicting, first], EVALUATED_AT), []);
});

test("matches analyzeEntries H2H consensus and retains every qualifying quote", () => {
  const books = [
    ["Book A", { home: 2, draw: 3.4, away: 4 }],
    ["Book B", { home: 2.15, draw: 3.25, away: 3.7 }],
    ["Book C", { home: 2.5, draw: 3.2, away: 3.6 }],
  ];
  const rows = books.flatMap(([bookmaker, odds]) => Object.entries(odds).map(([selection, price]) =>
    quote({ id: `${bookmaker}-${selection}`, bookmaker, selection, odds: price }),
  ));
  const expectedHome = books.reduce((sum, [, odds]) => {
    const total = 1 / odds.home + 1 / odds.draw + 1 / odds.away;
    return sum + (1 / odds.home) / total;
  }, 0) / books.length;

  const evaluation = evaluateUnifiedOdds(rows, EVALUATED_AT);
  const home = evaluation.opportunities.find((item) => item.market === "h2h" && item.selection === "home");
  const away = evaluation.opportunities.find((item) => item.market === "h2h" && item.selection === "away");

  assert.equal(evaluation.inputs.length, 9);
  assert.equal(home.modelVersion, "consensus-v1");
  assert.equal(home.strategyVersion, "unified-buyable-v1");
  assert.equal(home.quotes[0].bookmaker, "Book C");
  assert.ok(Math.abs(home.quotes[0].chance - expectedHome) < 1e-12);
  assert.ok(home.quotes[0].edge >= BUY_EDGE_THRESHOLD);
  assert.equal(home.quotes[0].minimumBuyOdds, minimumBuyOdds(expectedHome));
  assert.equal(away.quotes[0].bookmaker, "Book A");
});

for (const [inputMarket, market, selections, modelVersion] of [
  ["spreads", "handicap", ["home", "away"], "hdc-loo-v2"],
  ["totals", "totals", ["over", "under"], "totals-loo-v1"],
  ["alternate_totals_corners", "corners", ["over", "under"], "corner-loo-v1"],
]) {
  test(`uses per-bookmaker leave-one-out probabilities for ${market}`, () => {
    const prices = [
      ["Book A", 2.2, 1.7],
      ["Book B", 1.8, 2.05],
      ["Book C", 1.9, 1.95],
    ];
    const rows = prices.flatMap(([bookmaker, first, second]) => [
      quote({ id: `${market}-${bookmaker}-first`, bookmaker, market: inputMarket, selection: selections[0], line: 2.5, odds: first }),
      quote({ id: `${market}-${bookmaker}-second`, bookmaker, market: inputMarket, selection: selections[1], line: 2.5, odds: second }),
    ]);
    const evaluation = evaluateUnifiedOdds(rows, EVALUATED_AT);
    const first = evaluation.opportunities.find((item) => item.market === market && item.selection === selections[0]);
    const second = evaluation.opportunities.find((item) => item.market === market && item.selection === selections[1]);
    const bookA = first.quotes.find((item) => item.bookmaker === "Book A");
    const bookB = second.quotes.find((item) => item.bookmaker === "Book B");
    const bHome = noVigFirst(1.8, 2.05);
    const cHome = noVigFirst(1.9, 1.95);
    const aHome = noVigFirst(2.2, 1.7);

    assert.equal(first.modelVersion, modelVersion);
    assert.equal(first.line, 2.5);
    assert.ok(Math.abs(bookA.chance - (bHome + cHome) / 2) < 1e-12);
    assert.ok(Math.abs(bookB.chance - (1 - (aHome + cHome) / 2)) < 1e-12);
    assert.ok(bookA.edge >= BUY_EDGE_THRESHOLD);
    assert.ok(bookB.edge >= BUY_EDGE_THRESHOLD);
  });
}

test("fingerprints objects independently of key order but includes observedAt", () => {
  const left = { observedAt: OBSERVED_AT, quote: { odds: 2.1, bookmaker: "A" }, values: [1, 2] };
  const reordered = { values: [1, 2], quote: { bookmaker: "A", odds: 2.1 }, observedAt: OBSERVED_AT };
  const later = { ...left, observedAt: "2026-07-22T11:46:00.000Z" };

  assert.equal(observationFingerprint(left), observationFingerprint(reordered));
  assert.notEqual(observationFingerprint(left), observationFingerprint(later));
  assert.match(observationFingerprint(left), /^[a-f0-9]{64}$/);
  assert.equal(observationFingerprint("abc"), "6cc43f858fbb763301637b5af970e2a46b46f461f27e5a0f41e009c59b827b25");
});

function quote(overrides = {}) {
  return {
    id: "quote-a",
    fixtureId: "fixture-1",
    matchId: "source-match-1",
    homeTeam: "Home FC",
    awayTeam: "Away FC",
    commenceTime: KICKOFF,
    league: "League",
    provider: "feed-a",
    bookmaker: "Book A",
    market: "h2h",
    selection: "home",
    odds: 2.1,
    observedAt: OBSERVED_AT,
    ...overrides,
  };
}

function noVigFirst(firstOdds, secondOdds) {
  const first = 1 / firstOdds;
  return first / (first + 1 / secondOdds);
}
