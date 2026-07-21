import type { AnalysisRow, Fixture } from "./odds";
import type { HandicapCard } from "./handicap";
import type { buildTotalsCards } from "./oddsApi";
import type { BuyMarket } from "./buyOpportunities";
import { displayStake } from "./stakeDisplay";

export type TotalsCard = ReturnType<typeof buildTotalsCards>[number];

export type MarketDetail =
  | { kind: "empty" }
  | { kind: "insufficient"; note: string }
  | {
      kind: "ok";
      selection: string;
      odds: number;
      chance: number;
      implied: number;
      edge: number;
      stake: number;
      bookmaker: string;
    };

export type MatchMarketDetails = {
  h2h: MarketDetail;
  totals: MarketDetail;
  corners: MarketDetail;
  handicap: MarketDetail;
};

export type MatchHeaderInfo = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamZh?: string;
  awayTeamZh?: string;
  commenceTime: string;
  league?: string;
  leagueZh?: string;
};

export function buildMatchMarketDetails(input: {
  matchId: string;
  fixtures: Fixture[];
  rows: AnalysisRow[];
  totalCards: TotalsCard[];
  cornerCards: TotalsCard[];
  handicapCards: HandicapCard[];
}): { header: MatchHeaderInfo | null; details: MatchMarketDetails } {
  const { matchId } = input;
  return {
    header: resolveHeader(input),
    details: {
      h2h: h2hDetail(input.rows.filter((row) => row.matchId === matchId)),
      totals: cardDetail("大細波", bestCard(input.totalCards, matchId)),
      corners: cardDetail("角球", bestCard(input.cornerCards, matchId)),
      handicap: cardDetail("亞洲讓球", bestCard(input.handicapCards, matchId)),
    },
  };
}

function resolveHeader(input: {
  matchId: string;
  fixtures: Fixture[];
  totalCards: TotalsCard[];
  cornerCards: TotalsCard[];
  handicapCards: HandicapCard[];
}): MatchHeaderInfo | null {
  const fixture = input.fixtures.find((item) => item.matchId === input.matchId);
  if (fixture) return fixture;
  const card = [...input.handicapCards, ...input.totalCards, ...input.cornerCards].find((item) => item.matchId === input.matchId);
  return card ?? null;
}

function bestCard<T extends { matchId: string; bestEdge: number }>(cards: T[], matchId: string): T | null {
  const matches = cards.filter((card) => card.matchId === matchId);
  if (matches.length === 0) return null;
  return matches.reduce((best, card) => (card.bestEdge > best.bestEdge ? card : best));
}

function h2hDetail(rows: AnalysisRow[]): MarketDetail {
  if (rows.length === 0) return { kind: "empty" };
  const best = rows.reduce((top, row) => (row.edge > top.edge ? row : top));
  return {
    kind: "ok",
    selection: best.outcomeLabel,
    odds: best.odds,
    chance: best.fairProbability,
    implied: 1 / best.odds,
    edge: best.edge,
    stake: best.suggestedStake,
    bookmaker: best.bookmaker,
  };
}

function cardDetail(market: BuyMarket, card: TotalsCard | HandicapCard | null): MarketDetail {
  if (!card) return { kind: "empty" };
  if (!(card.bestChance > 0) || !Number.isFinite(card.bestEdge) || !(card.bestOdds > 1)) {
    return { kind: "insufficient", note: card.pickLabel || "資料不足，唔買" };
  }
  const selection = `${card.bestSide} ${formatLine(card.line)}`;
  return {
    kind: "ok",
    selection,
    odds: card.bestOdds,
    chance: card.bestChance,
    implied: 1 / card.bestOdds,
    edge: card.bestEdge,
    stake: displayStake({
      market,
      selection,
      line: card.line,
      odds: card.bestOdds,
      chance: card.bestChance,
      edge: card.bestEdge,
      bookmaker: card.bestBookmaker,
    }),
    bookmaker: card.bestBookmaker,
  };
}

function formatLine(line: number): string {
  return Number.isInteger(line) ? line.toFixed(1) : `${line}`;
}
