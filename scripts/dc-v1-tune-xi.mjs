// dc-v1 xi tuner (ADR 0003 research tooling, read-only).
//
// Sweeps the time-decay parameter xi per league through the SAME walk-forward
// harness as scripts/dc-v1-backtest.mjs and reports h2h log-loss / Brier and
// totals Brier for each value. The winner per league feeds XI_BY_LEAGUE in
// scripts/lib/dc-shadow.mjs.
//
// Usage:
//   node scripts/dc-v1-tune-xi.mjs                 # all five leagues
//   node scripts/dc-v1-tune-xi.mjs --league E0
//   node scripts/dc-v1-tune-xi.mjs --self-test

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { loadLeagueMatches, runBacktest } from "./dc-v1-backtest.mjs";
import { createRng, samplePoisson } from "./lib/dixon-coles.mjs";

const DEFAULT_LEAGUES = ["E0", "SP1", "D1", "I1", "F1"];
const XI_GRID = [0.0005, 0.001, 0.0019, 0.003, 0.005];
const DAY_MS = 86_400_000;

export function tuneLeague(leagueMatches, xiGrid = XI_GRID) {
  return xiGrid.map((xi) => {
    const stats = runBacktest(leagueMatches, { xi });
    const n = stats.predicted || 1;
    const tn = stats.totalsPredicted || 1;
    return {
      xi,
      predicted: stats.predicted,
      logLoss: stats.dc.logLoss / n,
      brier: stats.dc.brier / n,
      rps: stats.dc.rps / n,
      totalsBrier: stats.totalsDcBrier / tn,
    };
  });
}

export function pickXi(results) {
  // Primary: h2h log-loss (sharpest proper scoring rule here). Tiebreak: Brier.
  return [...results].sort((left, right) => left.logLoss - right.logLoss || left.brier - right.brier)[0]?.xi ?? null;
}

function printLeagueTable(league, results) {
  const best = pickXi(results);
  console.log(`\n=== ${league} — ${results[0]?.predicted ?? 0} matches predicted ===`);
  console.log("xi        logLoss   Brier     RPS       大細Brier");
  for (const row of results) {
    const marker = row.xi === best ? "  <-- best" : "";
    console.log(`${String(row.xi).padEnd(9)} ${row.logLoss.toFixed(4)}    ${row.brier.toFixed(4)}    ${row.rps.toFixed(4)}    ${row.totalsBrier.toFixed(4)}${marker}`);
  }
  return best;
}

function selfTest() {
  const rng = createRng(7);
  const teams = ["A", "B", "C", "D"];
  const matches = [];
  let day = 0;
  const start = Date.UTC(2022, 7, 1);
  for (let season = 0; season < 2; season += 1) {
    const seasonLabel = `${2022 + season}-${String((2023 + season) % 100).padStart(2, "0")}`;
    for (const home of teams) {
      for (const away of teams) {
        if (home === away) continue;
        matches.push({
          matchDate: new Date(start + day * DAY_MS).toISOString().slice(0, 10),
          season: seasonLabel,
          homeTeam: home,
          awayTeam: away,
          homeGoals: samplePoisson(rng, 1.5),
          awayGoals: samplePoisson(rng, 1.1),
          closingHomeOdds: 2.1,
          closingDrawOdds: 3.3,
          closingAwayOdds: 3.4,
          closingTotalsLine: 2.5,
          closingOverOdds: 1.95,
          closingUnderOdds: 1.95,
        });
        day += 3;
      }
    }
  }
  const results = tuneLeague(matches, [0.001, 0.002]);
  if (results.length !== 2) throw new Error("self-test: expected one row per xi");
  if (!results.every((row) => Number.isFinite(row.logLoss) && row.predicted > 0)) {
    throw new Error("self-test: rows must carry finite logLoss over predicted matches");
  }
  const best = pickXi(results);
  if (best !== 0.001 && best !== 0.002) throw new Error(`self-test: unexpected winner ${best}`);
  console.log("[dc-v1-tune-xi] self-test passed");
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) return selfTest();
  const leagueIndex = argv.indexOf("--league");
  const leagues = leagueIndex >= 0 ? [argv[leagueIndex + 1].toUpperCase()] : DEFAULT_LEAGUES;

  const byLeague = await loadLeagueMatches(leagues);
  const recommendation = {};
  for (const [league, matches] of byLeague) {
    if (matches.length === 0) {
      console.log(`[dc-v1-tune-xi] ${league}: no CSV data, skipped`);
      continue;
    }
    const started = Date.now();
    const results = tuneLeague(matches);
    recommendation[league] = printLeagueTable(league, results);
    console.log(`(grid took ${((Date.now() - started) / 1000).toFixed(1)}s)`);
  }
  console.log(`\nXI_BY_LEAGUE 建議: ${JSON.stringify(recommendation)}`);
  console.log("將勝出值寫入 scripts/lib/dc-shadow.mjs 嘅 XI_BY_LEAGUE。");
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[dc-v1-tune-xi] status=failed ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
