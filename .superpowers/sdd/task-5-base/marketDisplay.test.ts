import { describe, expect, it } from "vitest";
import { calibrationBuckets, cornerPickLabel, currentModelRows, excludeLegacyRows, filterHistoryRows, groupMarketCards, hasPredictionSnapshot, predictionDistribution, selectDistinctPerformanceRows, summarizeHistoryRows, summarizePerformanceRows } from "./marketDisplay";

describe("market card presentation", () => {
  it("never presents a buy when fewer than two bookmakers support the line", () => {
    expect(cornerPickLabel("買大", 1)).toBe("資料不足，唔買");
    expect(cornerPickLabel("買細", 1)).toBe("資料不足，唔買");
  });

  it("uses corner-specific buy labels only for supported lines", () => {
    expect(cornerPickLabel("買大", 2)).toBe("買大角");
    expect(cornerPickLabel("買細", 3)).toBe("買細角");
    expect(cornerPickLabel("唔買", 2)).toBe("唔買");
  });

  it("groups lines by fixture and promotes a buy as the primary line", () => {
    const groups = groupMarketCards([
      { id: "g1-8", matchId: "g1", commenceTime: "2026-07-12T12:00:00Z", line: 8.5, pickLabel: "唔買", bestEdge: 0.01 },
      { id: "g1-9", matchId: "g1", commenceTime: "2026-07-12T12:00:00Z", line: 9.5, pickLabel: "買大", bestEdge: 0.04 },
      { id: "g2-8", matchId: "g2", commenceTime: "2026-07-12T13:00:00Z", line: 8.5, pickLabel: "資料不足，唔買", bestEdge: 0 },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].primary.id).toBe("g1-9");
    expect(groups[0].lines).toHaveLength(2);
  });

  it("recognizes only rows backed by a prediction snapshot", () => {
    expect(hasPredictionSnapshot({ prediction: "大", modelVersion: "corner-loo-v1" })).toBe(true);
    expect(hasPredictionSnapshot({ prediction: "未有賽前快照" })).toBe(false);
    expect(hasPredictionSnapshot({ prediction: "主" })).toBe(false);
  });

  it("hides legacy rows without dropping raw result rows", () => {
    const rows = [{ modelVersion: "corner-loo-v1" }, { modelVersion: "legacy-v0" }, {}];
    expect(excludeLegacyRows(rows)).toEqual([rows[0], rows[2]]);
  });

  it("filters history rows to one market", () => {
    const rows = [
      { market: "主客和", prediction: "主勝" },
      { market: "角球", prediction: "大角" },
      { market: "大細波", prediction: "大" },
    ];
    expect(filterHistoryRows(rows, "角球")).toEqual([rows[1]]);
  });

  it("summarizes wins and losses while excluding pushes and pending rows", () => {
    expect(summarizeHistoryRows([
      { hit: true, settlement: "win", prediction: "大", modelVersion: "v1" },
      { hit: true, settlement: "half-win", prediction: "大", modelVersion: "v1" },
      { hit: false, settlement: "loss", prediction: "細", modelVersion: "v1" },
      { hit: null, settlement: "push", prediction: "大", modelVersion: "v1" },
      { hit: null, settlement: null, prediction: "未有賽前快照" },
    ])).toEqual({ win: 2, loss: 1, push: 1, winPercent: 66.7, lossPercent: 33.3 });
    expect(summarizeHistoryRows([])).toEqual({ win: 0, loss: 0, push: 0, winPercent: 0, lossPercent: 0 });
  });

  it("summarizes priced model performance and labels missing versions as legacy", () => {
    const rows = [
      { matchId: "m1", market: "大細波", prediction: "大", settlement: "win", odds: 2, modelVersion: "totals-v1" },
      { matchId: "m1", market: "大細波", prediction: "細", settlement: "half-loss", odds: 1.9, modelVersion: "totals-v1" },
      { matchId: "m2", market: "大細波", prediction: "大", settlement: "loss", modelVersion: "legacy-v0" },
      { market: "大細波", prediction: "未有賽前快照", settlement: undefined },
    ];
    expect(summarizePerformanceRows(rows, (row) => row.modelVersion || "legacy-v0")).toEqual([
      { key: "totals-v1", matches: 1, finished: 1, win: 1, loss: 0, push: 0, hitRate: 1, priced: 1, profit: 1, roi: 1 },
      { key: "legacy-v0", matches: 1, finished: 1, win: 0, loss: 1, push: 0, hitRate: 0, priced: 0, profit: 0, roi: null },
    ]);
    expect(currentModelRows(rows)).toEqual(rows.slice(0, 2));
  });

  it("builds prediction direction and calibration summaries", () => {
    const rows = [
      { prediction: "大", settlement: "win", chance: 0.62 },
      { prediction: "大", settlement: "loss", chance: 0.58 },
      { prediction: "細", settlement: "win", chance: 0.47 },
      { prediction: "未有賽前快照", settlement: undefined },
    ];
    expect(predictionDistribution(rows)).toEqual([
      { key: "大", count: 2, percent: 2 / 3 },
      { key: "細", count: 1, percent: 1 / 3 },
    ]);
    expect(calibrationBuckets(rows)).toEqual([
      { key: "40–49%", finished: 1, hitRate: 1 },
      { key: "50–59%", finished: 1, hitRate: 0 },
      { key: "60–69%", finished: 1, hitRate: 1 },
    ]);
    expect(summarizePerformanceRows([], () => "x")).toEqual([]);
  });

  it("uses one highest-edge representative per settled match", () => {
    const rows = [
      { matchId: "m1", market: "totals", modelVersion: "v1", prediction: "over", settlement: "loss", odds: 2, edge: 0.04, savedAt: "2026-07-09T01:00:00Z", line: 2.5, chance: 0.44 },
      { matchId: "m1", market: "totals", modelVersion: "v1", prediction: "under", settlement: "win", odds: 2.2, edge: 0.08, savedAt: "2026-07-09T02:00:00Z", line: 3, chance: 0.81 },
      { matchId: "m2", market: "totals", modelVersion: "v1", prediction: "over", settlement: "half-loss", odds: 1.9, edge: 0.05, savedAt: "2026-07-09T01:00:00Z", line: 2.5, chance: 0.55 },
    ];

    expect(selectDistinctPerformanceRows(rows)).toEqual([rows[1], rows[2]]);
    expect(summarizePerformanceRows(rows, (row) => row.modelVersion)).toEqual([
      { key: "v1", matches: 2, finished: 2, win: 1, loss: 1, push: 0, hitRate: 0.5, priced: 2, profit: 0.7, roi: (1.2 - 0.5) / 2 },
    ]);
    expect(predictionDistribution(rows)).toEqual([
      { key: "under", count: 1, percent: 0.5 },
      { key: "over", count: 1, percent: 0.5 },
    ]);
  });

  it("counts priced pushes in ROI but excludes representatives without odds", () => {
    const rows = [
      { matchId: "push", market: "totals", modelVersion: "v1", prediction: "over", settlement: "push", odds: 2, edge: 0.1 },
      { matchId: "unpriced", market: "totals", modelVersion: "v1", prediction: "under", settlement: "win", edge: 0.1 },
    ];

    expect(summarizePerformanceRows(rows, () => "all")).toEqual([
      { key: "all", matches: 2, finished: 2, win: 1, loss: 0, push: 1, hitRate: 1, priced: 1, profit: 0, roi: 0 },
    ]);
  });

  it("uses deterministic tie-breaks and preserves rows without a match id", () => {
    const rows = [
      { id: "later", matchId: "m1", market: "totals", modelVersion: "v1", prediction: "over", edge: 0.1, savedAt: "2026-07-09T02:00:00Z", line: 2.5 },
      { id: "higher-line", matchId: "m1", market: "totals", modelVersion: "v1", prediction: "under", edge: 0.1, savedAt: "2026-07-09T01:00:00Z", line: 3 },
      { id: "winner", matchId: "m1", market: "totals", modelVersion: "v1", prediction: "over", edge: 0.1, savedAt: "2026-07-09T01:00:00Z", line: 2.5 },
      { id: "stable-later", matchId: "m1", market: "totals", modelVersion: "v1", prediction: "under", edge: 0.1, savedAt: "2026-07-09T01:00:00Z", line: 2.5 },
      { id: "missing", matchId: "", market: "totals", modelVersion: "v1", prediction: "over", edge: 9 },
    ];

    expect(selectDistinctPerformanceRows(rows).map((row) => row.id)).toEqual(["winner", "missing"]);
  });

  it("selects representatives globally before assigning calibration buckets", () => {
    const rows = [
      { matchId: "m1", market: "totals", modelVersion: "v1", prediction: "over", settlement: "loss", chance: 0.44, edge: 0.04 },
      { matchId: "m1", market: "totals", modelVersion: "v1", prediction: "under", settlement: "win", chance: 0.81, edge: 0.08 },
      { matchId: "m2", market: "totals", modelVersion: "v1", prediction: "over", settlement: "half-loss", chance: 0.55, edge: 0.05 },
    ];

    expect(calibrationBuckets(rows)).toEqual([
      { key: "50–59%", finished: 1, hitRate: 0 },
      { key: "80–89%", finished: 1, hitRate: 1 },
    ]);
  });
});
