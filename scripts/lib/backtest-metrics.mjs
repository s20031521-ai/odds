// Backtest metrics + actual-result settlement helpers for dc-v1 evaluation.
// Settlement semantics mirror server/domain/backtest.mjs (five-state Asian
// settlement) so offline numbers mean the same thing as production numbers.

import { asianLines, createRng } from "./dixon-coles.mjs";

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

// ---------- Phase 1 additive: calibration / edge buckets / bootstrap ----------

// Calibration bins for a set of probabilistic predictions.
// pairs: [{ prob, hit }] with hit 0/1. Returns one entry per non-empty equal-
// width bin over [0, 1]: { min, max, n, meanProb, hitRate, gap } where
// gap = meanProb - hitRate (positive = overconfident).
export function calibrationSummary(pairs, binCount = 10) {
  const bins = [];
  for (let b = 0; b < binCount; b += 1) {
    bins.push({ min: b / binCount, max: (b + 1) / binCount, n: 0, probSum: 0, hitSum: 0 });
  }
  for (const pair of Array.isArray(pairs) ? pairs : []) {
    if (!Number.isFinite(pair.prob) || (pair.hit !== 0 && pair.hit !== 1)) continue;
    const index = Math.min(binCount - 1, Math.max(0, Math.floor(pair.prob * binCount)));
    bins[index].n += 1;
    bins[index].probSum += pair.prob;
    bins[index].hitSum += pair.hit;
  }
  return bins
    .filter((bin) => bin.n > 0)
    .map((bin) => ({
      min: bin.min,
      max: bin.max,
      n: bin.n,
      meanProb: bin.probSum / bin.n,
      hitRate: bin.hitSum / bin.n,
      gap: bin.probSum / bin.n - bin.hitSum / bin.n,
    }));
}

// ROI by edge bucket. bets: [{ edge, profit }] (flat 1-unit stakes).
// Buckets are [edges[i], edges[i+1]) with the last bucket open-ended.
// `monotone` is true when every non-empty bucket's ROI is >= the previous
// non-empty bucket's ROI minus `tolerance` (edge should pay more as it grows).
export function edgeBucketSummary(bets, { edges = [0.03, 0.05, 0.08, 0.12], tolerance = 0 } = {}) {
  const buckets = edges.map((edge, index) => ({
    min: edge,
    max: index + 1 < edges.length ? edges[index + 1] : Infinity,
    n: 0,
    profit: 0,
  }));
  for (const bet of Array.isArray(bets) ? bets : []) {
    if (!Number.isFinite(bet.edge) || !Number.isFinite(bet.profit)) continue;
    const bucket = buckets.find((b) => bet.edge >= b.min && bet.edge < b.max);
    if (!bucket) continue;
    bucket.n += 1;
    bucket.profit += bet.profit;
  }
  const summary = buckets.map((bucket) => ({
    min: bucket.min,
    max: bucket.max,
    n: bucket.n,
    profit: bucket.profit,
    roi: bucket.n > 0 ? bucket.profit / bucket.n : null,
  }));
  const nonEmpty = summary.filter((bucket) => bucket.n > 0);
  const monotone = nonEmpty.every((bucket, index) => index === 0
    || bucket.roi >= nonEmpty[index - 1].roi - tolerance);
  return { buckets: summary, monotone };
}

// Bootstrap confidence interval for flat-stake ROI (profit / bets).
// profits: number[] of per-bet profits. When `clusters` is given (one cluster
// label per bet, e.g. a match id), whole clusters are resampled instead of
// individual bets so within-match correlation is preserved.
export function bootstrapRoiCi(profits, { reps = 5000, seed = 20260824, clusters = null, level = 0.95 } = {}) {
  const values = (Array.isArray(profits) ? profits : []).filter((v) => Number.isFinite(v));
  if (values.length === 0) return { roi: null, lower: null, upper: null, reps: 0 };
  const rng = createRng(seed);
  const units = clusters && Array.isArray(clusters) && clusters.length === values.length
    ? [...values.entries()].reduce((map, [index, profit]) => {
      const key = String(clusters[index]);
      map.set(key, [...(map.get(key) ?? []), profit]);
      return map;
    }, new Map())
    : new Map(values.entries().map(([index, profit]) => [index, [profit]]));
  const unitValues = [...units.values()];
  const samples = [];
  for (let rep = 0; rep < reps; rep += 1) {
    let profit = 0;
    let n = 0;
    for (let draw = 0; draw < unitValues.length; draw += 1) {
      const unit = unitValues[Math.floor(rng() * unitValues.length)];
      for (const p of unit) profit += p;
      n += unit.length;
    }
    samples.push(profit / n);
  }
  samples.sort((a, b) => a - b);
  const alpha = (1 - level) / 2;
  const quantile = (q) => samples[Math.min(samples.length - 1, Math.max(0, Math.floor(q * samples.length)))];
  const roi = values.reduce((sum, v) => sum + v, 0) / values.length;
  return { roi, lower: quantile(alpha), upper: quantile(1 - alpha), reps };
}
