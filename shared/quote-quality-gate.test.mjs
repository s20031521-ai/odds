import assert from "node:assert/strict";
import test from "node:test";

import {
  GATE_REASONS,
  QUOTE_GATE_CONFIG,
} from "./quote-gate-config.mjs";
import {
  buildGatedOpportunity,
  gateContextRows,
  gateOpportunityQuotes,
  gatedStrategyVersion,
  isGatedStrategyVersion,
  sharpConsensus,
} from "./quote-quality-gate.mjs";

const T0 = "2026-08-24T03:00:00.000Z";
const T_STALE = "2026-08-24T02:30:00.000Z"; // 30 min before T0 → beyond 15-min staleness

function row(bookmaker, selection, odds, overrides = {}) {
  return {
    fixtureId: "fx-1",
    homeTeam: "Alpha",
    awayTeam: "Beta",
    provider: "hdc",
    bookmaker,
    market: "corners",
    selection,
    line: 9.5,
    odds,
    observedAt: T0,
    ...overrides,
  };
}

function quote(bookmaker, odds, edge, overrides = {}) {
  return {
    bookmaker,
    provider: "hdc",
    odds,
    chance: 0.5,
    edge,
    minimumBuyOdds: 1,
    observedAt: T0,
    ...overrides,
  };
}

// A balanced corners 9.5 market from two allowlisted sharp books:
// over 1.90 / under 1.90 each → sharp over chance = 0.5.
function balancedRows() {
  return [
    row("Pinnacle", "over", 1.9),
    row("Pinnacle", "under", 1.9),
    row("Bet365", "over", 1.9),
    row("Bet365", "under", 1.9),
  ];
}

function cornersOpportunity(quotes) {
  return {
    fixtureId: "fx-1",
    market: "corners",
    selection: "over",
    line: 9.5,
    quotes,
  };
}

// ---------- odds cap ----------

test("odds above the per-market cap are rejected with odds-cap-exceeded", () => {
  const { quotes, rejected } = gateOpportunityQuotes(
    cornersOpportunity([quote("Superbet", 6.5, 0.05)]),
    balancedRows(),
  );
  assert.equal(quotes.length, 0);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reasons.includes(GATE_REASONS.oddsCap));
});

test("odds at exactly the cap survive", () => {
  // Sharp books price over 9.5 as a real longshot (fair ≈ 0.187), so a 4.0
  // quote is near fair — only the odds cap itself is under test here.
  // (v2: corners cap tightened 6.0 → 4.0 per the 2026-08-24 replay.)
  const longshotRows = [
    row("Pinnacle", "over", 5.0), row("Pinnacle", "under", 1.15),
    row("Bet365", "over", 5.0), row("Bet365", "under", 1.15),
  ];
  const { quotes } = gateOpportunityQuotes(
    cornersOpportunity([quote("Superbet", 4.0, 0.05)]),
    longshotRows,
  );
  assert.equal(quotes.length, 1);
});

// ---------- edge cap ----------

test("edge above the symmetric cap is rejected with edge-cap-exceeded", () => {
  const { quotes, rejected } = gateOpportunityQuotes(
    cornersOpportunity([quote("Superbet", 2.1, 0.20)]),
    balancedRows(),
  );
  assert.equal(quotes.length, 0);
  assert.ok(rejected[0].reasons.includes(GATE_REASONS.edgeCap));
});

test("edge at exactly the cap survives", () => {
  // The pre-registered shadow cap is shared across markets.
  const { quotes } = gateOpportunityQuotes(
    cornersOpportunity([quote("Superbet", 2.1, 0.10)]),
    balancedRows(),
  );
  assert.equal(quotes.length, 1);
});

test("pre-registered shadow edge cap treats 0.12 consistently across markets", () => {
  // Retrospective replay does not tighten the corners cap independently.
  const corners = gateOpportunityQuotes(
    cornersOpportunity([quote("Superbet", 2.1, 0.12)]),
    balancedRows(),
  );
  assert.equal(corners.quotes.length, 1);
  assert.equal(corners.rejected.length, 0);

  const h2h = gateOpportunityQuotes(
    { fixtureId: "fx-1", market: "h2h", selection: "home", quotes: [quote("Superbet", 2.1, 0.12)] },
    [],
  );
  assert.equal(h2h.quotes.length, 1);
});

// ---------- sharp consensus deviation ----------

test("a quote far above the sharp consensus is rejected even with a small model edge", () => {
  // Sharp consensus says over chance = 0.5; quote at 2.9 → sharp edge 0.45
  // but the (soft-book polluted) model only reported edge 0.08.
  const { quotes, rejected } = gateOpportunityQuotes(
    cornersOpportunity([quote("Superbet", 2.9, 0.08)]),
    balancedRows(),
  );
  assert.equal(quotes.length, 0);
  assert.ok(rejected[0].reasons.includes(GATE_REASONS.sharpDeviation));
});

test("a reasonable deviation from the sharp consensus survives", () => {
  // quote 2.05 vs sharp chance 0.5 → sharp edge 0.025.
  const { quotes } = gateOpportunityQuotes(
    cornersOpportunity([quote("Betway", 2.05, 0.05)]),
    balancedRows(),
  );
  assert.equal(quotes.length, 1);
});

test("deviation check fails open when no allowlisted consensus exists", () => {
  // Only soft books in context → no consensus → high-deviation quote survives
  // (other checks may still fire; here odds/edge are inside limits).
  const softRows = [
    row("Superbet", "over", 1.9),
    row("Superbet", "under", 1.9),
    row("1xBet", "over", 1.9),
    row("1xBet", "under", 1.9),
  ];
  const { quotes, rejected } = gateOpportunityQuotes(
    cornersOpportunity([quote("Superbet", 2.9, 0.08)]),
    softRows,
  );
  assert.equal(quotes.length, 1);
  assert.equal(rejected.length, 0);
});

test("soft books never enter the sharp consensus", () => {
  const rows = [
    ...balancedRows(),
    row("Superbet", "over", 9.0), // wild misprice from a soft book
    row("Superbet", "under", 1.05),
  ];
  const consensus = sharpConsensus(rows, "corners");
  assert.ok(consensus);
  assert.equal(consensus.bookCount, 2);
  assert.ok(Math.abs(consensus.chanceFor("over") - 0.5) < 1e-9);
});

// ---------- relative staleness ----------

test("a quote much older than the freshest peer is rejected as stale", () => {
  const { quotes, rejected } = gateOpportunityQuotes(
    cornersOpportunity([quote("Betfair", 2.05, 0.05, { observedAt: T_STALE })]),
    balancedRows(),
  );
  assert.equal(quotes.length, 0);
  assert.ok(rejected[0].reasons.includes(GATE_REASONS.relativeStale));
});

test("a quote within the staleness window survives", () => {
  const recent = "2026-08-24T02:50:00.000Z"; // 10 min before T0
  const { quotes } = gateOpportunityQuotes(
    cornersOpportunity([quote("Betfair", 2.05, 0.05, { observedAt: recent })]),
    balancedRows(),
  );
  assert.equal(quotes.length, 1);
});

// ---------- line monotonicity ----------

test("the generous side of a non-monotonic line pair is rejected", () => {
  // Same book: over@9.5 pays 2.20 but over@10.5 (harder) pays 1.95.
  // Over odds must RISE with the line → violation; the 2.20 quote is the
  // generous one → rejected.
  const rows = [
    ...balancedRows(),
    row("Betway", "over", 2.2),
    row("Betway", "under", 1.72),
    row("Betway", "over", 1.95, { line: 10.5 }),
    row("Betway", "under", 1.85, { line: 10.5 }),
  ];
  const { quotes, rejected } = gateOpportunityQuotes(
    cornersOpportunity([quote("Betway", 2.2, 0.10)]),
    rows,
  );
  assert.equal(quotes.length, 0);
  assert.ok(rejected[0].reasons.includes(GATE_REASONS.nonMonotonic));
});

test("the cheap side of a non-monotonic pair is NOT flagged by monotonicity", () => {
  // Evaluating over@10.5 at 1.95 while over@9.5 pays 2.20: violation exists
  // but the evaluated quote is the cheap side → no monotonicity rejection.
  const rows = [
    ...balancedRows(),
    row("Betway", "over", 2.2),
    row("Betway", "under", 1.72),
    row("Betway", "over", 1.95, { line: 10.5 }),
    row("Betway", "under", 1.85, { line: 10.5 }),
  ];
  const { quotes } = gateOpportunityQuotes(
    { fixtureId: "fx-1", market: "corners", selection: "over", line: 10.5, quotes: [quote("Betway", 1.95, 0.04)] },
    rows,
  );
  assert.equal(quotes.length, 1);
});

test("monotonic same-book lines pass", () => {
  const rows = [
    ...balancedRows(),
    row("Betway", "over", 1.85),
    row("Betway", "under", 1.95),
    row("Betway", "over", 2.1, { line: 10.5 }),
    row("Betway", "under", 1.78, { line: 10.5 }),
  ];
  const { quotes } = gateOpportunityQuotes(
    cornersOpportunity([quote("Betway", 1.85, 0.04)]),
    rows,
  );
  assert.equal(quotes.length, 1);
});

// ---------- h2h ----------

test("h2h uses Shin consensus and its own odds cap", () => {
  const rows = [
    { fixtureId: "fx-1", provider: "hdc", bookmaker: "Pinnacle", market: "h2h", selection: "home", odds: 2.0, observedAt: T0 },
    { fixtureId: "fx-1", provider: "hdc", bookmaker: "Pinnacle", market: "h2h", selection: "draw", odds: 3.5, observedAt: T0 },
    { fixtureId: "fx-1", provider: "hdc", bookmaker: "Pinnacle", market: "h2h", selection: "away", odds: 3.8, observedAt: T0 },
    { fixtureId: "fx-1", provider: "hdc", bookmaker: "Bet365", market: "h2h", selection: "home", odds: 2.0, observedAt: T0 },
    { fixtureId: "fx-1", provider: "hdc", bookmaker: "Bet365", market: "h2h", selection: "draw", odds: 3.5, observedAt: T0 },
    { fixtureId: "fx-1", provider: "hdc", bookmaker: "Bet365", market: "h2h", selection: "away", odds: 3.8, observedAt: T0 },
  ];
  const consensus = sharpConsensus(rows, "h2h");
  assert.ok(consensus);
  assert.ok(Math.abs(consensus.chanceFor("home") + consensus.chanceFor("draw") + consensus.chanceFor("away") - 1) < 1e-9);

  const { rejected } = gateOpportunityQuotes(
    { fixtureId: "fx-1", market: "h2h", selection: "away", quotes: [quote("Superbet", 8.5, 0.05)] },
    rows,
  );
  assert.ok(rejected[0].reasons.includes(GATE_REASONS.oddsCap));
});

// ---------- structural ----------

test("quotes can carry several reason codes at once", () => {
  // 12.0 odds: over the odds cap AND far from consensus AND (edge) over cap.
  const { rejected } = gateOpportunityQuotes(
    cornersOpportunity([quote("Superbet", 12.0, 0.5)]),
    balancedRows(),
  );
  assert.ok(rejected[0].reasons.includes(GATE_REASONS.oddsCap));
  assert.ok(rejected[0].reasons.includes(GATE_REASONS.edgeCap));
  assert.ok(rejected[0].reasons.includes(GATE_REASONS.sharpDeviation));
});

test("unknown markets and empty quote sets are safe no-ops", () => {
  assert.deepEqual(gateOpportunityQuotes({ market: "corners", selection: "over", line: 9.5, quotes: [] }, []), { quotes: [], rejected: [] });
  const { quotes } = gateOpportunityQuotes(
    { fixtureId: "fx-1", market: "mystery", selection: "over", quotes: [quote("X", 2.0, 0.05)] },
    [],
  );
  assert.equal(quotes.length, 1);
});

test("gate context selects same-fixture same-market rows across all lines", () => {
  const inputs = [
    row("Pinnacle", "over", 1.9),
    row("Pinnacle", "over", 2.1, { line: 10.5 }),
    row("Pinnacle", "over", 1.9, { fixtureId: "fx-2" }),
    row("Pinnacle", "home", 1.9, { market: "handicap", line: -0.5 }),
  ];
  const context = gateContextRows(inputs, { fixtureId: "fx-1", market: "corners" });
  assert.equal(context.length, 2);
});

// ---------- gated shadow twin ----------

test("buildGatedOpportunity suffixes the strategy and audits rejections", () => {
  const opportunity = {
    ...cornersOpportunity([quote("Superbet", 12.0, 0.5), quote("Betway", 2.05, 0.05)]),
    strategyVersion: "market-sharp-v1",
    modelVersion: "corner-sharp-v1",
  };
  const gated = buildGatedOpportunity(opportunity, balancedRows());
  assert.equal(gated.strategyVersion, "market-sharp-v1-gated");
  assert.equal(gated.quotes.length, 1);
  assert.equal(gated.quotes[0].bookmaker, "Betway");
  assert.equal(gated.quoteGate.rejectedQuotes, 1);
  assert.ok(gated.quoteGate.reasons[GATE_REASONS.oddsCap] >= 1);
  // Ungated twin untouched.
  assert.equal(opportunity.strategyVersion, "market-sharp-v1");
  assert.equal(opportunity.quotes.length, 2);
});

test("empty shells stay empty through the gated twin", () => {
  const gated = buildGatedOpportunity(
    { fixtureId: "fx-1", market: "corners", selection: "over", line: 9.5, quotes: [], strategyVersion: "dc-blend-v2" },
    balancedRows(),
  );
  assert.equal(gated.strategyVersion, "dc-blend-v2-gated");
  assert.equal(gated.quoteGate.version, "quote-gate-v1-shadow");
  assert.deepEqual(gated.quotes, []);
  assert.equal(gated.quoteGate.rejectedQuotes, 0);
});

test("gatedStrategyVersion helpers round-trip", () => {
  assert.equal(gatedStrategyVersion("dc-blend-v2"), "dc-blend-v2-gated");
  assert.ok(isGatedStrategyVersion("dc-blend-v2-gated"));
  assert.equal(isGatedStrategyVersion("dc-blend-v2"), false);
});

// ---------- config sanity ----------

test("config keeps the frozen 3% floor untouched and caps symmetric-ish", () => {
  for (const [market, cap] of Object.entries(QUOTE_GATE_CONFIG.maxEdge)) {
    assert.ok(cap > 0.03, `gate ceiling (${market}) must sit above the 3% buy floor`);
  }
  assert.equal(QUOTE_GATE_CONFIG.maxOdds.corners, 6.0);
  assert.equal(QUOTE_GATE_CONFIG.maxOdds.h2h, 8.0);
});
