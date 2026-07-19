import { describe, expect, it } from "vitest";
import { analyzeTotals, goalUnderLine } from "./totals";
import type { AnalyzerSettings } from "./odds";

const settings: AnalyzerSettings = {
  bankroll: 1000,
  fractionalKelly: 0.25,
  stakeCapPercent: 0.02,
  edgeThreshold: 0.03,
};

describe("football totals calculations", () => {
  it("calculates Poisson under probability for half-goal lines", () => {
    expect(goalUnderLine(2.7, 2.5)).toBeCloseTo(0.4936, 4);
  });

  it("analyzes goal totals and stakes only positive value sides", () => {
    const analysis = analyzeTotals(
      {
        homeGoalsFor: 2.0,
        homeGoalsAgainst: 1.1,
        awayGoalsFor: 1.4,
        awayGoalsAgainst: 1.8,
        line: 2.5,
        overOdds: 2.05,
        underOdds: 1.75,
      },
      settings,
    );

    expect(analysis.expectedHomeGoals).toBeCloseTo(1.9);
    expect(analysis.expectedAwayGoals).toBeCloseTo(1.25);
    expect(analysis.expectedTotalGoals).toBeCloseTo(3.15);
    expect(analysis.overProbability + analysis.underProbability).toBeCloseTo(1);
    expect(analysis.overFairOdds).toBeLessThan(2.05);
    expect(analysis.overStake).toBeGreaterThan(0);
    expect(analysis.underStake).toBe(0);
  });

  it("uses home-away split, league calibration, and recent weighting", () => {
    const analysis = analyzeTotals(
      {
        homeGoalsFor: 2.0,
        homeGoalsAgainst: 1.0,
        awayGoalsFor: 1.2,
        awayGoalsAgainst: 1.8,
        recentHomeGoalsFor: 2.4,
        recentHomeGoalsAgainst: 0.8,
        recentAwayGoalsFor: 1.0,
        recentAwayGoalsAgainst: 2.0,
        recentWeight: 0.25,
        leagueHomeGoals: 1.5,
        leagueAwayGoals: 1.2,
        line: 2.5,
        overOdds: 2.05,
        underOdds: 1.75,
      },
      settings,
    );

    expect(analysis.expectedHomeGoals).toBeCloseTo(2.6);
    expect(analysis.expectedAwayGoals).toBeCloseTo(0.92);
    expect(analysis.expectedTotalGoals).toBeCloseTo(3.52);
  });
});
