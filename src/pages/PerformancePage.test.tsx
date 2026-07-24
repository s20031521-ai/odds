import { describe, expect, it } from "vitest";
import { formatSettlementLabel, formatPrediction } from "./PerformancePage";

describe("formatSettlementLabel", () => {
  it('maps "win" to 中', () => {
    expect(formatSettlementLabel("win")).toEqual({ label: "中" });
  });

  it('maps "half-win" to 半中', () => {
    expect(formatSettlementLabel("half-win")).toEqual({ label: "半中" });
  });

  it('maps "push" to 走', () => {
    expect(formatSettlementLabel("push")).toEqual({ label: "走" });
  });

  it('maps "half-loss" to 半錯', () => {
    expect(formatSettlementLabel("half-loss")).toEqual({ label: "半錯" });
  });

  it('maps "loss" to 錯', () => {
    expect(formatSettlementLabel("loss")).toEqual({ label: "錯" });
  });

  it("returns — for undefined", () => {
    expect(formatSettlementLabel(undefined)).toEqual({ label: "—" });
  });

  it("returns — for null", () => {
    expect(formatSettlementLabel(null)).toEqual({ label: "—" });
  });

  it("returns — for unknown values", () => {
    expect(formatSettlementLabel("unknown")).toEqual({ label: "—" });
  });
});

describe("formatPrediction", () => {
  it("returns prediction with line when line is provided", () => {
    expect(formatPrediction("over", 2.5)).toBe("over 2.5");
  });

  it("returns prediction without line when line is omitted", () => {
    expect(formatPrediction("home")).toBe("home");
  });

  it("handles line of 0", () => {
    expect(formatPrediction("under", 0)).toBe("under 0");
  });

  it("returns prediction only when line is undefined", () => {
    expect(formatPrediction("away", undefined)).toBe("away");
  });
});

describe("result filtering and sorting logic", () => {
  const sampleResults = [
    {
      id: "1",
      matchId: "match-1",
      homeTeam: "Team A",
      awayTeam: "Team B",
      commenceTime: "2026-07-20T20:00:00.000Z",
      score: "2-1",
      market: "totals",
      prediction: "over",
      line: 2.5,
      settlement: "win" as const,
      modelVersion: "totals-loo-v1",
    },
    {
      id: "2",
      matchId: "match-2",
      homeTeam: "Team C",
      awayTeam: "Team D",
      commenceTime: "2026-07-21T20:00:00.000Z",
      score: "0-0",
      market: "totals",
      prediction: "under",
      line: 2.5,
      settlement: "loss" as const,
      modelVersion: "totals-loo-v1",
    },
    {
      id: "3",
      matchId: "match-3",
      homeTeam: "Team E",
      awayTeam: "Team F",
      commenceTime: "2026-07-19T18:00:00.000Z",
      score: "1-1",
      market: "totals",
      prediction: "under",
      line: 2.5,
      settlement: "push" as const,
      modelVersion: "totals-loo-v1",
    },
    {
      id: "4",
      matchId: "match-4",
      homeTeam: "Team G",
      awayTeam: "Team H",
      commenceTime: "2026-07-21T22:00:00.000Z",
      score: "3-2",
      market: "corners",
      prediction: "over",
      line: 9.5,
      settlement: "win" as const,
      modelVersion: "corner-loo-v1",
    },
    {
      id: "5",
      matchId: "match-5",
      homeTeam: "Team I",
      awayTeam: "Team J",
      commenceTime: "2026-07-18T20:00:00.000Z",
      score: "2-0",
      market: "totals",
      prediction: "over",
      line: 2.5,
      settlement: "half-win" as const,
      modelVersion: "totals-loo-v1",
    },
    {
      id: "6",
      matchId: "match-6",
      homeTeam: "Team K",
      awayTeam: "Team L",
      commenceTime: "",
      score: "",
      market: "totals",
      prediction: "over",
      settlement: undefined,
      modelVersion: "totals-loo-v1",
    },
  ];

  const filterByMarket = (
    rows: typeof sampleResults,
    market: string,
    modelVersion: string
  ) =>
    rows.filter(
      (r) => r.market === market && r.modelVersion === modelVersion
    );

  const sortByCommenceTimeDesc = (rows: typeof sampleResults) =>
    [...rows].sort((a, b) => {
      const ta = Date.parse(a.commenceTime);
      const tb = Date.parse(b.commenceTime);
      if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
      if (Number.isNaN(ta)) return 1;
      if (Number.isNaN(tb)) return -1;
      return tb - ta;
    });

  it("filters results by market and modelVersion", () => {
    const filtered = filterByMarket(sampleResults, "totals", "totals-loo-v1");
    expect(filtered).toHaveLength(5);
    expect(filtered.every((r) => r.market === "totals")).toBe(true);
  });

  it("excludes results from other markets", () => {
    const filtered = filterByMarket(sampleResults, "totals", "totals-loo-v1");
    expect(filtered.some((r) => r.market === "corners")).toBe(false);
  });

  it("returns empty array when no results match", () => {
    const filtered = filterByMarket(sampleResults, "h2h", "consensus-v1");
    expect(filtered).toHaveLength(0);
  });

  it("sorts by commenceTime descending (newest first)", () => {
    const filtered = filterByMarket(sampleResults, "totals", "totals-loo-v1");
    const sorted = sortByCommenceTimeDesc(filtered);

    expect(sorted[0].id).toBe("2");
    expect(sorted[1].id).toBe("1");
    expect(sorted[2].id).toBe("3");
    expect(sorted[3].id).toBe("5");
  });

  it("pushes rows with empty commenceTime to the end", () => {
    const filtered = filterByMarket(sampleResults, "totals", "totals-loo-v1");
    const sorted = sortByCommenceTimeDesc(filtered);

    const lastRow = sorted[sorted.length - 1];
    expect(lastRow.id).toBe("6");
  });
});
