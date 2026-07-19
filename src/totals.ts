import { asianTotalMetrics } from "./asianTotals";
import type { AnalyzerSettings } from "./odds";

export type TotalsInputs = {
  homeGoalsFor: number;
  homeGoalsAgainst: number;
  awayGoalsFor: number;
  awayGoalsAgainst: number;
  recentHomeGoalsFor?: number;
  recentHomeGoalsAgainst?: number;
  recentAwayGoalsFor?: number;
  recentAwayGoalsAgainst?: number;
  recentWeight?: number;
  leagueHomeGoals?: number;
  leagueAwayGoals?: number;
  line: number;
  overOdds: number;
  underOdds: number;
};

export type TotalsAnalysis = {
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  expectedTotalGoals: number;
  overProbability: number;
  underProbability: number;
  overFairOdds: number;
  underFairOdds: number;
  overEdge: number;
  underEdge: number;
  overStake: number;
  underStake: number;
};

export function analyzeTotals(inputs: TotalsInputs, settings: AnalyzerSettings): TotalsAnalysis {
  const leagueHomeGoals = positive(inputs.leagueHomeGoals);
  const leagueAwayGoals = positive(inputs.leagueAwayGoals);
  const recentWeight = clamp(safeNumber(inputs.recentWeight), 0, 1);
  const seasonHomeGoals = expectedHome(inputs.homeGoalsFor, inputs.awayGoalsAgainst, leagueHomeGoals);
  const seasonAwayGoals = expectedAway(inputs.awayGoalsFor, inputs.homeGoalsAgainst, leagueAwayGoals);
  const recentHomeGoals = expectedHome(inputs.recentHomeGoalsFor, inputs.recentAwayGoalsAgainst, leagueHomeGoals);
  const recentAwayGoals = expectedAway(inputs.recentAwayGoalsFor, inputs.recentHomeGoalsAgainst, leagueAwayGoals);
  const expectedHomeGoals = blend(seasonHomeGoals, recentHomeGoals, recentWeight);
  const expectedAwayGoals = blend(seasonAwayGoals, recentAwayGoals, recentWeight);
  const expectedTotalGoals = Math.max(0.1, expectedHomeGoals + expectedAwayGoals);
  const over = asianTotalMetrics(expectedTotalGoals, inputs.line, "大", inputs.overOdds, settings);
  const under = asianTotalMetrics(expectedTotalGoals, inputs.line, "細", inputs.underOdds, settings);

  return {
    expectedHomeGoals,
    expectedAwayGoals,
    expectedTotalGoals,
    overProbability: over.probability,
    underProbability: under.probability,
    overFairOdds: over.fairOdds,
    underFairOdds: under.fairOdds,
    overEdge: over.edge,
    underEdge: under.edge,
    overStake: over.stake,
    underStake: under.stake,
  };
}

export function goalUnderLine(lambda: number, line: number): number {
  const maxGoals = Math.floor(line);
  if (!Number.isFinite(lambda) || lambda <= 0 || !Number.isFinite(line)) {
    return 0;
  }

  let probability = Math.exp(-lambda);
  let total = probability;
  for (let goals = 1; goals <= maxGoals; goals += 1) {
    probability *= lambda / goals;
    total += probability;
  }
  return clamp(total, 0, 1);
}

function expectedHome(forGoals: number | undefined, awayAgainst: number | undefined, leagueHomeGoals: number): number {
  return leagueHomeGoals > 0 ? leagueHomeGoals * (safeNumber(forGoals) / leagueHomeGoals) * (safeNumber(awayAgainst) / leagueHomeGoals) : average(forGoals, awayAgainst);
}

function expectedAway(forGoals: number | undefined, homeAgainst: number | undefined, leagueAwayGoals: number): number {
  return leagueAwayGoals > 0 ? leagueAwayGoals * (safeNumber(forGoals) / leagueAwayGoals) * (safeNumber(homeAgainst) / leagueAwayGoals) : average(forGoals, homeAgainst);
}


function average(a: number | undefined, b: number | undefined): number {
  return Math.max(0, (safeNumber(a) + safeNumber(b)) / 2);
}

function blend(base: number, recent: number, recentWeight: number): number {
  return recent > 0 ? base * (1 - recentWeight) + recent * recentWeight : base;
}

function positive(value: number | undefined): number {
  const number = safeNumber(value);
  return number > 0 ? number : 0;
}

function safeNumber(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
