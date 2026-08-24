import assert from "node:assert/strict";
import test from "node:test";

import { replayGrid } from "./replay-quote-gate.mjs";

function quote(odds, edge) {
  return {
    bookmaker: "Superbet",
    provider: "hdc",
    odds,
    edge,
    observedAt: "2026-08-24T12:00:00.000Z",
  };
}

test("replay attributes partial quote rejection without netting winners against losers", () => {
  const units = [{
    sampleId: 1,
    fixtureId: "fx-loss",
    market: "corners",
    selection: "over",
    line: 9.5,
    quotes: [quote(12, 0.5), quote(2, 0.05)],
    inputs: [],
    settlement: "loss",
  }, {
    sampleId: 2,
    fixtureId: "fx-win",
    market: "corners",
    selection: "under",
    line: 9.5,
    quotes: [quote(2.05, 0.05)],
    inputs: [],
    settlement: "win",
  }];

  const report = replayGrid(units);
  assert.equal(report.totalLoss, -2, "both losing quotes remain in the gross denominator");
  assert.ok(Math.abs(report.totalGain - 1.05) < 1e-12, "winning profit is not netted against losses");
  const row = report.rows.find((entry) => entry.label === "corners≤6 edge≤0.15 sharp≤∞");
  assert.ok(row);
  assert.equal(row.kept, 2, "the losing recommendation survives through its second quote");
  assert.equal(row.blocked, 0);
  assert.equal(row.lossBlockedPct, 0.5, "the rejected losing quote is still attributed");
  assert.equal(row.gainBlockedPct, 0);
});
