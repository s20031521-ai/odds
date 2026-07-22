import { describe, expect, it } from "vitest";
import { canonicalMarketKey, clearBacktestResponseState, cornerPickLabel, excludeLegacyRows, filterHistoryRows, findMarketReadiness, groupMarketCards, hasPredictionSnapshot, isSnapshotQuality, marketDisplayLabel, snapshotQualityMessage, summarizeHistoryRows } from "./marketDisplay";

describe("backtest response state", () => {
  it("clears response-owned data when a load fails after a success", () => {
    expect(clearBacktestResponseState({
      resultEntries: [{ id: "settled-row" }],
      readiness: [{ modelVersion: "totals-v1" }],
      snapshotQuality: { raw: 3, validCurrent: 3, legacy: 0, invalid: 0, invalidReasons: {} },
    })).toEqual({ resultEntries: [], readiness: [], snapshotQuality: null });
  });
});

describe("snapshot quality presentation", () => {
  it("warns when legacy or invalid snapshots are isolated", () => {
    expect(snapshotQualityMessage({ raw: 183, validCurrent: 3, legacy: 90, invalid: 90, invalidReasons: { "missing-commence-time": 87 } }))
      .toBe("已隔離 90 個 legacy 同 90 個無效 snapshots；current 統計只使用 3 個有效 snapshots。");
    expect(snapshotQualityMessage({ raw: 3, validCurrent: 3, legacy: 0, invalid: 0, invalidReasons: {} })).toBeNull();
  });

  it("accepts only well-shaped nonnegative integer quality counts", () => {
    const valid = { raw: 3, validCurrent: 2, legacy: 1, invalid: 0, invalidReasons: { "invalid-odds": 0 } };

    expect(isSnapshotQuality(valid)).toBe(true);
    expect([
      undefined,
      [],
      { ...valid, raw: -1 },
      { ...valid, legacy: 0.5 },
      { raw: 3, validCurrent: 2, legacy: 1, invalid: 0 },
      { ...valid, invalidReasons: [] },
      { ...valid, invalidReasons: { "invalid-odds": -1 } },
      { ...valid, invalidReasons: { "invalid-odds": 1.5 } },
      { ...valid, invalidReasons: { "invalid-odds": "1" } },
    ].map(isSnapshotQuality)).toEqual(Array(9).fill(false));
  });
});

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

  it("honors valid-current status when supplied while accepting old-server rows", () => {
    const rows = [
      { prediction: "大", modelVersion: "totals-v1", snapshotStatus: "valid-current" },
      { prediction: "細", modelVersion: "totals-v1", snapshotStatus: "invalid" },
      { prediction: "大", modelVersion: "totals-v1" },
    ];

    expect(rows.map(hasPredictionSnapshot)).toEqual([true, false, true]);
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

  it.each([
    ["h2h", "主客和"],
    ["totals", "大細波"],
    ["corners", "角球"],
    ["handicap", "亞洲讓球"],
  ] as const)("normalizes canonical %s and legacy display label %s to the same market", (canonical, display) => {
    const canonicalRow = { market: canonical, sampleId: 11 };
    const legacyRow = { market: display, sampleId: 12 };

    expect(canonicalMarketKey(canonical)).toBe(canonical);
    expect(canonicalMarketKey(display)).toBe(canonical);
    expect(marketDisplayLabel(canonical)).toBe(display);
    expect(filterHistoryRows([canonicalRow, legacyRow], display)).toEqual([canonicalRow, legacyRow]);
  });

  it.each([
    ["h2h", "主客和", "consensus-v1"],
    ["totals", "大細波", "totals-loo-v1"],
    ["corners", "角球", "corner-loo-v1"],
    ["handicap", "亞洲讓球", "hdc-loo-v2"],
  ] as const)("finds canonical %s readiness from display market %s", (canonical, display, modelVersion) => {
    const canonicalReadiness = { market: canonical, modelVersion, settledMatches: 4 };
    const wrongModel = { market: canonical, modelVersion: "other", settledMatches: 99 };

    expect(findMarketReadiness([wrongModel, canonicalReadiness], display, modelVersion)).toBe(canonicalReadiness);
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
});
