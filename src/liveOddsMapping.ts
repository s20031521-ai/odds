import type { ManualEntry, OddsSet, OutcomeKey } from "./odds";
import type { TotalsMarketEntry } from "./oddsApi";
import type { HandicapEntry } from "./handicap";

// The collectors (hkjc-import / hdc-collector) store live odds as flat rows —
// one row per market+selection with a scalar `odds` value. The UI components
// were built against the nested market shapes, so this normalizer re-pairs the
// flat rows into those shapes at the API boundary. Incomplete groups are
// dropped: a partial odds object used to slip past hasCompleteOdds and crash
// the whole render with "Decimal odds must be greater than 1.".

export type NormalizedLiveOdds = {
  entries: ManualEntry[];
  totalEntries: TotalsMarketEntry[];
  cornerEntries: TotalsMarketEntry[];
  handicapEntries: HandicapEntry[];
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
  line?: unknown;
  odds?: unknown;
};

const H2H_OUTCOMES: OutcomeKey[] = ["home", "draw", "away"];
const CORNER_MARKETS = new Set(["corners", "alternate_totals_corners"]);

export function normalizeLiveOddsPayload(payload: unknown): NormalizedLiveOdds {
  const result: NormalizedLiveOdds = { entries: [], totalEntries: [], cornerEntries: [], handicapEntries: [] };
  const rows = Array.isArray((payload as { entries?: unknown } | null)?.entries)
    ? ((payload as { entries: unknown[] }).entries as FlatRow[])
    : [];

  const h2hGroups = new Map<string, { meta: FlatRow; odds: Partial<OddsSet> }>();
  const pairGroups = new Map<string, { meta: FlatRow; bucket: "totals" | "corners" | "spreads"; line: number; sides: Map<string, number> }>();

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
      const group = h2hGroups.get(key) ?? { meta: row, odds: {} };
      group.odds[selection as OutcomeKey] = price;
      h2hGroups.set(key, group);
      continue;
    }

    const bucket = row.market === "totals" ? "totals" : CORNER_MARKETS.has(row.market as string) ? "corners" : row.market === "spreads" ? "spreads" : null;
    if (!bucket) continue;
    const needed = bucket === "spreads" ? ["home", "away"] : ["over", "under"];
    if (!needed.includes(selection)) continue;
    if (typeof row.line !== "number" || !Number.isFinite(row.line)) continue;

    const key = `${baseId(row, selection)}|${row.line}`;
    const group = pairGroups.get(key) ?? { meta: row, bucket, line: row.line, sides: new Map<string, number>() };
    group.sides.set(selection, price);
    pairGroups.set(key, group);
  }

  for (const [key, group] of h2hGroups) {
    if (H2H_OUTCOMES.every((outcome) => typeof group.odds[outcome] === "number" && Number.isFinite(group.odds[outcome]))) {
      result.entries.push(buildH2hEntry({ ...group.meta, id: key }, group.odds as OddsSet));
    }
  }

  for (const [key, group] of pairGroups) {
    const meta = { ...group.meta, id: key };
    if (group.bucket === "spreads") {
      const homeOdds = group.sides.get("home");
      const awayOdds = group.sides.get("away");
      if (homeOdds === undefined || awayOdds === undefined) continue;
      result.handicapEntries.push({ ...sharedMeta(meta), line: group.line, homeOdds, awayOdds });
    } else {
      const overOdds = group.sides.get("over");
      const underOdds = group.sides.get("under");
      if (overOdds === undefined || underOdds === undefined) continue;
      const entry: TotalsMarketEntry = { ...sharedMeta(meta), line: group.line, overOdds, underOdds };
      if (group.bucket === "totals") result.totalEntries.push(entry);
      else result.cornerEntries.push(entry);
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

// Flat row ids look like `${originalEntryId}:${selection}`; strip the suffix to
// recover the original entry id so mergeById keeps a stable identity. Rows whose
// id does not carry the `:${selection}` suffix fall back to match|bookmaker so
// differently-shaped ids from the same quote set still group together.
function baseId(row: FlatRow, selection: string): string {
  if (typeof row.id === "string" && row.id) {
    const suffix = `:${selection}`;
    if (row.id.endsWith(suffix)) return row.id.slice(0, -suffix.length);
  }
  return `${row.matchId as string}|${row.bookmaker as string}`;
}

function buildH2hEntry(row: FlatRow, odds: OddsSet): ManualEntry {
  return { ...sharedMeta(row), odds };
}

function sharedMeta(row: FlatRow) {
  return {
    id: typeof row.id === "string" && row.id ? row.id : `${row.matchId as string}|${row.bookmaker as string}`,
    matchId: row.matchId as string,
    homeTeam: row.homeTeam as string,
    awayTeam: row.awayTeam as string,
    commenceTime: row.commenceTime as string,
    bookmaker: row.bookmaker as string,
    ...(typeof row.homeTeamZh === "string" ? { homeTeamZh: row.homeTeamZh } : {}),
    ...(typeof row.awayTeamZh === "string" ? { awayTeamZh: row.awayTeamZh } : {}),
    ...(typeof row.league === "string" ? { league: row.league } : {}),
    ...(typeof row.leagueZh === "string" ? { leagueZh: row.leagueZh } : {}),
  };
}
