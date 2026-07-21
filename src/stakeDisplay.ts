import type { BuyPick } from "./buyOpportunities";

export type StakeSettings = {
  bankroll: number;
  fractionalKelly: number;
  stakeCapPercent: number;
};

// Display-only mirror of the analyzer defaults in src/App.tsx — never edit
// these values without owner approval (model freeze red line).
export const DEFAULT_STAKE_SETTINGS: StakeSettings = {
  bankroll: 1000,
  fractionalKelly: 0.25,
  stakeCapPercent: 0.02,
};

export function displayStake(pick: BuyPick, settings: StakeSettings = DEFAULT_STAKE_SETTINGS): number {
  if (!(pick.odds > 1) || !(pick.chance > 0) || !(pick.chance <= 1)) return 0;
  const fullKelly = (pick.chance * pick.odds - 1) / (pick.odds - 1);
  const fraction = Math.min(Math.max(fullKelly, 0) * settings.fractionalKelly, settings.stakeCapPercent);
  return Math.round(settings.bankroll * fraction);
}
