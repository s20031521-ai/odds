import test from "node:test";
import assert from "node:assert/strict";

import {
  brier3,
  logLoss3,
  rps3,
  devig3,
  devig2,
  settleH2h,
  settleTotals,
  settleHandicap,
  settlementProfit,
  calibrationSummary,
  edgeBucketSummary,
  bootstrapRoiCi,
} from "./lib/backtest-metrics.mjs";

test("brier3 is zero for a perfect confident prediction and two for the worst", () => {
  assert.equal(brier3({ home: 1, draw: 0, away: 0 }, "home"), 0);
  assert.equal(brier3({ home: 0, draw: 0, away: 1 }, "home"), 2);
});

test("logLoss3 is -log(p_actual) with clamping", () => {
  assert.ok(Math.abs(logLoss3({ home: 0.5, draw: 0.3, away: 0.2 }, "home") - Math.log(2)) < 1e-12);
  assert.ok(Number.isFinite(logLoss3({ home: 0, draw: 1, away: 0 }, "home")), "zero prob clamps, not Infinity");
});

test("rps3 matches hand-computed value", () => {
  // p = (0.5, 0.3, 0.2), actual home:
  // cum1 = 0.5 - 1 = -0.5 -> 0.25 ; cum2 = 0.8 - 1 = -0.2 -> 0.04 ; rps = (0.25 + 0.04) / 2
  assert.ok(Math.abs(rps3({ home: 0.5, draw: 0.3, away: 0.2 }, "home") - 0.145) < 1e-12);
  assert.equal(rps3({ home: 1, draw: 0, away: 0 }, "home"), 0);
});

test("devig3 normalises to one", () => {
  const p = devig3(2.0, 3.5, 3.8);
  assert.ok(Math.abs(p.home + p.draw + p.away - 1) < 1e-12);
  assert.ok(p.home > p.away);
});

test("devig2 normalises to one", () => {
  const p = devig2(1.85, 2.05);
  assert.ok(Math.abs(p.first + p.second - 1) < 1e-12);
  assert.ok(p.first > 0.5);
});

test("settleH2h maps score margin to home/draw/away", () => {
  assert.equal(settleH2h(2), "home");
  assert.equal(settleH2h(0), "draw");
  assert.equal(settleH2h(-1), "away");
});

test("settleTotals on the 2.5 line never pushes", () => {
  assert.equal(settleTotals(3, 2.5, "over"), "win");
  assert.equal(settleTotals(2, 2.5, "over"), "loss");
  assert.equal(settleTotals(2, 2.5, "under"), "win");
});

test("settleHandicap five-state incl. quarter lines", () => {
  assert.equal(settleHandicap(1, -0.75, "home"), "half-win");
  assert.equal(settleHandicap(0, -0.25, "home"), "half-loss");
  assert.equal(settleHandicap(0, 0, "home"), "push");
  assert.equal(settleHandicap(-2, 0.5, "home"), "loss");
  assert.equal(settleHandicap(-1, -0.5, "away"), "win");
});

test("settlementProfit mirrors server/domain/backtest.mjs", () => {
  assert.equal(settlementProfit("win", 2.0), 1.0);
  assert.equal(settlementProfit("half-win", 2.0), 0.5);
  assert.equal(settlementProfit("push", 2.0), 0);
  assert.equal(settlementProfit("half-loss", 2.0), -0.5);
  assert.equal(settlementProfit("loss", 2.0), -1);
});

test("calibrationSummary bins predictions and reports the overconfidence gap", () => {
  const pairs = [
    { prob: 0.05, hit: 0 },
    { prob: 0.09, hit: 0 },
    { prob: 0.55, hit: 1 },
    { prob: 0.55, hit: 0 },
  ];
  const bins = calibrationSummary(pairs, 10);
  assert.equal(bins.length, 2);
  const low = bins.find((b) => b.min === 0);
  assert.equal(low.n, 2);
  assert.ok(Math.abs(low.meanProb - 0.07) < 1e-12);
  assert.ok(Math.abs(low.hitRate - 0) < 1e-12);
  const mid = bins.find((b) => b.min === 0.5);
  assert.ok(Math.abs(mid.hitRate - 0.5) < 1e-12);
  assert.ok(Math.abs(mid.gap - 0.05) < 1e-12);
});

test("calibrationSummary skips malformed pairs and empty bins", () => {
  assert.deepEqual(calibrationSummary([], 10), []);
  const bins = calibrationSummary([{ prob: Number.NaN, hit: 1 }, { prob: 0.5, hit: 2 }, { prob: 0.99, hit: 1 }], 10);
  assert.equal(bins.length, 1);
  assert.equal(bins[0].n, 1);
});

test("edgeBucketSummary buckets by edge and flags monotonicity", () => {
  const bets = [
    { edge: 0.04, profit: -1 },
    { edge: 0.06, profit: 0.5 },
    { edge: 0.09, profit: 1.0 },
  ];
  const { buckets, monotone } = edgeBucketSummary(bets);
  assert.equal(buckets.length, 4);
  assert.equal(buckets[0].n, 1);
  assert.equal(buckets[0].roi, -1);
  assert.equal(buckets[1].roi, 0.5);
  assert.equal(buckets[2].roi, 1.0);
  assert.equal(monotone, true);
  const reversed = edgeBucketSummary([
    { edge: 0.04, profit: 1 },
    { edge: 0.06, profit: -1 },
  ]);
  assert.equal(reversed.monotone, false);
});

test("edgeBucketSummary ignores bets below the first edge or malformed", () => {
  const { buckets } = edgeBucketSummary([{ edge: 0.01, profit: 5 }, { edge: Number.NaN, profit: 5 }]);
  assert.equal(buckets.every((b) => b.n === 0), true);
});

test("bootstrapRoiCi brackets the point estimate and is seeded-deterministic", () => {
  const profits = [1, -1, 1, -1, 1, 1, -1, 1, -1, 1];
  const a = bootstrapRoiCi(profits, { reps: 500, seed: 7 });
  const b = bootstrapRoiCi(profits, { reps: 500, seed: 7 });
  assert.deepEqual(a, b);
  assert.ok(Math.abs(a.roi - 0.2) < 1e-12);
  assert.ok(a.lower <= a.roi && a.roi <= a.upper);
});

test("bootstrapRoiCi resamples clusters as whole units", () => {
  const profits = [1, 1, -1, -1];
  const clusters = ["m1", "m1", "m2", "m2"];
  const result = bootstrapRoiCi(profits, { reps: 500, seed: 11, clusters });
  // Each draw is a whole match (+2 or -2), so the CI must be symmetric around 0.
  assert.ok(Math.abs(result.lower + result.upper) < 0.6);
  assert.equal(bootstrapRoiCi([], {}).roi, null);
});
