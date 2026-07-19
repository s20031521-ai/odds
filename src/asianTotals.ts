import type { AnalyzerSettings } from "./odds";

export type AsianSide = "大" | "細";
export type AsianSettlement = "win" | "half-win" | "push" | "half-loss" | "loss";

type SettlementProbabilities = Record<AsianSettlement, number>;

export type AsianTotalMetrics = {
  probability: number;
  fairOdds: number;
  edge: number;
  stake: number;
};

export function settleAsianTotal(side: AsianSide, line: number, total: number): AsianSettlement | null {
  if (!Number.isFinite(line) || !Number.isFinite(total)) return null;
  const returns = splitAsianLine(line).map((part) => side === "大" ? Math.sign(total - part) : Math.sign(part - total));
  const value = returns.reduce((sum, item) => sum + item, 0) / returns.length;
  if (value === 1) return "win";
  if (value === 0.5) return "half-win";
  if (value === 0) return "push";
  if (value === -0.5) return "half-loss";
  return "loss";
}

export function asianTotalMetrics(lambda: number, line: number, side: AsianSide, odds: number, settings: AnalyzerSettings): AsianTotalMetrics {
  if (!Number.isFinite(lambda) || lambda <= 0 || !Number.isFinite(line) || !Number.isFinite(odds) || odds <= 1) {
    return { probability: 0, fairOdds: Number.POSITIVE_INFINITY, edge: Number.NEGATIVE_INFINITY, stake: 0 };
  }
  const outcomes = poissonSettlements(lambda, line, side);
  const winWeight = outcomes.win + outcomes["half-win"] / 2;
  const lossWeight = outcomes.loss + outcomes["half-loss"] / 2;
  const probability = winWeight + lossWeight > 0 ? winWeight / (winWeight + lossWeight) : 0;
  const fairOdds = winWeight > 0 ? 1 + lossWeight / winWeight : Number.POSITIVE_INFINITY;
  const edge = winWeight * (odds - 1) - lossWeight;
  const fullKelly = kellyFraction(outcomes, odds);
  const rawStake = settings.bankroll * fullKelly * settings.fractionalKelly;
  const stake = edge >= settings.edgeThreshold ? Math.min(rawStake, settings.bankroll * settings.stakeCapPercent) : 0;
  return { probability, fairOdds, edge, stake };
}

export function splitAsianLine(line: number): number[] {
  const floor = Math.floor(line);
  const quarter = Math.round((line - floor) * 4) / 4;
  if (quarter === 0.25) return [floor, floor + 0.5];
  if (quarter === 0.75) return [floor + 0.5, floor + 1];
  return [line];
}

function poissonSettlements(lambda: number, line: number, side: AsianSide): SettlementProbabilities {
  const outcomes: SettlementProbabilities = { win: 0, "half-win": 0, push: 0, "half-loss": 0, loss: 0 };
  const maxTotal = Math.max(50, Math.ceil(lambda + 12 * Math.sqrt(lambda) + 10));
  let probability = Math.exp(-lambda);
  let accumulated = 0;
  for (let total = 0; total <= maxTotal; total += 1) {
    if (total > 0) probability *= lambda / total;
    const settlement = settleAsianTotal(side, line, total);
    if (settlement) outcomes[settlement] += probability;
    accumulated += probability;
  }
  const tail = Math.max(0, 1 - accumulated);
  outcomes[side === "大" ? "win" : "loss"] += tail;
  return outcomes;
}

function kellyFraction(outcomes: SettlementProbabilities, odds: number): number {
  const values: Array<[number, number]> = [
    [outcomes.win, odds - 1],
    [outcomes["half-win"], (odds - 1) / 2],
    [outcomes.push, 0],
    [outcomes["half-loss"], -0.5],
    [outcomes.loss, -1],
  ];
  const derivative = (fraction: number) => values.reduce((sum, [probability, value]) => sum + probability * value / (1 + fraction * value), 0);
  if (derivative(0) <= 0) return 0;
  let low = 0;
  let high = 0.999999;
  if (derivative(high) > 0) return high;
  for (let index = 0; index < 60; index += 1) {
    const middle = (low + high) / 2;
    if (derivative(middle) > 0) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}
