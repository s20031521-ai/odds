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
  /** Settled backtest score when status is finished, e.g. "2-1". */
  score?: string;
  status?: FixturePickStatus;
};

export function formatFixturePickLabel(f: FixturePick): string {
  const home = (f.homeTeamZh || f.homeTeam || "").trim();
  const away = (f.awayTeamZh || f.awayTeam || "").trim();
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

function commenceMs(value: string | undefined): number {
  const t = Date.parse(value ?? "");
  return Number.isFinite(t) ? t : 0;
}

/** Filter fixtures by free-text query. Empty query → first `limit` by commenceTime desc. */
export function filterFixturePicks(
  fixtures: FixturePick[],
  query: string,
  limit = 20,
  status?: FixturePickStatus,
): FixturePick[] {
  const q = query.trim().toLowerCase();
  const pool = status
    ? fixtures.filter((f) => (f.status ?? "upcoming") === status)
    : fixtures;
  const sorted = [...pool].sort((a, b) => commenceMs(b.commenceTime) - commenceMs(a.commenceTime));
  if (!q) return sorted.slice(0, limit);
  return sorted.filter((f) => haystack(f).includes(q)).slice(0, limit);
}

/** Dedupe settled backtest rows into finished picks (prefer rows with team names + score). */
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
): FixturePick[] {
  const map = new Map<string, FixturePick>();
  for (const r of rows) {
    const matchId = (r.matchId ?? "").trim();
    if (!matchId) continue;
    const candidate: FixturePick = {
      matchId,
      fixtureId: r.fixtureId,
      homeTeam: (r.homeTeam ?? "").trim(),
      awayTeam: (r.awayTeam ?? "").trim(),
      homeTeamZh: r.homeTeamZh,
      awayTeamZh: r.awayTeamZh,
      commenceTime: r.commenceTime ?? "",
      score: r.score?.trim() || undefined,
      status: "finished",
    };
    const prev = map.get(matchId);
    if (!prev) {
      map.set(matchId, candidate);
      continue;
    }
    // Prefer richer labels / score when deduping multi-market settled rows.
    const prevRich = Number(Boolean(prev.homeTeam || prev.awayTeam)) + Number(Boolean(prev.score));
    const nextRich = Number(Boolean(candidate.homeTeam || candidate.awayTeam)) + Number(Boolean(candidate.score));
    if (nextRich > prevRich) map.set(matchId, { ...prev, ...candidate, status: "finished" });
    else if (!prev.score && candidate.score) map.set(matchId, { ...prev, score: candidate.score });
    else if (!prev.commenceTime && candidate.commenceTime) {
      map.set(matchId, { ...prev, commenceTime: candidate.commenceTime });
    }
  }
  return [...map.values()];
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
  return {
    matchId: matchId || "",
    fixtureId: prefill.fixtureId,
    homeTeam: home || "",
    awayTeam: away || "",
    homeTeamZh: prefill.homeTeamZh,
    awayTeamZh: prefill.awayTeamZh,
    commenceTime: prefill.commenceTime || "",
  };
}
