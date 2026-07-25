/** Minimal fixture shape for bet form search / link. */
export type FixturePick = {
  matchId: string;
  fixtureId?: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamZh?: string;
  awayTeamZh?: string;
  commenceTime: string;
  league?: string;
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
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Filter fixtures by free-text query (team / matchId / league). Empty query → first `limit` by commenceTime desc. */
export function filterFixturePicks(
  fixtures: FixturePick[],
  query: string,
  limit = 12,
): FixturePick[] {
  const q = query.trim().toLowerCase();
  const sorted = [...fixtures].sort((a, b) => {
    const ta = Date.parse(a.commenceTime);
    const tb = Date.parse(b.commenceTime);
    const na = Number.isFinite(ta) ? ta : 0;
    const nb = Number.isFinite(tb) ? tb : 0;
    return nb - na;
  });
  if (!q) return sorted.slice(0, limit);
  return sorted.filter((f) => haystack(f).includes(q)).slice(0, limit);
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
