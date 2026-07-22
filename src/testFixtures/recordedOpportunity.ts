import type { BuyableOpportunity } from "../apiClient";

export const recordedOpportunity: BuyableOpportunity = {
  sampleId: 17,
  fixtureId: "fixture-17",
  matchId: "match-17",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  homeTeamZh: "阿仙奴",
  awayTeamZh: "車路士",
  league: "Premier League",
  commenceTime: "2030-07-21T20:00:00.000Z",
  market: "totals",
  selection: "over",
  line: 2.5,
  modelVersion: "totals-loo-v1",
  strategyVersion: "unified-buyable-v1",
  quoteRange: { min: 1.91, max: 2.04, count: 2 },
  bestQuote: {
    bookmaker: "Beta", provider: "the-odds-api", odds: 2.04, chance: 0.55,
    edge: 0.122, minimumBuyOdds: 1.88, observedAt: "2026-07-21T11:57:00.000Z",
  },
  quotes: [
    {
      bookmaker: "Alpha", provider: "hkjc", odds: 1.91, chance: 0.56,
      edge: 0.0696, minimumBuyOdds: 1.84, observedAt: "2026-07-21T11:55:00.000Z",
    },
    {
      bookmaker: "Beta", provider: "the-odds-api", odds: 2.04, chance: 0.55,
      edge: 0.122, minimumBuyOdds: 1.88, observedAt: "2026-07-21T11:57:00.000Z",
    },
  ],
  lastEvaluatedAt: "2026-07-21T12:00:00.000Z",
};
