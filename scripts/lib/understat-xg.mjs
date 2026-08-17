// xG data layer: fetch + parse Understat getLeagueData responses.
//
// Understat has no official API, but its league pages load
//   https://understat.com/getLeagueData/<slug>/<seasonStart>
// via XHR and return JSON with a match-level `dates` array:
//   { id, isResult, h: { title }, a: { title }, goals: { h, a },
//     xG: { h, a }, datetime: "2024-08-16 19:00:00" }
// Coverage: all five top leagues from 2014/15 (seasonStart 2014).
//
// Pure parsing lives here so it can be unit-tested without network.

export const UNDERSTAT_LEAGUES = new Map(Object.entries({
  E0: { slug: "EPL", label: "Premier League" },
  SP1: { slug: "La_liga", label: "La Liga" },
  D1: { slug: "Bundesliga", label: "Bundesliga" },
  I1: { slug: "Serie_A", label: "Serie A" },
  F1: { slug: "Ligue_1", label: "Ligue 1" },
}));

export const FIRST_SEASON_START = 2014;

// football-data season code ("2425") ↔ Understat seasonStart (2024)
export function seasonStartFromCode(seasonCode) {
  const start = Number.parseInt(String(seasonCode).slice(0, 2), 10);
  return start >= 90 ? 1900 + start : 2000 + start;
}

export function seasonCodeFromStart(seasonStart) {
  const start = seasonStart % 100;
  return `${String(start).padStart(2, "0")}${String((start + 1) % 100).padStart(2, "0")}`;
}

export function leagueDataUrl(leagueCode, seasonStart) {
  const league = UNDERSTAT_LEAGUES.get(leagueCode);
  if (!league) throw new Error(`unknown league code ${leagueCode}`);
  return `https://understat.com/getLeagueData/${league.slug}/${seasonStart}`;
}

function parseXg(value) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Normalizes one getLeagueData payload into match rows:
//   { leagueCode, season, matchDate, homeTeam, awayTeam,
//     homeGoals, awayGoals, homeXg, awayXg }
// Team names are Understat titles; mapping to football-data names happens
// in the join step. Unplayed fixtures (isResult false) are skipped.
export function parseLeagueData(payload, { leagueCode, seasonStart }) {
  if (!payload || !Array.isArray(payload.dates)) {
    throw new Error("getLeagueData payload has no dates array");
  }
  const season = seasonCodeFromStart(seasonStart);
  const rows = [];
  for (const match of payload.dates) {
    if (!match || match.isResult !== true) continue;
    const homeXg = parseXg(match.xG?.h);
    const awayXg = parseXg(match.xG?.a);
    const homeGoals = Number.parseInt(match.goals?.h, 10);
    const awayGoals = Number.parseInt(match.goals?.a, 10);
    const matchDate = typeof match.datetime === "string" ? match.datetime.slice(0, 10) : null;
    if (!matchDate || homeXg === null || awayXg === null) continue;
    if (!Number.isInteger(homeGoals) || !Number.isInteger(awayGoals)) continue;
    rows.push({
      leagueCode,
      season,
      matchDate,
      homeTeam: match.h?.title ?? "",
      awayTeam: match.a?.title ?? "",
      homeGoals,
      awayGoals,
      homeXg,
      awayXg,
    });
  }
  return rows;
}

// fetch() wrapper kept separate so tests never touch the network.
export async function fetchLeagueSeason(leagueCode, seasonStart, { fetchImpl = fetch } = {}) {
  const url = leagueDataUrl(leagueCode, seasonStart);
  const response = await fetchImpl(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) odds-research",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `https://understat.com/league/${UNDERSTAT_LEAGUES.get(leagueCode).slug}/${seasonStart}`,
    },
  });
  if (!response.ok) throw new Error(`understat HTTP ${response.status} for ${leagueCode} ${seasonStart}`);
  const payload = await response.json();
  return parseLeagueData(payload, { leagueCode, seasonStart });
}
