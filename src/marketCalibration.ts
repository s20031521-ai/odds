export function calibratedProbability(modelProbability: number, selectedOdds: number, otherOdds: number, marketWeight = 0.5): number {
  if (!Number.isFinite(modelProbability) || modelProbability < 0 || modelProbability > 1) {
    return marketProbability(selectedOdds, otherOdds);
  }
  const market = marketProbability(selectedOdds, otherOdds);
  if (!Number.isFinite(market)) {
    return modelProbability;
  }
  const weight = clamp(marketWeight, 0, 1);
  return clamp(modelProbability * (1 - weight) + market * weight, 0, 1);
}

export function marketProbability(selectedOdds: number, otherOdds: number): number {
  if (![selectedOdds, otherOdds].every((odds) => Number.isFinite(odds) && odds > 1)) {
    return Number.NaN;
  }
  const selected = 1 / selectedOdds;
  const other = 1 / otherOdds;
  return selected / (selected + other);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
