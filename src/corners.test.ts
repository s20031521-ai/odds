import { describe, expect, it } from "vitest";
import { analyzeCorners, poissonUnderLine } from "./corners";
import type { AnalyzerSettings } from "./odds";

const settings: AnalyzerSettings = {
  bankroll: 1000,
  fractionalKelly: 0.25,
  stakeCapPercent: 0.02,
  edgeThreshold: 0.03,
};

describe("corner calculations", () => {
  it("calculates Poisson under probability for half-goal corner lines", () => {
    expect(poissonUnderLine(10, 9.5)).toBeCloseTo(0.4579, 4);
  });

  it("analyzes corner totals and stakes only positive value sides", () => {
    const analysis = analyzeCorners(
      {
        homeCornersFor: 6.2,
        homeCornersAgainst: 4.3,
        awayCornersFor: 4.1,
        awayCornersAgainst: 5.8,
        line: 9.5,
        overOdds: 1.95,
        underOdds: 1.85,
      },
      settings,
    );

    expect(analysis.expectedTotalCorners).toBeCloseTo(10.2);
    expect(analysis.overProbability + analysis.underProbability).toBeCloseTo(1);
    expect(analysis.overFairOdds).toBeLessThan(1.95);
    expect(analysis.overStake).toBeGreaterThan(0);
    expect(analysis.underStake).toBe(0);
  });

  it("blends season and recent corner form by weight", () => {
    const analysis = analyzeCorners(
      {
        homeCornersFor: 6,
        homeCornersAgainst: 4,
        awayCornersFor: 4,
        awayCornersAgainst: 6,
        recentHomeCornersFor: 8,
        recentHomeCornersAgainst: 4.5,
        recentAwayCornersFor: 5,
        recentAwayCornersAgainst: 7,
        recentWeight: 0.4,
        line: 9.5,
        overOdds: 1.95,
        underOdds: 1.85,
      },
      settings,
    );

    expect(analysis.expectedHomeCorners).toBeCloseTo(6.6);
    expect(analysis.expectedAwayCorners).toBeCloseTo(4.3);
    expect(analysis.expectedTotalCorners).toBeCloseTo(10.9);
  });
});
