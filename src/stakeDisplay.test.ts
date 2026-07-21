import { describe, expect, it } from "vitest";
import type { BuyPick } from "./buyOpportunities";
import { DEFAULT_STAKE_SETTINGS, displayStake } from "./stakeDisplay";

const pick = (chance: number, odds: number): BuyPick => ({
  market: "大細波", selection: "大", line: 2.5, odds, chance, edge: chance * odds - 1, bookmaker: "Alpha",
});

describe("displayStake", () => {
  it("caps at 2% of bankroll when fractional Kelly exceeds the cap", () => {
    // fullKelly = (0.58*1.95-1)/(1.95-1) ≈ 0.138 → ×0.25 ≈ 0.0345 > 0.02 cap → 1000×0.02 = 20
    expect(displayStake(pick(0.58, 1.95))).toBe(20);
  });

  it("returns fractional Kelly stake when below the cap", () => {
    // fullKelly = (0.36*3.0-1)/(3.0-1) = 0.04 → ×0.25 = 0.01 < 0.02 cap → 1000×0.01 = 10
    expect(displayStake(pick(0.36, 3.0))).toBe(10);
  });

  it("returns 0 for negative edge", () => {
    expect(displayStake(pick(0.3, 2.0))).toBe(0);
  });

  it("returns 0 for invalid inputs", () => {
    expect(displayStake(pick(0, 1.95))).toBe(0);
    expect(displayStake(pick(0.5, 1))).toBe(0);
  });

  it("respects custom settings", () => {
    expect(displayStake(pick(0.36, 3.0), { bankroll: 5000, fractionalKelly: 0.25, stakeCapPercent: 0.02 })).toBe(50);
  });

  it("exposes frozen defaults matching analyzer settings", () => {
    expect(DEFAULT_STAKE_SETTINGS).toEqual({ bankroll: 1000, fractionalKelly: 0.25, stakeCapPercent: 0.02 });
  });
});
