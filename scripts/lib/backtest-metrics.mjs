// Backtest metrics + actual-result settlement helpers for dc-v1 evaluation.
// Settlement semantics mirror server/domain/backtest.mjs (five-state Asian
// settlement) so offline numbers mean the same thing as production numbers.

import { asianLines } from "./dixon-coles.mjs";

// ---------- probability-scoring metrics ----------

export function brier3(probs, actual) {
  return (probs.home - (actual === "home" ? 1 : 0)) ** 2
    + (probs.draw - (actual === "draw" ? 1 : 0)) ** 2
    + (probs.away - (actual === "away" ? 1 : 0)) ** 2;
}

export function logLoss3(probs, actual) {
  const p = Math.max(1e-12, probs[actual] ?? 0);
  return -Math.log(p);
}

export function rps3(probs, actual) {
  const outcome = { home: 0, draw: 0, away: 0, [actual]: 1 };
  const cumP1 = probs.home;
  const cumO1 = outcome.home;
  const cumP2 = probs.home + probs.draw;
  const cumO2 = outcome.home + outcome.draw;
  return ((cumP1 - cumO1) ** 2 + (cumP2 - cumO2) ** 2) / 2;
}

// ---------- de-vig (proportional, same as production fairProbabilitiesForOdds) ----------

export function devig3(homeOdds, drawOdds, awayOdds) {
  const raw = { home: 1 / homeOdds, draw: 1 / drawOdds, away: 1 / awayOdds };
  const total = raw.home + raw.draw + raw.away;
  return { home: raw.home / total, draw: raw.draw / total, away: raw.away / total };
}

export function devig2(firstOdds, secondOdds) {
  const first = 1 / firstOdds;
  const second = 1 / secondOdds;
  const total = first + second;
  return { first: first / total, second: second / total };
}

// ---------- actual-result settlement ----------

export function settleH2h(margin) {
  return margin > 0 ? "home" : margin < 0 ? "away" : "draw";
}

export function settleTotals(totalGoals, line, selection) {
  const value = selection === "over" ? totalGoals - line : line - totalGoals;
  if (Math.abs(value) < 1e-9) return "push";
  return value > 0 ? "win" : "loss";
}

export function settleHandicap(margin, line, side) {
  const returns = asianLines(line).map((subline) => {
    const adjusted = side === "home" ? margin + subline : -(margin + subline);
    return Math.abs(adjusted) < 1e-9 ? 0 : Math.sign(adjusted);
  });
  const mean = returns.reduce((sum, v) => sum + v, 0) / returns.length;
  if (mean === 1) return "win";
  if (mean === 0.5) return "half-win";
  if (mean === 0) return "push";
  if (mean === -0.5) return "half-loss";
  return "loss";
}

export function settlementProfit(settlement, odds) {
  if (settlement === "win") return odds - 1;
  if (settlement === "half-win") return (odds - 1) / 2;
  if (settlement === "half-loss") return -0.5;
  if (settlement === "loss") return -1;
  return 0;
}
