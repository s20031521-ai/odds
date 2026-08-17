// Joins Understat xG (data/understat/*.json) onto team_match_history
// (migration 007 columns home_xg/away_xg). Offline training data (ADR 0003).
//
// Understat team titles differ from football-data.co.uk names, so rows are
// matched on (league_code, match_date, canonical home/away) after mapping
// titles through UNDERSTAT_TEAM_ALIASES. Scorelines are cross-checked as a
// data-quality guard — a goals mismatch means the join paired wrong matches.
//
// Usage:
//   node scripts/join-xg-history.mjs              # full join + report
//   node scripts/join-xg-history.mjs --dry-run    # report only, no UPDATE
//   node scripts/join-xg-history.mjs --self-test

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalTeamName } from "./lib/dc-shadow.mjs";
import { parseLeagueData } from "./lib/understat-xg.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const XG_DIR = path.join(root, "data", "understat");

try {
  process.loadEnvFile(path.join(root, ".env.local"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

// Understat title (canonicalized) → football-data.co.uk name. Only pairs
// where plain normalization does not already match need an entry; the
// football-data name is always verified against the DB roster at join time.
export const UNDERSTAT_TEAM_ALIASES = new Map(Object.entries({
  // E0 — England
  manchesterunited: "Man United",
  manchestercity: "Man City",
  newcastleunited: "Newcastle",
  nottinghamforest: "Nott'm Forest",
  westbromwichalbion: "West Brom",
  wolverhamptonwanderers: "Wolves",
  // SP1 — Spain
  athleticclub: "Ath Bilbao",
  atleticomadrid: "Ath Madrid",
  celtavigo: "Celta",
  espanyol: "Espanol",
  rayovallecano: "Vallecano",
  realbetis: "Betis",
  realoviedo: "Oviedo",
  realsociedad: "Sociedad",
  realvalladolid: "Valladolid",
  sdhuesca: "Huesca",
  // D1 — Germany
  arminiabielefeld: "Bielefeld",
  bayerleverkusen: "Leverkusen",
  borussiadortmund: "Dortmund",
  borussiamgladbach: "M'gladbach",
  eintrachtfrankfurt: "Ein Frankfurt",
  fccologne: "FC Koln",
  fcheidenheim: "Heidenheim",
  fortunaduesseldorf: "Fortuna Dusseldorf",
  greutherfuerth: "Greuther Furth",
  hamburgersv: "Hamburg",
  herthaberlin: "Hertha",
  "mainz05": "Mainz",
  rasenballsportleipzig: "RB Leipzig",
  vfbstuttgart: "Stuttgart",
  // I1 — Italy
  acmilan: "Milan",
  parmacalcio1913: "Parma",
  spal2013: "Spal",
  // F1 — France
  clermontfoot: "Clermont",
  parissaintgermain: "Paris SG",
  saintetienne: "St Etienne",
}));

// Resolves an Understat title to the football-data name, verifying against
// the roster (Set of canonical football-data names for the league).
export function resolveUnderstatTeam(title, rosterCanonical) {
  const canonical = canonicalTeamName(title);
  if (!canonical) return null;
  if (rosterCanonical.has(canonical)) return canonical;
  const alias = UNDERSTAT_TEAM_ALIASES.get(canonical);
  if (alias && rosterCanonical.has(canonicalTeamName(alias))) return canonicalTeamName(alias);
  return null;
}

// Pure matching: given DB rows and parsed xG rows, produce updates plus a
// report. Kept DB-free so the whole join logic is unit-testable.
export function matchXgRows(dbRows, xgRows) {
  const byKey = new Map();
  for (const row of dbRows) {
    const key = [
      row.league_code,
      row.match_date,
      canonicalTeamName(row.home_team),
      canonicalTeamName(row.away_team),
    ].join("|");
    byKey.set(key, row);
  }
  const rosterByLeague = new Map();
  for (const row of dbRows) {
    if (!rosterByLeague.has(row.league_code)) rosterByLeague.set(row.league_code, new Set());
    const roster = rosterByLeague.get(row.league_code);
    roster.add(canonicalTeamName(row.home_team));
    roster.add(canonicalTeamName(row.away_team));
  }

  const updates = [];
  const unmatched = [];
  let goalsMismatch = 0;
  for (const xg of xgRows) {
    const roster = rosterByLeague.get(xg.leagueCode) ?? new Set();
    const home = resolveUnderstatTeam(xg.homeTeam, roster);
    const away = resolveUnderstatTeam(xg.awayTeam, roster);
    if (!home || !away) {
      unmatched.push({ league: xg.leagueCode, date: xg.matchDate, home: xg.homeTeam, away: xg.awayTeam, reason: "team" });
      continue;
    }
    const dbRow = byKey.get([xg.leagueCode, xg.matchDate, home, away].join("|"));
    if (!dbRow) {
      unmatched.push({ league: xg.leagueCode, date: xg.matchDate, home: xg.homeTeam, away: xg.awayTeam, reason: "fixture" });
      continue;
    }
    if (dbRow.home_goals !== xg.homeGoals || dbRow.away_goals !== xg.awayGoals) goalsMismatch += 1;
    updates.push({ id: dbRow.id, homeXg: xg.homeXg, awayXg: xg.awayXg });
  }
  return { updates, unmatched, goalsMismatch };
}

async function applyUpdates(pool, updates) {
  const BATCH = 500;
  let applied = 0;
  for (let start = 0; start < updates.length; start += BATCH) {
    const batch = updates.slice(start, start + BATCH);
    await pool.query(
      `
      UPDATE team_match_history AS t
      SET home_xg = v.home_xg, away_xg = v.away_xg
      FROM (
        SELECT * FROM unnest($1::bigint[], $2::numeric[], $3::numeric[])
      ) AS v(id, home_xg, away_xg)
      WHERE t.id = v.id
      `,
      [batch.map((u) => u.id), batch.map((u) => u.homeXg), batch.map((u) => u.awayXg)],
    );
    applied += batch.length;
  }
  return applied;
}

async function loadXgRows(dir) {
  const rows = [];
  for (const entry of (await readdir(dir)).filter((name) => name.endsWith(".json")).sort()) {
    const match = entry.match(/^([A-Z0-9]+)-(\d{4})\.json$/);
    if (!match) continue;
    const payload = JSON.parse(await readFile(path.join(dir, entry), "utf8"));
    rows.push(...parseLeagueData(payload, { leagueCode: match[1], seasonStart: Number.parseInt(match[2], 10) }));
  }
  return rows;
}

function selfTest() {
  const dbRows = [
    { id: 1, league_code: "E0", match_date: "2024-08-16", home_team: "Man United", away_team: "Fulham", home_goals: 1, away_goals: 0 },
    { id: 2, league_code: "D1", match_date: "2024-08-23", home_team: "M'gladbach", away_team: "Leverkusen", home_goals: 2, away_goals: 3 },
  ];
  const xgRows = [
    { leagueCode: "E0", season: "2425", matchDate: "2024-08-16", homeTeam: "Manchester United", awayTeam: "Fulham", homeGoals: 1, awayGoals: 0, homeXg: 2.04, awayXg: 0.42 },
    { leagueCode: "D1", season: "2425", matchDate: "2024-08-23", homeTeam: "Borussia M.Gladbach", awayTeam: "Bayer Leverkusen", homeGoals: 2, awayGoals: 3, homeXg: 1.1, awayXg: 2.9 },
    { leagueCode: "E0", season: "2425", matchDate: "2024-08-17", homeTeam: "Nobody FC", awayTeam: "Fulham", homeGoals: 0, awayGoals: 0, homeXg: 0.5, awayXg: 0.5 },
  ];
  const { updates, unmatched, goalsMismatch } = matchXgRows(dbRows, xgRows);
  if (updates.length !== 2) throw new Error(`expected 2 updates, got ${updates.length}`);
  if (updates[0].id !== 1 || Math.abs(updates[0].homeXg - 2.04) > 1e-9) throw new Error("alias join failed");
  if (updates[1].id !== 2) throw new Error("gladbach alias join failed");
  if (unmatched.length !== 1 || unmatched[0].reason !== "team") throw new Error("unmatched reporting failed");
  if (goalsMismatch !== 0) throw new Error("goals cross-check failed");
  console.log("[join-xg] self-test passed");
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--self-test")) return selfTest();
  if (!process.env.DATABASE_URL) throw new Error("join-xg-history is PostgreSQL-only; set DATABASE_URL");

  const xgRows = await loadXgRows(XG_DIR);
  console.log(`[join-xg] loaded ${xgRows.length} understat rows`);

  const { createPool } = await import("../server/db/pool.mjs");
  const pool = createPool(process.env.DATABASE_URL);
  try {
    const { rows: dbRows } = await pool.query(
      `SELECT id, league_code, match_date::text, home_team, away_team, home_goals, away_goals
       FROM team_match_history WHERE league_code = ANY($1::text[])`,
      [["E0", "SP1", "D1", "I1", "F1"]],
    );
    const { updates, unmatched, goalsMismatch } = matchXgRows(dbRows, xgRows);

    console.log(`[join-xg] matched=${updates.length} unmatched=${unmatched.length} goalsMismatch=${goalsMismatch}`);
    const sample = unmatched.slice(0, 10).map((u) => `${u.league} ${u.date} ${u.home} vs ${u.away} (${u.reason})`);
    for (const line of sample) console.log(`[join-xg]   unmatched: ${line}`);

    if (args.has("--dry-run")) {
      console.log("[join-xg] dry-run, no UPDATE issued");
      return;
    }
    const applied = await applyUpdates(pool, updates);
    console.log(`[join-xg] status=complete updated=${applied}`);
  } finally {
    await pool.end();
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[join-xg] status=failed ${error.message}`);
    process.exitCode = 1;
  });
}
