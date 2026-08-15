import type { ManualEntry, OddsSet, OutcomeKey } from "./odds";

// Collectors store live odds as flat rows (one per market+selection).
// Production UI only needs complete h2h triplets for fixture lists / 即將開賽.
// Point-market re-pair was removed after C2 (App no longer builds card pipelines).

export type NormalizedLiveOdds = {
  entries: ManualEntry[];
};

type FlatRow = {
  id?: unknown;
  matchId?: unknown;
  homeTeam?: unknown;
  awayTeam?: unknown;
  homeTeamZh?: unknown;
  awayTeamZh?: unknown;
  commenceTime?: unknown;
  bookmaker?: unknown;
  league?: unknown;
  leagueZh?: unknown;
  market?: unknown;
  selection?: unknown;
  odds?: unknown;
};

const H2H_OUTCOMES: OutcomeKey[] = ["home", "draw", "away"];

export function normalizeLiveOddsPayload(payload: unknown): NormalizedLiveOdds {
  const result: NormalizedLiveOdds = { entries: [] };
  const rows = Array.isArray((payload as { entries?: unknown } | null)?.entries)
    ? ((payload as { entries: unknown[] }).entries as FlatRow[])
    : [];

  const h2hGroups = new Map<string, { meta: FlatRow; odds: Partial<OddsSet>; previous: Partial<OddsSet> }>();

  for (const row of rows) {
    if (!isUsableRow(row)) continue;

    // Legacy nested h2h entry: pass through untouched.
    if (row.market === undefined && isFiniteOddsSet(row.odds)) {
      result.entries.push(buildH2hEntry(row, row.odds as OddsSet));
      continue;
    }

    const selection = row.selection as string;
    const price = row.odds;
    if (typeof price !== "number" || !Number.isFinite(price)) continue;

    if (row.market === "h2h" && (H2H_OUTCOMES as string[]).includes(selection)) {
      const key = baseId(row, selection);
      const group = h2hGroups.get(key) ?? { meta: row, odds: {}, previous: {} };
      group.odds[selection as OutcomeKey] = price;
      const previousPrice = (row as { previousOdds?: unknown }).previousOdds;
      if (typeof previousPrice === "number" && Number.isFinite(previousPrice)) {
        group.previous[selection as OutcomeKey] = previousPrice;
      }
      h2hGroups.set(key, group);
    }
    // totals / corners / spreads deliberately ignored for the client UI path
  }

  for (const [key, group] of h2hGroups) {
    if (H2H_OUTCOMES.every((outcome) => typeof group.odds[outcome] === "number" && Number.isFinite(group.odds[outcome]))) {
      const entry = buildH2hEntry({ ...group.meta, id: key }, group.odds as OddsSet);
      if (Object.keys(group.previous).length > 0) entry.previousOdds = group.previous;
      result.entries.push(entry);
    }
  }

  return result;
}

function isUsableRow(row: FlatRow): row is FlatRow & { matchId: string; homeTeam: string; awayTeam: string; commenceTime: string; bookmaker: string } {
  return Boolean(
    row && typeof row === "object" &&
    typeof row.matchId === "string" && row.matchId &&
    typeof row.homeTeam === "string" &&
    typeof row.awayTeam === "string" &&
    typeof row.commenceTime === "string" &&
    typeof row.bookmaker === "string",
  );
}

function isFiniteOddsSet(odds: unknown): odds is OddsSet {
  if (!odds || typeof odds !== "object") return false;
  return H2H_OUTCOMES.every((outcome) => {
    const value = (odds as OddsSet)[outcome];
    return typeof value === "number" && Number.isFinite(value);
  });
}

function baseId(row: FlatRow, selection: string): string {
  if (typeof row.id === "string" && row.id) {
    const suffix = `:${selection}`;
    if (row.id.endsWith(suffix)) return row.id.slice(0, -suffix.length);
  }
  return `${row.matchId as string}|${row.bookmaker as string}`;
}

function buildH2hEntry(row: FlatRow, odds: OddsSet): ManualEntry {
  return {
    id: typeof row.id === "string" && row.id ? row.id : `${row.matchId as string}|${row.bookmaker as string}`,
    matchId: row.matchId as string,
    homeTeam: row.homeTeam as string,
    awayTeam: row.awayTeam as string,
    commenceTime: row.commenceTime as string,
    bookmaker: row.bookmaker as string,
    odds,
    ...(typeof row.homeTeamZh === "string" ? { homeTeamZh: row.homeTeamZh } : {}),
    ...(typeof row.awayTeamZh === "string" ? { awayTeamZh: row.awayTeamZh } : {}),
    ...(typeof row.league === "string" ? { league: row.league } : {}),
    ...(typeof row.leagueZh === "string" ? { leagueZh: row.leagueZh } : {}),
  };
}
