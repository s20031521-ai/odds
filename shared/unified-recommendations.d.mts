export type UnifiedMarket = "h2h" | "totals" | "corners" | "handicap";
export type UnifiedSelection = "home" | "draw" | "away" | "over" | "under";

export type UnifiedQuoteInput = {
  id?: string;
  fixtureId: string;
  matchId?: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamZh?: string;
  awayTeamZh?: string;
  commenceTime: string;
  league?: string;
  leagueZh?: string;
  provider: string;
  bookmaker: string;
  market: string;
  selection: string;
  line?: number | null;
  odds: number;
  observedAt: string;
};

export type CanonicalQuoteInput = Omit<UnifiedQuoteInput, "market" | "selection" | "line"> & {
  market: UnifiedMarket;
  selection: UnifiedSelection;
  line?: number;
};

export type BuyableQuote = {
  bookmaker: string;
  provider: string;
  odds: number;
  chance: number;
  edge: number;
  minimumBuyOdds: number;
  observedAt: string;
};

export type UnifiedOpportunity = {
  fixtureId: string;
  matchId?: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamZh?: string;
  awayTeamZh?: string;
  commenceTime: string;
  league?: string;
  leagueZh?: string;
  strategyVersion: "unified-buyable-v1";
  modelVersion: "consensus-v1" | "totals-loo-v1" | "corner-loo-v1" | "hdc-loo-v2";
  market: UnifiedMarket;
  selection: UnifiedSelection;
  line?: number;
  quotes: BuyableQuote[];
};

export type UnifiedEvaluation = {
  opportunities: UnifiedOpportunity[];
  inputs: CanonicalQuoteInput[];
};

export const UNIFIED_STRATEGY_VERSION: "unified-buyable-v1";
export const BUY_EDGE_THRESHOLD: 0.03;
export const FRESHNESS_MS: number;

export function minimumBuyOdds(chance: number): number;
export function canonicalBookmaker(name: unknown): string;
export function normalizeUnifiedMarket(market: unknown): UnifiedMarket | null;
export function isValidDecimalOdds(value: unknown): value is number;
export function fairProbabilitiesForOdds(odds: { home: number; draw: number; away: number }): { home: number; draw: number; away: number };
export function h2hConsensusForOdds(oddsSets: ReadonlyArray<{ home: number; draw: number; away: number }>): { home: number; draw: number; away: number } | null;
export function valueEdgeForQuote(odds: number, chance: number): number;
export function noVigFirstChance(firstOdds: number, secondOdds: number): number;
export function dedupeFreshQuotes(rows: readonly unknown[], evaluatedAt: string | number | Date): CanonicalQuoteInput[];
export function evaluateUnifiedOdds(rows: readonly unknown[], evaluatedAt: string | number | Date): UnifiedEvaluation;
export function observationFingerprint(value: unknown): string;
