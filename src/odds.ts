import { groupByFixture } from "./fixtureMatch";
import {
  fairProbabilitiesForOdds,
  h2hConsensusForOdds,
  isValidDecimalOdds,
  valueEdgeForQuote,
} from "../shared/unified-recommendations.mjs";

export type OutcomeKey = "home" | "draw" | "away";

export type OddsSet = Record<OutcomeKey, number>;

export type ManualEntry = {
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
  odds: OddsSet;
};

export type AnalyzerSettings = {
  bankroll: number;
  fractionalKelly: number;
  stakeCapPercent: number;
  edgeThreshold: number;
};

export type Fixture = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamZh?: string;
  awayTeamZh?: string;
  commenceTime: string;
  bookmakerCount: number;
  league?: string;
  leagueZh?: string;
};

export type AnalysisRow = {
  id: string;
  matchId: string;
  match: string;
  bookmaker: string;
  outcome: OutcomeKey;
  outcomeLabel: string;
  odds: number;
  fairProbability: number;
  breakEvenProbability: number;
  edge: number;
  suggestedStake: number;
  margin: number;
  riskLabel: "可能有 value" | "觀察" | "不建議";
};

const outcomeLabels: Record<OutcomeKey, string> = {
  home: "主勝",
  draw: "和局",
  away: "客勝",
};

export function isValidOdds(value: number): boolean {
  return isValidDecimalOdds(value);
}

export function impliedProbability(decimalOdds: number): number {
  if (!isValidOdds(decimalOdds)) {
    throw new Error("Decimal odds must be greater than 1.");
  }
  return 1 / decimalOdds;
}

export function overround(odds: OddsSet): number {
  validateOddsSet(odds);
  return sumOutcomes((outcome) => impliedProbability(odds[outcome])) - 1;
}

export function fairProbabilities(odds: OddsSet): OddsSet {
  validateOddsSet(odds);
  return fairProbabilitiesForOdds(odds);
}

export function marketConsensus(entries: ManualEntry[]): OddsSet | null {
  const validEntries = entries.filter((entry) => hasCompleteOdds(entry.odds));
  if (validEntries.length === 0) {
    return null;
  }

  return h2hConsensusForOdds(validEntries.map((entry) => entry.odds));
}

export function valueEdge(decimalOdds: number, fairProbability: number): number {
  return valueEdgeForQuote(decimalOdds, fairProbability);
}

export function kellyStake(
  decimalOdds: number,
  fairProbability: number,
  settings: AnalyzerSettings,
): number {
  if (!isValidOdds(decimalOdds) || fairProbability <= 0 || settings.bankroll <= 0) {
    return 0;
  }

  const netOdds = decimalOdds - 1;
  const lossProbability = 1 - fairProbability;
  const fullKelly = (netOdds * fairProbability - lossProbability) / netOdds;
  const rawStake = settings.bankroll * Math.max(0, fullKelly) * settings.fractionalKelly;
  const cappedStake = settings.bankroll * settings.stakeCapPercent;
  return Math.min(rawStake, cappedStake);
}

export function analyzeEntries(entries: ManualEntry[], settings: AnalyzerSettings): AnalysisRow[] {
  const grouped = groupByMatch(entries);
  const rows: AnalysisRow[] = [];

  for (const [matchId, matchEntries] of grouped) {
    const consensus = marketConsensus(matchEntries);
    if (!consensus) {
      continue;
    }

    for (const entry of matchEntries) {
      if (!hasCompleteOdds(entry.odds)) {
        continue;
      }

      const margin = overround(entry.odds);
      (Object.keys(entry.odds) as OutcomeKey[]).forEach((outcome) => {
        const odds = entry.odds[outcome];
        const fairProbability = consensus[outcome];
        const edge = valueEdge(odds, fairProbability);
        const stake = edge >= settings.edgeThreshold ? kellyStake(odds, fairProbability, settings) : 0;

        rows.push({
          id: `${entry.id}-${outcome}`,
          matchId,
          match: `${entry.homeTeam} vs ${entry.awayTeam}`,
          bookmaker: entry.bookmaker,
          outcome,
          outcomeLabel: outcomeLabels[outcome],
          odds,
          fairProbability,
          breakEvenProbability: impliedProbability(odds),
          edge,
          suggestedStake: stake,
          margin,
          riskLabel: edge >= settings.edgeThreshold && stake > 0 ? "可能有 value" : edge > 0 ? "觀察" : "不建議",
        });
      });
    }
  }

  return rows.sort((a, b) => b.edge - a.edge);
}

export function filterLegacySampleEntries(entries: ManualEntry[]): ManualEntry[] {
  return entries.filter((entry) => entry.matchId !== "sample-match");
}

export function upcomingFixtures(entries: ManualEntry[], now = Date.now()): Fixture[] {
  return [...groupByMatch(entries)].map(([matchId, matchEntries]) => {
    const owner = matchEntries.find((entry) => entry.matchId === matchId) ?? matchEntries[0];
    const league = matchEntries.find((entry) => entry.league)?.league;
    const leagueZh = matchEntries.find((entry) => entry.leagueZh)?.leagueZh;
    const homeTeamZh = matchEntries.find((entry) => entry.homeTeamZh)?.homeTeamZh;
    const awayTeamZh = matchEntries.find((entry) => entry.awayTeamZh)?.awayTeamZh;
    return { matchId, homeTeam: owner.homeTeam, awayTeam: owner.awayTeam, commenceTime: owner.commenceTime, bookmakerCount: new Set(matchEntries.map((entry) => entry.bookmaker)).size, ...(league ? { league } : {}), ...(leagueZh ? { leagueZh } : {}), ...(homeTeamZh ? { homeTeamZh } : {}), ...(awayTeamZh ? { awayTeamZh } : {}) };
  }).filter((fixture) => {
    const kickoff = Date.parse(fixture.commenceTime);
    return Number.isFinite(kickoff) && kickoff > now;
  }).sort((a, b) => sortableTime(a.commenceTime) - sortableTime(b.commenceTime));
}

export function sortFixturesByBestEdge(fixtures: Fixture[], rows: AnalysisRow[]): Fixture[] {
  return [...fixtures].sort((a, b) => bestFixtureEdge(b, rows) - bestFixtureEdge(a, rows) || sortableTime(a.commenceTime) - sortableTime(b.commenceTime));
}

export function hasCompleteOdds(odds: OddsSet): boolean {
  // Must check the three required outcomes explicitly: iterating Object.keys
  // accepts partial objects (and even scalars, which have no keys), and a
  // missing outcome then crashes overround()/impliedProbability at render time.
  return (["home", "draw", "away"] as const).every((outcome) => isValidOdds(odds?.[outcome]));
}

function sortableTime(value: string): number {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

function bestFixtureEdge(fixture: Fixture, rows: AnalysisRow[]): number {
  return rows.find((row) => row.matchId === fixture.matchId)?.edge ?? Number.NEGATIVE_INFINITY;
}

function validateOddsSet(odds: OddsSet): void {
  if (!hasCompleteOdds(odds)) {
    throw new Error("1X2 odds must include home, draw and away odds greater than 1.");
  }
}

function groupByMatch(entries: ManualEntry[]): Map<string, ManualEntry[]> {
  return groupByFixture(entries);
}

function mapOutcomes(callback: (outcome: OutcomeKey) => number): OddsSet {
  return {
    home: callback("home"),
    draw: callback("draw"),
    away: callback("away"),
  };
}

function sumOutcomes(callback: (outcome: OutcomeKey) => number): number {
  return callback("home") + callback("draw") + callback("away");
}
