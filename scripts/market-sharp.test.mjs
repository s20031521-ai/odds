import assert from "node:assert/strict";
import test from "node:test";

import { fairProbabilitiesForOdds, minimumBuyOdds } from "../shared/unified-recommendations.mjs";
import {
  SHARP_MODEL_VERSIONS,
  SHARP_STRATEGY_VERSION,
  bookmakerWeight,
  buildSharpOpportunities,
  powerNoVigTwoWay,
  shinProbabilities,
} from "./lib/market-sharp.mjs";

// ---------- weights ----------

test("bookmakerWeight tiers sharp books above soft books and HKJC lowest", () => {
  assert.equal(bookmakerWeight("Pinnacle"), 1.0);
  assert.equal(bookmakerWeight("Marathonbet"), 0.9);
  assert.equal(bookmakerWeight(" Bet365 "), 0.6);
  assert.equal(bookmakerWeight("1xBet"), 0.3);
  assert.equal(bookmakerWeight("HKJC"), 0.1);
  assert.equal(bookmakerWeight("香港賽馬會"), 0.1);
  assert.equal(bookmakerWeight("Some Unknown Book"), 0.4);
  assert.ok(bookmakerWeight("Pinnacle") > bookmakerWeight("Bet365"));
  assert.ok(bookmakerWeight("Bet365") > bookmakerWeight("1xBet"));
});

// ---------- Shin de-vig ----------

test("shinProbabilities sums to one for typical three-way odds", () => {
  const fair = shinProbabilities({ home: 2.0, draw: 3.5, away: 3.8 });
  const total = fair.home + fair.draw + fair.away;
  assert.ok(Math.abs(total - 1) < 1e-9, `sum ${total}`);
});

test("shinProbabilities is exact when the book carries no margin", () => {
  const fair = shinProbabilities({ home: 2, draw: 3, away: 6 });
  assert.ok(Math.abs(fair.home - 0.5) < 1e-12);
  assert.ok(Math.abs(fair.draw - 1 / 3) < 1e-12);
  assert.ok(Math.abs(fair.away - 1 / 6) < 1e-12);
});

test("shinProbabilities corrects favourite-longshot bias vs proportional de-vig", () => {
  const odds = { home: 1.5, draw: 4.5, away: 7.0 };
  const shin = shinProbabilities(odds);
  const proportional = fairProbabilitiesForOdds(odds);
  assert.ok(shin.home > proportional.home, "favourite priced shorter than proportional");
  assert.ok(shin.away < proportional.away, "longshot inflation removed");
});

test("shinProbabilities rejects invalid odds", () => {
  assert.equal(shinProbabilities({ home: 1, draw: 3, away: 3 }), null);
  assert.equal(shinProbabilities({ home: Number.NaN, draw: 3, away: 3 }), null);
  assert.equal(shinProbabilities(null), null);
});

// ---------- power de-vig ----------

test("powerNoVigTwoWay splits symmetric odds evenly", () => {
  const [over, under] = powerNoVigTwoWay(1.9, 1.9);
  assert.ok(Math.abs(over - 0.5) < 1e-9);
  assert.ok(Math.abs(under - 0.5) < 1e-9);
});

test("powerNoVigTwoWay is exact without margin and handles asymmetric books", () => {
  assert.deepEqual(powerNoVigTwoWay(2, 2), [0.5, 0.5]);
  const [fav, dog] = powerNoVigTwoWay(1.5, 2.8);
  assert.ok(Math.abs(fav + dog - 1) < 1e-9);
  assert.ok(fav > 0.6 && fav < 0.67); // proportional would be 0.651
  assert.equal(powerNoVigTwoWay(1, 2), null);
});

// ---------- opportunity building ----------

function sharpRow(overrides) {
  return {
    fixtureId: "fix-1",
    matchId: "match-1",
    homeTeam: "Alpha",
    awayTeam: "Beta",
    commenceTime: "2026-08-20T12:00:00.000Z",
    league: "EPL",
    provider: "hdc",
    bookmaker: "Pinnacle",
    market: "h2h",
    selection: "home",
    odds: 2.0,
    observedAt: "2026-08-20T09:00:00.000Z",
    ...overrides,
  };
}

test("buildSharpOpportunities prices h2h with the weighted Shin consensus", () => {
  const rows = [
    sharpRow({ selection: "home", odds: 2.0 }),
    sharpRow({ selection: "draw", odds: 3.5 }),
    sharpRow({ selection: "away", odds: 3.8 }),
    sharpRow({ bookmaker: "1xBet", selection: "home", odds: 2.05 }),
    sharpRow({ bookmaker: "1xBet", selection: "draw", odds: 3.4 }),
    sharpRow({ bookmaker: "1xBet", selection: "away", odds: 3.6 }),
    // A soft book dangling a generous home price — the qualifier.
    sharpRow({ bookmaker: "Bovada", selection: "home", odds: 2.6 }),
    sharpRow({ bookmaker: "Bovada", selection: "draw", odds: 3.3 }),
    sharpRow({ bookmaker: "Bovada", selection: "away", odds: 2.8 }),
  ];
  const opportunities = buildSharpOpportunities(rows);
  const home = opportunities.find((item) => item.market === "h2h" && item.selection === "home");
  assert.ok(home);
  assert.equal(home.strategyVersion, SHARP_STRATEGY_VERSION);
  assert.equal(home.modelVersion, "consensus-v2");

  const pinnacleFair = shinProbabilities({ home: 2.0, draw: 3.5, away: 3.8 });
  const softFair = shinProbabilities({ home: 2.05, draw: 3.4, away: 3.6 });
  const bovadaFair = shinProbabilities({ home: 2.6, draw: 3.3, away: 2.8 });
  const expected = (1.0 * pinnacleFair.home + 0.3 * softFair.home + 0.25 * bovadaFair.home) / 1.55;
  const quotes = home.quotes;
  assert.deepEqual(quotes.map((quote) => quote.bookmaker), ["Bovada"],
    "only the soft overlay clears the 3% gate against the consensus");
  for (const quote of quotes) {
    assert.ok(Math.abs(quote.chance - expected) < 1e-9);
    assert.ok(Math.abs(quote.edge - (quote.odds * expected - 1)) < 1e-9);
    assert.equal(quote.minimumBuyOdds, minimumBuyOdds(expected));
  }
});

test("buildSharpOpportunities lets the sharp book dominate the consensus", () => {
  const rows = [
    // Pinnacle: home is a coin flip
    sharpRow({ selection: "home", odds: 1.95 }),
    sharpRow({ selection: "draw", odds: 3.6 }),
    sharpRow({ selection: "away", odds: 4.2 }),
    // Soft book: wildly different view
    sharpRow({ bookmaker: "Bovada", selection: "home", odds: 3.2 }),
    sharpRow({ bookmaker: "Bovada", selection: "draw", odds: 3.0 }),
    sharpRow({ bookmaker: "Bovada", selection: "away", odds: 2.2 }),
  ];
  const home = buildSharpOpportunities(rows).find((item) => item.selection === "home");
  const pinnacleFair = shinProbabilities({ home: 1.95, draw: 3.6, away: 4.2 });
  const softFair = shinProbabilities({ home: 3.2, draw: 3.0, away: 2.2 });
  const expected = (1.0 * pinnacleFair.home + 0.25 * softFair.home) / 1.25;
  const quote = home.quotes[0];
  assert.ok(Math.abs(quote.chance - expected) < 1e-9);
  assert.ok(Math.abs(quote.chance - pinnacleFair.home) < Math.abs(quote.chance - softFair.home),
    "consensus sits much closer to the sharp book");
});

test("buildSharpOpportunities prices point markets with sharp-weighted leave-one-out", () => {
  const rows = [
    sharpRow({ market: "totals", selection: "over", line: 2.5, odds: 1.95, bookmaker: "Pinnacle" }),
    sharpRow({ market: "totals", selection: "under", line: 2.5, odds: 1.95, bookmaker: "Pinnacle" }),
    sharpRow({ market: "totals", selection: "over", line: 2.5, odds: 2.1, bookmaker: "1xBet" }),
    sharpRow({ market: "totals", selection: "under", line: 2.5, odds: 1.75, bookmaker: "1xBet" }),
  ];
  const opportunities = buildSharpOpportunities(rows);
  const over = opportunities.find((item) => item.market === "totals" && item.selection === "over");
  assert.ok(over);
  assert.equal(over.modelVersion, "totals-sharp-v1");
  assert.equal(over.line, 2.5);

  // For each book the chance comes from the peer only (single peer here).
  const [peerOver] = powerNoVigTwoWay(1.95, 1.95);
  const [softOver] = powerNoVigTwoWay(2.1, 1.75);
  const softQuote = over.quotes.find((quote) => quote.bookmaker === "1xBet");
  const pinnacleQuote = over.quotes.find((quote) => quote.bookmaker === "Pinnacle");
  if (softQuote) assert.ok(Math.abs(softQuote.chance - peerOver) < 1e-9);
  if (pinnacleQuote) assert.ok(Math.abs(pinnacleQuote.chance - softOver) < 1e-9);
  // 1xBet over at 2.1 against Pinnacle's 50/50 → edge 2.1*0.5-1 = 0.05 qualifies
  assert.ok(softQuote, "the soft-book overlay qualifies against the sharp peer");
  assert.ok(Math.abs(softQuote.edge - 0.05) < 1e-6);
});

test("buildSharpOpportunities emits empty shells when no quote clears the gate", () => {
  const rows = [
    sharpRow({ market: "totals", selection: "over", line: 2.5, odds: 1.9 }),
    sharpRow({ market: "totals", selection: "under", line: 2.5, odds: 1.9 }),
    sharpRow({ market: "totals", selection: "over", line: 2.5, odds: 1.9, bookmaker: "Bet365" }),
    sharpRow({ market: "totals", selection: "under", line: 2.5, odds: 1.9, bookmaker: "Bet365" }),
  ];
  const opportunities = buildSharpOpportunities(rows);
  assert.equal(opportunities.length, 2);
  assert.equal(opportunities.every((item) => item.quotes.length === 0), true);
});

test("buildSharpOpportunities covers corners and prefers the hkjc owner row", () => {
  const rows = [
    sharpRow({ market: "corners", selection: "over", line: 9.5, odds: 2.4, bookmaker: "Marathonbet" }),
    sharpRow({ market: "corners", selection: "under", line: 9.5, odds: 1.6, bookmaker: "Marathonbet" }),
    sharpRow({
      market: "corners", selection: "over", line: 9.5, odds: 2.2, bookmaker: "HKJC",
      provider: "hkjc", homeTeam: "阿法", awayTeam: "比達",
    }),
    sharpRow({
      market: "corners", selection: "under", line: 9.5, odds: 1.75, bookmaker: "HKJC", provider: "hkjc",
    }),
  ];
  const opportunities = buildSharpOpportunities(rows);
  const over = opportunities.find((item) => item.market === "corners" && item.selection === "over");
  assert.ok(over);
  assert.equal(over.modelVersion, "corner-sharp-v1");
  assert.equal(over.homeTeam, "阿法", "display fields come from the hkjc row");
});

test("buildSharpOpportunities ignores unsupported markets and incomplete books", () => {
  const rows = [
    sharpRow({ market: "btts", selection: "yes", odds: 2 }),
    sharpRow({ selection: "home", odds: 2.5, fixtureId: "fix-2" }), // no draw/away → incomplete
  ];
  const opportunities = buildSharpOpportunities(rows);
  assert.equal(opportunities.every((item) => item.market !== "btts"), true);
  const fix2 = opportunities.filter((item) => item.fixtureId === "fix-2");
  assert.equal(fix2.length, 3, "shells still emitted for the incomplete group");
  assert.equal(fix2.every((item) => item.quotes.length === 0), true);
});

test("buildSharpOpportunities uses every SHARP_MODEL_VERSIONS market", () => {
  assert.deepEqual(Object.keys(SHARP_MODEL_VERSIONS).sort(), ["corners", "h2h", "handicap", "totals"]);
});
