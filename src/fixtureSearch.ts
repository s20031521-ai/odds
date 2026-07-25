import { enrichPickWithAliases, expandTeamSearchTerms } from "./teamAliases";

/** Minimal fixture shape for bet form search / link. */
export type FixturePickStatus = "upcoming" | "finished";

export type FixturePick = {
  matchId: string;
  fixtureId?: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamZh?: string;
  awayTeamZh?: string;
  commenceTime: string;
  league?: string;
  /** Score when finished, e.g. "2-1". */
  score?: string;
  status?: FixturePickStatus;
  /** True when model backtest has a settled row for this match. */
  hasModel?: boolean;
};

function formatSide(english: string, zh?: string): string {
  const en = (english || "").trim();
  const z = (zh || "").trim();
  if (z && en && z !== en) return `${z} / ${en}`;
  return z || en || "";
}

/** Prefer bilingual zh / en when alias or zh fields exist. */
export function formatFixturePickLabel(f: FixturePick): string {
  const home = formatSide(f.homeTeam, f.homeTeamZh);
  const away = formatSide(f.awayTeam, f.awayTeamZh);
  if (home && away) return `${home} vs ${away}`;
  if (home || away) return home || away;
  return f.matchId || "—";
}

function haystack(f: FixturePick): string {
  return [
    f.matchId,
    f.homeTeam,
    f.awayTeam,
    f.homeTeamZh,
    f.awayTeamZh,
    f.league,
    f.score,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function commenceMs(value: string | undefined): number {
  const t = Date.parse(value ?? "");
  return Number.isFinite(t) ? t : 0;
}

const DAY_MS = 86_400_000;

export type FilterFixturePicksOptions = {
  now?: Date;
  /** Empty-query finished window (days). Default 3. */
  finishedEmptyDays?: number;
  limit?: number;
};

/**
 * Filter fixtures for bet form picker.
 *
 * Finished (grill):
 * - empty query → last N days AND hasModel only
 * - with query → full finished pool (results catalog), alias-aware search
 *
 * Upcoming: free-text within upcoming pool; empty → first `limit` by time desc.
 */
export function filterFixturePicks(
  fixtures: FixturePick[],
  query: string,
  limitOrOptions: number | FilterFixturePicksOptions = 20,
  status?: FixturePickStatus,
): FixturePick[] {
  const options: FilterFixturePicksOptions =
    typeof limitOrOptions === "number" ? { limit: limitOrOptions } : limitOrOptions;
  const limit = options.limit ?? 20;
  const now = options.now ?? new Date();
  const finishedEmptyDays = options.finishedEmptyDays ?? 3;
  const q = query.trim();
  const pool = status
    ? fixtures.filter((f) => (f.status ?? "upcoming") === status)
    : fixtures;

  const sorted = [...pool].sort((a, b) => commenceMs(b.commenceTime) - commenceMs(a.commenceTime));

  if (status === "finished") {
    if (!q) {
      const cutoff = now.getTime() - finishedEmptyDays * DAY_MS;
      return sorted
        .filter((f) => f.hasModel && commenceMs(f.commenceTime) >= cutoff)
        .slice(0, limit);
    }
    const terms = expandTeamSearchTerms(q);
    return sorted
      .filter((f) => {
        const h = haystack(f);
        return terms.some((t) => h.includes(t));
      })
      .slice(0, limit);
  }

  if (!q) return sorted.slice(0, limit);
  const terms = expandTeamSearchTerms(q);
  return sorted
    .filter((f) => {
      const h = haystack(f);
      return terms.some((t) => h.includes(t));
    })
    .slice(0, limit);
}

/** Dedupe rows into finished picks (prefer richer team names + score). */
export function finishedPicksFromResultRows(
  rows: Array<{
    matchId?: string;
    homeTeam?: string;
    awayTeam?: string;
    homeTeamZh?: string;
    awayTeamZh?: string;
    commenceTime?: string | null;
    score?: string;
    fixtureId?: string;
  }>,
  options?: { hasModel?: boolean },
): FixturePick[] {
  const map = new Map<string, FixturePick>();
  for (const r of rows) {
    const matchId = (r.matchId ?? "").trim();
    if (!matchId) continue;
    const candidate = enrichPickWithAliases({
      matchId,
      fixtureId: r.fixtureId,
      homeTeam: (r.homeTeam ?? "").trim(),
      awayTeam: (r.awayTeam ?? "").trim(),
      homeTeamZh: r.homeTeamZh,
      awayTeamZh: r.awayTeamZh,
      commenceTime: r.commenceTime ?? "",
      score: r.score?.trim() || undefined,
      status: "finished" as const,
      hasModel: options?.hasModel,
    });
    const prev = map.get(matchId);
    if (!prev) {
      map.set(matchId, candidate);
      continue;
    }
    const prevRich = Number(Boolean(prev.homeTeam || prev.awayTeam)) + Number(Boolean(prev.score));
    const nextRich = Number(Boolean(candidate.homeTeam || candidate.awayTeam)) + Number(Boolean(candidate.score));
    let merged: FixturePick = prev;
    if (nextRich > prevRich) merged = { ...prev, ...candidate, status: "finished" };
    else {
      if (!prev.score && candidate.score) merged = { ...merged, score: candidate.score };
      if (!prev.commenceTime && candidate.commenceTime) {
        merged = { ...merged, commenceTime: candidate.commenceTime };
      }
      if (!prev.homeTeamZh && candidate.homeTeamZh) merged = { ...merged, homeTeamZh: candidate.homeTeamZh };
      if (!prev.awayTeamZh && candidate.awayTeamZh) merged = { ...merged, awayTeamZh: candidate.awayTeamZh };
    }
    if (options?.hasModel || prev.hasModel || candidate.hasModel) {
      merged = { ...merged, hasModel: true };
    }
    map.set(matchId, merged);
  }
  return [...map.values()];
}

/**
 * Merge catalog results (all finished) with model match ids.
 * Catalog is primary; hasModel marked when matchId appears in model set.
 */
export function buildFinishedFixturePicks(
  catalogRows: Array<{
    matchId?: string;
    homeTeam?: string;
    awayTeam?: string;
    homeTeamZh?: string;
    awayTeamZh?: string;
    commenceTime?: string | null;
    score?: string;
    fixtureId?: string;
  }>,
  modelMatchIds: Iterable<string>,
): FixturePick[] {
  const modelSet = new Set([...modelMatchIds].map((id) => id.trim()).filter(Boolean));
  const picks = finishedPicksFromResultRows(catalogRows);
  return picks.map((p) => ({
    ...enrichPickWithAliases(p),
    hasModel: modelSet.has(p.matchId),
    status: "finished" as const,
  }));
}

/** Parse unknown API result row (results.raw shape or backtest row). */
export function normalizeCatalogResultRow(item: unknown): {
  matchId: string;
  homeTeam?: string;
  awayTeam?: string;
  homeTeamZh?: string;
  awayTeamZh?: string;
  commenceTime?: string | null;
  score?: string;
  fixtureId?: string;
} | null {
  if (typeof item !== "object" || item === null) return null;
  const row = item as Record<string, unknown>;
  const matchId = typeof row.matchId === "string" ? row.matchId.trim()
    : typeof row.match_id === "string" ? row.match_id.trim()
    : "";
  if (!matchId) return null;
  const str = (key: string) => (typeof row[key] === "string" ? (row[key] as string) : undefined);
  return {
    matchId,
    homeTeam: str("homeTeam") ?? str("home_team"),
    awayTeam: str("awayTeam") ?? str("away_team"),
    homeTeamZh: str("homeTeamZh") ?? str("home_team_zh"),
    awayTeamZh: str("awayTeamZh") ?? str("away_team_zh"),
    commenceTime: str("commenceTime") ?? str("commence_time") ?? null,
    score: str("score"),
    fixtureId: str("fixtureId") ?? str("fixture_id"),
  };
}

export function fixturePickFromPrefill(
  prefill: Partial<{
    matchId?: string;
    fixtureId?: string;
    homeTeam?: string;
    awayTeam?: string;
    homeTeamZh?: string;
    awayTeamZh?: string;
    commenceTime?: string;
  }> | undefined,
): FixturePick | null {
  if (!prefill) return null;
  const matchId = prefill.matchId?.trim();
  const home = prefill.homeTeam?.trim();
  const away = prefill.awayTeam?.trim();
  if (!matchId && !home && !away) return null;
  return enrichPickWithAliases({
    matchId: matchId || "",
    fixtureId: prefill.fixtureId,
    homeTeam: home || "",
    awayTeam: away || "",
    homeTeamZh: prefill.homeTeamZh,
    awayTeamZh: prefill.awayTeamZh,
    commenceTime: prefill.commenceTime || "",
  });
}
