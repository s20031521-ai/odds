// Bulk-imports historical scorelines (+ closing odds) from football-data.co.uk CSVs
// into team_match_history (migration 006). PostgreSQL-only, like unified-sampler:
// this is offline model-fitting data (ADR 0003), not a live odds collector.
//
// Usage:
//   node scripts/import-historical-scores.mjs --file data/historical/E0-2425.csv
//   node scripts/import-historical-scores.mjs --dir data/historical
//   node scripts/import-historical-scores.mjs --download E0 2425
//   node scripts/import-historical-scores.mjs --self-test
//
// Idempotent: the (source, league_code, match_date, home_team, away_team)
// unique key makes re-imports upsert in place.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseFootballDataCsv } from "./lib/football-data-csv.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SOURCE = "football-data.co.uk";
const DOWNLOAD_DIR = path.join(root, "data", "historical");

try {
  process.loadEnvFile(path.join(root, ".env.local"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

export async function importRows(pool, rows, { source = DEFAULT_SOURCE } = {}) {
  let processed = 0;
  for (const row of rows) {
    await pool.query(
      `
      INSERT INTO team_match_history (
        source, league_code, season, match_date, home_team, away_team,
        home_goals, away_goals,
        closing_home_odds, closing_draw_odds, closing_away_odds,
        closing_totals_line, closing_over_odds, closing_under_odds,
        closing_handicap_line, closing_handicap_home_odds, closing_handicap_away_odds
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8,
        $9, $10, $11,
        $12, $13, $14,
        $15, $16, $17
      )
      ON CONFLICT (source, league_code, match_date, home_team, away_team)
      DO UPDATE SET
        season = EXCLUDED.season,
        home_goals = EXCLUDED.home_goals,
        away_goals = EXCLUDED.away_goals,
        closing_home_odds = EXCLUDED.closing_home_odds,
        closing_draw_odds = EXCLUDED.closing_draw_odds,
        closing_away_odds = EXCLUDED.closing_away_odds,
        closing_totals_line = EXCLUDED.closing_totals_line,
        closing_over_odds = EXCLUDED.closing_over_odds,
        closing_under_odds = EXCLUDED.closing_under_odds,
        closing_handicap_line = EXCLUDED.closing_handicap_line,
        closing_handicap_home_odds = EXCLUDED.closing_handicap_home_odds,
        closing_handicap_away_odds = EXCLUDED.closing_handicap_away_odds
      RETURNING (xmax = 0) AS inserted
      `,
      [
        source,
        row.leagueCode,
        row.season,
        row.matchDate,
        row.homeTeam,
        row.awayTeam,
        row.homeGoals,
        row.awayGoals,
        row.closingHomeOdds,
        row.closingDrawOdds,
        row.closingAwayOdds,
        row.closingTotalsLine,
        row.closingOverOdds,
        row.closingUnderOdds,
        row.closingHandicapLine,
        row.closingHandicapHomeOdds,
        row.closingHandicapAwayOdds,
      ],
    );
    processed += 1;
  }
  return { processed };
}

async function downloadCsv(leagueCode, seasonCode) {
  const url = `https://www.football-data.co.uk/mmz4281/${seasonCode}/${leagueCode}.csv`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status} for ${url}`);
  const text = await response.text();
  await mkdir(DOWNLOAD_DIR, { recursive: true });
  const filePath = path.join(DOWNLOAD_DIR, `${leagueCode}-${seasonCode}.csv`);
  await writeFile(filePath, text, "utf8");
  return { filePath, text };
}

function parseArgs(argv) {
  const args = { files: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--file") args.files.push(argv[++index]);
    else if (arg === "--dir") args.dir = argv[++index];
    else if (arg === "--download") args.download = { league: argv[++index], season: argv[++index] };
    else if (arg === "--league") args.league = argv[++index];
    else if (arg === "--self-test") args.selfTest = true;
  }
  return args;
}

function leagueFromFilename(filePath, fallback) {
  if (fallback) return fallback;
  const base = path.basename(filePath);
  const match = base.match(/^([A-Za-z0-9]+)(?:-\d{4})?\.csv$/i);
  return match ? match[1].toUpperCase() : null;
}

async function collectCsvTexts(args) {
  const jobs = [];
  if (args.download) {
    const { filePath, text } = await downloadCsv(args.download.league, args.download.season);
    console.log(`[import-historical] downloaded ${args.download.league} ${args.download.season} -> ${path.relative(root, filePath)}`);
    jobs.push({ leagueCode: args.download.league.toUpperCase(), text });
  }
  const files = [...args.files];
  if (args.dir) {
    const entries = await readdir(args.dir);
    for (const entry of entries.filter((name) => name.toLowerCase().endsWith(".csv")).sort()) {
      files.push(path.join(args.dir, entry));
    }
  }
  for (const filePath of files) {
    const leagueCode = leagueFromFilename(filePath, args.league);
    if (!leagueCode) throw new Error(`cannot infer league code from ${filePath}; pass --league`);
    jobs.push({ leagueCode, text: await readFile(filePath, "utf8"), filePath });
  }
  return jobs;
}

function selfTest() {
  const sample = [
    "Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,PSH,PSD,PSA,B365>2.5,B365<2.5,AHh,PAHH,PAHA",
    "E0,10/08/2024,Man United,Fulham,1,0,1.75,3.90,4.80,1.88,1.98,-0.75,1.95,1.95",
    "E0,17/08/2024,Spurs,Everton,,,,,,,,,,",
  ].join("\n");
  const rows = parseFootballDataCsv(sample, { leagueCode: "E0" });
  if (rows.length !== 1) throw new Error(`expected 1 played row, got ${rows.length}`);
  if (rows[0].closingHandicapLine !== -0.75) throw new Error("handicap line parse failed");
  const queries = [];
  const fakePool = { async query(sql, params) { queries.push([sql, params]); return { rows: [] }; } };
  return importRows(fakePool, rows).then((result) => {
    if (result.processed !== 1 || queries.length !== 1) throw new Error("upsert not issued");
    if (!queries[0][0].includes("ON CONFLICT")) throw new Error("upsert missing ON CONFLICT");
    console.log("[import-historical] self-test passed");
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return selfTest();

  const jobs = await collectCsvTexts(args);
  if (jobs.length === 0) {
    console.error("[import-historical] nothing to import; use --file/--dir/--download");
    process.exitCode = 1;
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error("import-historical-scores is PostgreSQL-only; set DATABASE_URL");

  const { createPool } = await import("../server/db/pool.mjs");
  const pool = createPool(process.env.DATABASE_URL);
  try {
    let total = 0;
    for (const job of jobs) {
      const rows = parseFootballDataCsv(job.text, { leagueCode: job.leagueCode });
      const result = await importRows(pool, rows);
      total += result.processed;
      console.log(`[import-historical] ${job.leagueCode}: ${result.processed} matches imported`);
    }
    console.log(`[import-historical] status=complete total=${total}`);
  } finally {
    await pool.end();
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[import-historical] status=failed ${error.message}`);
    process.exitCode = 1;
  });
}
