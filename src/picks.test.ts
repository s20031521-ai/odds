import { describe, expect, it } from "vitest";
import { bestH2hPick } from "./picks";
import type { AnalysisRow } from "./odds";

const row = (edge: number): AnalysisRow => ({
  id: "m1-home-book",
  matchId: "m1",
  match: "Home vs Away",
  bookmaker: "Book",
  outcome: "home",
  outcomeLabel: "主勝",
  odds: 2,
  fairProbability: 0.51,
  breakEvenProbability: 0.5,
  edge,
  suggestedStake: 0,
  margin: 0.05,
  riskLabel: "觀察",
});

describe("H2H pick threshold", () => {
  it("does not buy below the configured edge threshold", () => {
    expect(bestH2hPick([row(0.02)], 0.03).label).toBe("唔買");
    expect(bestH2hPick([row(0.03)], 0.03).label).toBe("買 主勝");
  });
});
