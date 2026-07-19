import { asianTotalMetrics } from "./asianTotals";
import type { AnalyzerSettings } from "./odds";

export type CornerInputs = {
  homeCornersFor: number;
  homeCornersAgainst: number;
  awayCornersFor: number;
  awayCornersAgainst: number;
  recentHomeCornersFor?: number;
  recentHomeCornersAgainst?: number;
  recentAwayCornersFor?: number;
  recentAwayCornersAgainst?: number;
  recentWeight?: number;
  line: number;
  overOdds: number;
  underOdds: number;
};

export type CornerAnalysis = {
  expectedHomeCorners: number;
  expectedAwayCorners: number;
  expectedTotalCorners: number;
  overProbability: number;
  underProbability: number;
  overFairOdds: number;
  underFairOdds: number;
  overEdge: number;
  underEdge: number;
  overStake: number;
  underStake: number;
};

export function analyzeCorners(inputs: CornerInputs, settings: AnalyzerSettings): CornerAnalysis {
  const seasonHomeCorners = average(inputs.homeCornersFor, inputs.awayCornersAgainst);
  const seasonAwayCorners = average(inputs.awayCornersFor, inputs.homeCornersAgainst);
  const recentHomeCorners = average(inputs.recentHomeCornersFor, inputs.recentAwayCornersAgainst);
  const recentAwayCorners = average(inputs.recentAwayCornersFor, inputs.recentHomeCornersAgainst);
  const recentWeight = clamp(safeNumber(inputs.recentWeight), 0, 1);
  const expectedHomeCorners = blend(seasonHomeCorners, recentHomeCorners, recentWeight);
  const expectedAwayCorners = blend(seasonAwayCorners, recentAwayCorners, recentWeight);
  const expectedTotalCorners = Math.max(0.1, expectedHomeCorners + expectedAwayCorners);
  const over = asianTotalMetrics(expectedTotalCorners, inputs.line, "大", inputs.overOdds, settings);
  const under = asianTotalMetrics(expectedTotalCorners, inputs.line, "細", inputs.underOdds, settings);

  return {
    expectedHomeCorners,
    expectedAwayCorners,
    expectedTotalCorners,
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

export function poissonUnderLine(lambda: number, line: number): number {
  const maxCorners = Math.floor(line);
  if (!Number.isFinite(lambda) || lambda <= 0 || !Number.isFinite(line)) {
    return 0;
  }

  let probability = Math.exp(-lambda);
  let total = probability;
  for (let corners = 1; corners <= maxCorners; corners += 1) {
    probability *= lambda / corners;
    total += probability;
  }
  return clamp(total, 0, 1);
}


function average(a: number | undefined, b: number | undefined): number {
  return Math.max(0, (safeNumber(a) + safeNumber(b)) / 2);
}

function blend(base: number, recent: number, recentWeight: number): number {
  return base * (1 - recentWeight) + recent * recentWeight;
}

function safeNumber(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
