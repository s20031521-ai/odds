import { hasCompleteOdds, type ManualEntry, type OddsSet } from "./odds";
import { buildHandicapCards, type HandicapEntry } from "./handicap";
import { isValidDecimalOdds } from "../shared/unified-recommendations.mjs";

export type TotalsMarketEntry = {
  id: string;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamZh?: string;
  awayTeamZh?: string;
  commenceTime: string;
  bookmaker: string;
  league?: string;
  leagueZh?: string;
  line: number;
  overOdds: number;
  underOdds: number;
};

export function parseOddsApiEvents(payload: unknown): ManualEntry[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.flatMap((event) => {
    if (!isOddsApiEvent(event)) {
      return [];
    }

    return event.bookmakers.flatMap((bookmaker) => {
      if (!isOddsApiBookmaker(bookmaker)) {
        return [];
      }

      const h2h = bookmaker.markets.find((market) => isMarket(market, "h2h"));
      if (!h2h) {
        return [];
      }

      const odds = outcomesToOdds(h2h.outcomes.filter(isOddsApiOutcome), event.home_team, event.away_team);
      if (!hasCompleteOdds(odds)) {
        return [];
      }

      return {
        id: `${event.id}-${bookmaker.key}`,
        matchId: event.id,
        homeTeam: event.home_team,
        awayTeam: event.away_team,
        commenceTime: event.commence_time,
        bookmaker: bookmaker.title,
        odds,
      };
    });
  });
}

export function parseOddsApiHandicaps(payload: unknown): HandicapEntry[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((event) => {
    if (!isOddsApiEvent(event)) return [];
    return event.bookmakers.flatMap((bookmaker) => {
      if (!isOddsApiBookmaker(bookmaker)) return [];
      const spreads = bookmaker.markets.find((market) => isMarket(market, "spreads"));
      if (!spreads) return [];
      const outcomes = spreads.outcomes.filter(isOddsApiPointOutcome);
      const home = outcomes.find((outcome) => outcome.name === event.home_team);
      const away = outcomes.find((outcome) => outcome.name === event.away_team);
      if (!home || !away || !isMarketPrice(home.price) || !isMarketPrice(away.price) || !Number.isFinite(home.point) || away.point !== -home.point) return [];
      return [{
        id: `${event.id}-${bookmaker.key}-hdc-${home.point}`,
        matchId: event.id,
        homeTeam: event.home_team,
        awayTeam: event.away_team,
        homeTeamEn: event.home_team,
        awayTeamEn: event.away_team,
        commenceTime: event.commence_time,
        bookmaker: bookmaker.title,
        line: home.point,
        homeOdds: home.price,
        awayOdds: away.price,
      }];
    });
  });
}

export function parseOddsApiTotals(payload: unknown): TotalsMarketEntry[] {
  return parsePointTotals(payload, "totals", "totals");
}

export function parseOddsApiCorners(payload: unknown): TotalsMarketEntry[] {
  return parsePointTotals(payload, "alternate_totals_corners", "corners");
}

function parsePointTotals(payload: unknown, marketKey: string, suffix: string): TotalsMarketEntry[] {
  const events = Array.isArray(payload) ? payload : [payload];
  return events.flatMap((event) => {
    if (!isOddsApiEvent(event)) return [];
    return event.bookmakers.flatMap((bookmaker) => {
      if (!isOddsApiBookmaker(bookmaker)) return [];
      const totals = bookmaker.markets.find((market) => isMarket(market, marketKey));
      if (!totals) return [];
      const byLine = new Map<number, { overOdds?: number; underOdds?: number }>();
      for (const outcome of totals.outcomes.filter(isOddsApiPointOutcome)) {
        const current = byLine.get(outcome.point) ?? {};
        if (outcome.name === "Over") current.overOdds = outcome.price;
        if (outcome.name === "Under") current.underOdds = outcome.price;
        byLine.set(outcome.point, current);
      }
      return [...byLine.entries()].flatMap(([line, odds]) => {
        if (!isMarketPrice(odds.overOdds) || !isMarketPrice(odds.underOdds)) return [];
        return [{
          id: `${event.id}-${bookmaker.key}-${suffix}-${line}`,
          matchId: event.id,
          homeTeam: event.home_team,
          awayTeam: event.away_team,
          commenceTime: event.commence_time,
          bookmaker: bookmaker.title,
          line,
          overOdds: odds.overOdds,
          underOdds: odds.underOdds,
        }];
      });
    });
  });
}

export function buildTotalsCards(entries: TotalsMarketEntry[], edgeThreshold: number) {
  return buildHandicapCards(entries.map((entry) => ({
    id: entry.id,
    matchId: entry.matchId,
    homeTeam: entry.homeTeam,
    awayTeam: entry.awayTeam,
    ...(entry.homeTeamZh ? { homeTeamZh: entry.homeTeamZh } : {}),
    ...(entry.awayTeamZh ? { awayTeamZh: entry.awayTeamZh } : {}),
    commenceTime: entry.commenceTime,
    bookmaker: entry.bookmaker,
    ...(entry.league ? { league: entry.league } : {}),
    ...(entry.leagueZh ? { leagueZh: entry.leagueZh } : {}),
    line: entry.line,
    homeOdds: entry.overOdds,
    awayOdds: entry.underOdds,
  })), edgeThreshold).map((card) => ({
    ...card,
    id: `${card.matchId}-totals-${card.line}`,
    bestSide: card.bestSide === "主" ? "大" as const : card.bestSide === "客" ? "細" as const : null,
    pickLabel: card.pickLabel === "買 主" ? "買大" : card.pickLabel === "買 客" ? "買細" : card.pickLabel,
  }));
}

function outcomesToOdds(outcomes: Array<{ name: string; price: number }>, homeTeam: string, awayTeam: string): OddsSet {
  const home = outcomes.find((outcome) => outcome.name === homeTeam)?.price ?? 0;
  const away = outcomes.find((outcome) => outcome.name === awayTeam)?.price ?? 0;
  const draw = outcomes.find((outcome) => outcome.name.toLowerCase() === "draw")?.price ?? 0;
  return { home, draw, away };
}

function isOddsApiBookmaker(value: unknown): value is {
  key: string;
  title: string;
  markets: unknown[];
} {
  return typeof value === "object" && value !== null && "key" in value && "title" in value && "markets" in value && Array.isArray((value as { markets: unknown }).markets);
}

function isMarket(value: unknown, key: string): value is { key: string; outcomes: unknown[] } {
  return typeof value === "object" && value !== null && "key" in value && (value as { key: unknown }).key === key && "outcomes" in value && Array.isArray((value as { outcomes: unknown }).outcomes);
}

function isOddsApiOutcome(value: unknown): value is { name: string; price: number } {
  return typeof value === "object" && value !== null && typeof (value as { name?: unknown }).name === "string" && typeof (value as { price?: unknown }).price === "number";
}

function isOddsApiPointOutcome(value: unknown): value is { name: string; price: number; point: number } {
  return isOddsApiOutcome(value) && typeof (value as { point?: unknown }).point === "number";
}

function isMarketPrice(value: unknown): value is number {
  return isValidDecimalOdds(value);
}

function isOddsApiEvent(value: unknown): value is {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers: unknown[];
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "home_team" in value &&
    "away_team" in value &&
    "commence_time" in value &&
    "bookmakers" in value &&
    Array.isArray((value as { bookmakers: unknown }).bookmakers)
  );
}
