import assert from "node:assert/strict";
import test from "node:test";

import {
  READINESS_SAMPLE_TARGET,
  clusterBootstrapRoi,
  performanceForRows,
  readinessVerdict,
  rowUnitProfit,
} from "./model-performance.mjs";

// Synthetic reproduction of the production corner-loo-v1 shape (report §7.1
// red light): 33 independent fixtures, 164 recommendation units, 25 wins at
// odds 3.82 → ROI ≈ -41.8%, clearly negative, calibration overestimating.
function cornerLikeRows() {
  const rows = [];
  for (let index = 0; index < 164; index += 1) {
    const win = index < 25;
    rows.push({
      id: `row-${index}`,
      fixtureId: `fixture-${index % 33}`,
      market: "corners",
      modelVersion: "corner-loo-v1",
      strategyVersion: "unified-buyable-v1",
      settlement: win ? "win" : "loss",
      hit: win,
      odds: 3.82,
      chance: 0.35,
      edge: index % 5 === 0 ? 0.25 : 0.04,
    });
  }
  return rows;
}

test("corner-shaped fixture: 164 recommendations collapse to 33 independent matches", () => {
  const performance = performanceForRows(cornerLikeRows());
  assert.equal(performance.recommendations, 164);
  assert.equal(performance.independentMatches, 33);
  assert.ok(Math.abs(performance.roi - -0.4177) < 0.01, `roi ${performance.roi}`);
  assert.ok(performance.hitRate !== null && performance.hitRate < 0.16);
  // Cluster bootstrap interval is entirely below zero → clearly negative EV.
  assert.ok(performance.roiBootstrap.upper < 0, `ci upper ${performance.roiBootstrap.upper}`);
  assert.ok(performance.roiBootstrap.lower < performance.roiBootstrap.upper);
  // Calibration: predicted 35% vs actual ~15.2% → persistent overestimate.
  assert.ok(performance.calibration.bias > 0.1, `bias ${performance.calibration.bias}`);
  // Edge has no ranking power: the 20%+ bucket (all losses) underperforms 3–5%.
  const highEdge = performance.edgeBuckets.find((bucket) => bucket.bucket === "20%+");
  const lowEdge = performance.edgeBuckets.find((bucket) => bucket.bucket === "3–5%");
  assert.ok(highEdge.roi < lowEdge.roi);
  assert.equal(performance.edgeMonotonic, false);
});

test("cluster bootstrap is deterministic", () => {
  const rows = cornerLikeRows();
  assert.deepEqual(clusterBootstrapRoi(rows), clusterBootstrapRoi(rows));
});

test("readinessVerdict: suspended trust wins over everything", () => {
  const performance = performanceForRows(cornerLikeRows());
  assert.equal(readinessVerdict({ trustStatus: "suspended", settledMatches: 33, performance }), "suspended");
  // The same numbers without the suspension are still NOT performance-trusted.
  assert.equal(readinessVerdict({ trustStatus: "active", settledMatches: 33, performance }), "sample-ready");
});

test("readinessVerdict: below the sample target stays collecting", () => {
  assert.equal(READINESS_SAMPLE_TARGET, 30);
  assert.equal(readinessVerdict({ trustStatus: "active", settledMatches: 10, performance: null }), "collecting");
  assert.equal(readinessVerdict({ trustStatus: "active", settledMatches: 0, performance: null }), "collecting");
});

test("readinessVerdict: a genuinely good profile becomes performance-trusted", () => {
  const rows = [];
  const buckets = [0.04, 0.07, 0.15, 0.25];
  for (let match = 0; match < 30; match += 1) {
    buckets.forEach((edge, bucketIndex) => {
      // Higher edge buckets win more often → monotonic ROI.
      const win = (match + bucketIndex) % 4 <= bucketIndex;
      rows.push({
        id: `good-${match}-${bucketIndex}`,
        fixtureId: `good-fixture-${match}`,
        market: "totals",
        modelVersion: "future-model-v1",
        strategyVersion: "unified-buyable-v1",
        settlement: win ? "win" : "loss",
        hit: win,
        odds: 2.1,
        chance: 0.52,
        edge,
      });
    });
  }
  const performance = performanceForRows(rows);
  assert.ok(performance.roi > 0, `roi ${performance.roi}`);
  assert.ok(performance.roiBootstrap.upper > 0);
  assert.equal(performance.edgeMonotonic, true);
  assert.equal(
    readinessVerdict({ trustStatus: "active", settledMatches: 30, performance }),
    "performance-trusted",
  );
});

test("rowUnitProfit falls back to plain odds when no profit range exists", () => {
  assert.equal(rowUnitProfit({ settlement: "win", odds: 2.5 }), 1.5);
  assert.equal(rowUnitProfit({ settlement: "half-loss", odds: 2.5 }), -0.5);
  assert.equal(rowUnitProfit({ settlement: "push", odds: 2.5 }), 0);
  assert.equal(rowUnitProfit({ settlement: "win", unitProfitRange: { lower: -0.2, upper: 0.8 }, odds: 9 }), -0.2);
  assert.equal(rowUnitProfit({ settlement: "win" }), null);
});

test("ROI is null (N/A), never 0%, when nothing is priced", () => {
  const performance = performanceForRows([{ id: "x", fixtureId: "f", settlement: "win", chance: 0.6, edge: 0.1 }]);
  assert.equal(performance.roi, null);
  assert.equal(performance.roiBootstrap, null);
});
