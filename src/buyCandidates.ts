import type { BuyCandidate } from "./buyOpportunities";

type FixtureInput = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamZh?: string;
  awayTeamZh?: string;
  commenceTime: string;
  league?: string;
  leagueZh?: string;
};

type H2hRowInput = {
  matchId: string;
  outcomeLabel: string;
  bookmaker: string;
  odds: number;
  fairProbability: number;
  edge: number;
};

type MarketCardInput = FixtureInput & {
  line: number;
  bestSide: string | null;
  bestOdds: number;
  bestChance: number;
  bestEdge: number;
  bestBookmaker: string;
};

type HandicapCardInput = Omit<MarketCardInput, "bestSide"> & { bestSide: string };

export function buildBuyCandidates(input: {
  fixtures: FixtureInput[];
  h2hRows: H2hRowInput[];
  totalCards: MarketCardInput[];
  cornerCards: MarketCardInput[];
  handicapCards: HandicapCardInput[];
}): BuyCandidate[] {
  const fixtures = new Map(input.fixtures.map((fixture) => [fixture.matchId, fixture]));
  const h2h = input.h2hRows.flatMap((row): BuyCandidate[] => {
    const fixture = fixtures.get(row.matchId);
    if (!fixture) return [];
    return [{
      ...fixture,
      market: "主客和",
      selection: row.outcomeLabel,
      bookmaker: row.bookmaker,
      odds: row.odds,
      chance: row.fairProbability,
      edge: row.edge,
    }];
  });

  return [
    ...h2h,
    ...input.totalCards.map((card) => fromMarketCard(card, "大細波", card.bestSide ?? "")),
    ...input.cornerCards.map((card) => fromMarketCard(
      card,
      "角球",
      card.bestSide === "大" ? "大角" : card.bestSide === "細" ? "細角" : "",
    )),
    ...input.handicapCards.map((card) => fromMarketCard(card, "亞洲讓球", card.bestSide)),
  ];
}

function fromMarketCard(
  card: MarketCardInput,
  market: BuyCandidate["market"],
  selection: string,
): BuyCandidate {
  return {
    matchId: card.matchId,
    homeTeam: card.homeTeam,
    awayTeam: card.awayTeam,
    ...(card.homeTeamZh ? { homeTeamZh: card.homeTeamZh } : {}),
    ...(card.awayTeamZh ? { awayTeamZh: card.awayTeamZh } : {}),
    commenceTime: card.commenceTime,
    ...(card.league ? { league: card.league } : {}),
    ...(card.leagueZh ? { leagueZh: card.leagueZh } : {}),
    market,
    selection,
    line: card.line,
    odds: card.bestOdds,
    chance: card.bestChance,
    edge: card.bestEdge,
    bookmaker: card.bestBookmaker,
  };
}
