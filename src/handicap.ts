import { splitAsianLine, type AsianSettlement } from "./asianTotals";
import { sameFixture } from "./fixtureMatch";
import { noVigFirstChance, valueEdgeForQuote } from "../shared/unified-recommendations.mjs";

export type HandicapSide = "主" | "客";

export type HandicapEntry = {
  id: string;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamEn?: string;
  awayTeamEn?: string;
  homeTeamZh?: string;
  awayTeamZh?: string;
  commenceTime: string;
  bookmaker: string;
  league?: string;
  leagueZh?: string;
  line: number;
  homeOdds: number;
  awayOdds: number;
};

export type HandicapCard = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamZh?: string;
  awayTeamZh?: string;
  commenceTime: string;
  league?: string;
  leagueZh?: string;
  line: number;
  homeOdds: number;
  awayOdds: number;
  bookmakerCount: number;
  bestChance: number;
  bestEdge: number;
  bestOdds: number;
  pickLabel: string;
  bestBookmaker: string;
  bestSide: HandicapSide;
  hasHkjc: boolean;
};

export function parseHandicapLine(value: string | number): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parts = value.split("/").map(Number);
  if (parts.length < 1 || parts.length > 2 || parts.some((part) => !Number.isFinite(part))) return null;
  return parts.reduce((sum, part) => sum + part, 0) / parts.length;
}

export function settleAsianHandicap(side: HandicapSide, line: number, homeGoals: number, awayGoals: number): AsianSettlement | null {
  if (!Number.isFinite(line) || !Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return null;
  const margin = homeGoals - awayGoals;
  const values = splitAsianLine(line).map((part) => Math.sign(side === "主" ? margin + part : -(margin + part)));
  const value = values.reduce((sum, item) => sum + item, 0) / values.length;
  if (value === 1) return "win";
  if (value === 0.5) return "half-win";
  if (value === 0) return "push";
  if (value === -0.5) return "half-loss";
  return "loss";
}

export function buildHandicapCards(entries: HandicapEntry[], edgeThreshold: number): HandicapCard[] {
  const external = entries.filter((entry) => entry.bookmaker !== "HKJC");
  const groups = new Map<string, HandicapEntry[]>();
  for (const entry of external) {
    const key = `${entry.matchId}|${entry.line}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  for (const entry of entries.filter((item) => item.bookmaker === "HKJC")) {
    const hasExternalMatch = [...groups.values()].some((group) => group[0].line === entry.line && sameFixture(group[0], entry));
    if (!hasExternalMatch) groups.set(`hkjc|${entry.matchId}|${entry.line}`, [entry]);
  }

  return [...groups.values()].map((externalGroup) => {
    const owner = externalGroup[0];
    const matchingHkjc = entries.filter((entry) => entry.bookmaker === "HKJC" && entry.line === owner.line && sameFixture(owner, entry));
    const byBookmaker = new Map<string, HandicapEntry>();
    for (const entry of [...externalGroup, ...matchingHkjc]) if (!byBookmaker.has(entry.bookmaker)) byBookmaker.set(entry.bookmaker, entry);
    const market = [...byBookmaker.values()];
    const canonicalOwner = matchingHkjc[0] ?? owner;
    const hasHkjc = market.some((entry) => entry.bookmaker === "HKJC");
    if (market.length < 2) return baseCard(canonicalOwner, market.length, 0, Number.NEGATIVE_INFINITY, 0, "資料不足，唔買", owner.bookmaker, "主", hasHkjc);

    const candidates = market.flatMap((candidate) => {
      const peers = market.filter((entry) => entry.bookmaker !== candidate.bookmaker);
      const homeChance = average(peers.map((entry) => noVig(entry.homeOdds, entry.awayOdds)));
      return [
        { entry: candidate, side: "主" as const, chance: homeChance, odds: candidate.homeOdds, edge: valueEdgeForQuote(candidate.homeOdds, homeChance) },
        { entry: candidate, side: "客" as const, chance: 1 - homeChance, odds: candidate.awayOdds, edge: valueEdgeForQuote(candidate.awayOdds, 1 - homeChance) },
      ];
    });
    const best = candidates.reduce((current, candidate) => candidate.edge > current.edge ? candidate : current);
    const pickLabel = best.edge >= edgeThreshold ? `買 ${best.side}` : "唔買";
    return baseCard(canonicalOwner, market.length, best.chance, best.edge, best.odds, pickLabel, best.entry.bookmaker, best.side, hasHkjc, best.entry);
  }).sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime));
}

function baseCard(owner: HandicapEntry, bookmakerCount: number, bestChance: number, bestEdge: number, bestOdds: number, pickLabel: string, bestBookmaker: string, bestSide: HandicapSide, hasHkjc: boolean, priceEntry: HandicapEntry = owner): HandicapCard {
  return { matchId: owner.matchId, homeTeam: owner.homeTeam, awayTeam: owner.awayTeam, ...(owner.homeTeamZh ? { homeTeamZh: owner.homeTeamZh } : {}), ...(owner.awayTeamZh ? { awayTeamZh: owner.awayTeamZh } : {}), commenceTime: owner.commenceTime, ...(owner.league ? { league: owner.league } : {}), ...(owner.leagueZh ? { leagueZh: owner.leagueZh } : {}), line: owner.line, homeOdds: priceEntry.homeOdds, awayOdds: priceEntry.awayOdds, bookmakerCount, bestChance, bestEdge, bestOdds, pickLabel, bestBookmaker, bestSide, hasHkjc };
}

function noVig(homeOdds: number, awayOdds: number): number {
  return noVigFirstChance(homeOdds, awayOdds);
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
