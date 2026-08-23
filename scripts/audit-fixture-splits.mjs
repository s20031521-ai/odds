#!/usr/bin/env node
// Read-only audit for cross-provider fixture splits (Workstream B, step 5).
//
// Lists fixture groups that share the same canonical home/away team keys and
// kickoff times within ±10 minutes but still occupy different fixture ids —
// i.e. matches HDC and HKJC failed to share. This script NEVER writes; any
// actual merge requires a separately approved forward-only migration with a
// dry-run mapping first.
//
// Usage:
//   node scripts/audit-fixture-splits.mjs --self-test
//   DATABASE_URL=... node scripts/audit-fixture-splits.mjs --database
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalLeagueKey, canonicalTeamKey } from "../server/domain/fixture-aliases.mjs";

const WINDOW_MS = 10 * 60_000;

/**
 * Given fixture rows ({ id, homeTeam, awayTeam, commenceTime, league,
 * providers }), return groups of rows that should share one fixtureId but
 * do not. Rows missing teams or kickoff are ignored (fail-closed).
 */
export function findSplitCandidates(fixtures) {
  const byTeams = new Map();
  for (const row of fixtures ?? []) {
    const home = canonicalTeamKey(row?.homeTeam);
    const away = canonicalTeamKey(row?.awayTeam);
    const kickoff = Date.parse(row?.commenceTime ?? "");
    if (!home || !away || !Number.isFinite(kickoff)) continue;
    const key = `${home}|${away}`;
    byTeams.set(key, [...(byTeams.get(key) ?? []), { ...row, kickoff }]);
  }

  const candidates = [];
  for (const rows of byTeams.values()) {
    if (new Set(rows.map((row) => row.id)).size < 2) continue;
    const sorted = [...rows].sort((left, right) => left.kickoff - right.kickoff);
    // Cluster by kickoff proximity, then report clusters with >1 fixture id.
    let cluster = [sorted[0]];
    const flush = () => {
      const ids = new Set(cluster.map((row) => row.id));
      if (ids.size > 1) {
        candidates.push({
          homeTeam: cluster[0].homeTeam,
          awayTeam: cluster[0].awayTeam,
          fixtures: cluster.map((row) => ({
            fixtureId: row.id,
            commenceTime: row.commenceTime,
            league: row.league ?? null,
            canonicalLeague: row.league ? canonicalLeagueKey(row.league) : null,
            providers: [...new Set(row.providers ?? [])].sort(),
          })),
        });
      }
    };
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index].kickoff - cluster[cluster.length - 1].kickoff > WINDOW_MS) {
        flush();
        cluster = [sorted[index]];
      } else {
        cluster.push(sorted[index]);
      }
    }
    flush();
  }
  return candidates.sort((left, right) =>
    Date.parse(left.fixtures[0].commenceTime) - Date.parse(right.fixtures[0].commenceTime));
}

function selfTest() {
  const fixtures = [
    // The Daejeon/Gangwon split: identical teams + kickoff, league differs.
    { id: "f-hdc", homeTeam: "Daejeon Citizen", awayTeam: "Gangwon FC", commenceTime: "2026-08-23T10:00:00.000Z", league: "K League 1", providers: ["the-odds-api:soccer_korea_kleague1"] },
    { id: "f-hkjc", homeTeam: "Daejeon Citizen", awayTeam: "Gangwon FC", commenceTime: "2026-08-23T10:00:00.000Z", league: "Korean Division 1", providers: ["hkjc"] },
    // Alias-only split (Incheon Utd vs Incheon United), kickoff 6 min apart.
    { id: "f-hdc-2", homeTeam: "Gwangju FC", awayTeam: "Incheon United", commenceTime: "2026-08-23T11:00:00.000Z", league: "K League 1", providers: ["the-odds-api"] },
    { id: "f-hkjc-2", homeTeam: "Gwangju FC", awayTeam: "Incheon Utd", commenceTime: "2026-08-23T11:06:00.000Z", league: "Korean Division 1", providers: ["hkjc"] },
    // Same teams but kickoff outside the window: NOT a candidate.
    { id: "f-away", homeTeam: "Daejeon Citizen", awayTeam: "Gangwon FC", commenceTime: "2026-08-30T10:00:00.000Z", league: "K League 1", providers: ["the-odds-api"] },
    // Men vs women: never a candidate even at the same kickoff.
    { id: "f-men", homeTeam: "Arsenal", awayTeam: "Chelsea", commenceTime: "2026-08-23T15:00:00.000Z", league: "EPL", providers: ["the-odds-api"] },
    { id: "f-women", homeTeam: "Arsenal Women", awayTeam: "Chelsea Women", commenceTime: "2026-08-23T15:00:00.000Z", league: "WSL", providers: ["hkjc"] },
  ];
  const candidates = findSplitCandidates(fixtures);
  assert(candidates.length === 2, `expected 2 split candidates, got ${candidates.length}`);
  const [daejeon, gwangju] = candidates;
  assert(daejeon.fixtures.map((f) => f.fixtureId).join(",") === "f-hdc,f-hkjc", "daejeon split pair");
  assert(gwangju.fixtures.map((f) => f.fixtureId).join(",") === "f-hdc-2,f-hkjc-2", "gwangju split pair");
  assert(!candidates.some((c) => c.fixtures.some((f) => f.fixtureId === "f-women")), "women never merge");
  console.log("[audit-fixture-splits] self-test passed");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runDatabaseMode() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("--database mode requires DATABASE_URL");
  const { createPool } = await import("../server/db/pool.mjs");
  const pool = createPool(databaseUrl);
  try {
    // Strictly read-only.
    const fixturesResult = await pool.query(`
      SELECT id, home_team, away_team, commence_time, league
      FROM fixtures
      ORDER BY commence_time
    `);
    const aliasesResult = await pool.query(`
      SELECT fixture_id, provider FROM fixture_aliases
    `);
    const providersByFixture = new Map();
    for (const row of aliasesResult.rows) {
      providersByFixture.set(row.fixture_id, [...(providersByFixture.get(row.fixture_id) ?? []), row.provider]);
    }
    const fixtures = fixturesResult.rows.map((row) => ({
      id: row.id,
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      commenceTime: row.commence_time instanceof Date ? row.commence_time.toISOString() : row.commence_time,
      league: row.league,
      providers: providersByFixture.get(row.id) ?? [],
    }));
    const candidates = findSplitCandidates(fixtures);
    console.log(`fixtures=${fixtures.length} splitCandidates=${candidates.length}`);
    for (const candidate of candidates) {
      console.log(JSON.stringify(candidate));
    }
    console.log("note: read-only audit; merges require an approved forward-only migration with dry-run mapping first");
  } finally {
    await pool.end();
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  if (process.argv.includes("--self-test")) selfTest();
  else if (process.argv.includes("--database")) await runDatabaseMode();
  else console.log("usage: --self-test | --database (requires DATABASE_URL)");
}
