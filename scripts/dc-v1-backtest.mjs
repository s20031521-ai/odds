// dc-v1 walk-forward offline backtest (ADR 0003 experiment).
//
// For each league: burn in on the first season, then predict every later
// match using ONLY matches strictly before its date (no future leakage),
// refitting every --refit-days with a warm start. Compares dc-v1 against
// Pinnacle closing (de-vigged) on Brier / log-loss / RPS, and simulates
// flat 1-unit bets at closing prices through the production 3% edge gate.
//
// Usage:
//   node scripts/dc-v1-backtest.mjs                 # all five leagues
//   node scripts/dc-v1-backtest.mjs --league E0
//   node scripts/dc-v1-backtest.mjs --self-test

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  fitDixonColes,
  expectedGoals,
  scoreMatrix,
  marketProbabilities,
  marginDistribution,
  handicapSettlementDist,
  settlementEV,
  createRng,
  samplePoisson,
} from "./lib/dixon-coles.mjs";
import {
  brier3,
  logLoss3,
  rps3,
  devig3,
  devig2,
  settleH2h,
  settleTotals,
  settleHandicap,
  settlementProfit,
} from "./lib/backtest-metrics.mjs";
import { parseFootballDataCsv } from "./lib/football-data-csv.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(root, "data", "historical");
const DEFAULT_LEAGUES = ["E0", "SP1", "D1", "I1", "F1"];
const EDGE_GATE = 0.03; // production BUY_EDGE_THRESHOLD — do not lower (ADR 0003)

const DAY_MS = 86_400_000;

export function runBacktest(leagueMatches, { xi = 0.0019, refitDays = 10, blendWeight = 0.5 } = {}) {
  const matches = [...leagueMatches].sort((a, b) => a.matchDate.localeCompare(b.matchDate));
  if (matches.length === 0) throw new Error("no matches");
  const firstSeason = matches[0].season;

  const stats = {
    predicted: 0,
    dc: { brier: 0, logLoss: 0, rps: 0 },
    pin: { brier: 0, logLoss: 0, rps: 0 },
    totalsDcBrier: 0,
    totalsPinBrier: 0,
    totalsPredicted: 0,
    bets: {},
  };
  const betKeys = ["h2h:dc", "h2h:blend", "h2h:pin-control", "totals:dc", "totals:blend", "totals:pin-control", "ah:dc"];
  for (const key of betKeys) stats.bets[key] = { bets: 0, wins: 0, profit: 0 };

  let fit = null;
  let fitValidUntil = null;
  let trainEnd = 0; // exclusive index: matches[0..trainEnd) are "known"

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    if (match.season === firstSeason) { trainEnd = i + 1; continue; }
    const matchMs = Date.parse(`${match.matchDate}T00:00:00Z`);

    if (!fit || fitValidUntil === null || matchMs >= fitValidUntil) {
      const training = matches.slice(0, trainEnd);
      const warm = fit !== null;
      fit = fitDixonColes(training, {
        xi,
        refDate: match.matchDate,
        init: fit ?? undefined,
        maxOuter: warm ? 3 : 10,
        sweepsPerOuter: warm ? 4 : 8,
      });
      fitValidUntil = matchMs + refitDays * DAY_MS;
    }
    while (trainEnd < matches.length && Date.parse(`${matches[trainEnd].matchDate}T00:00:00Z`) < matchMs) {
      trainEnd += 1;
    }

    const { lambda, mu } = expectedGoals(fit, match.homeTeam, match.awayTeam);
    const matrix = scoreMatrix(lambda, mu, fit.rho);
    const dcProbs = marketProbabilities(matrix);
    const margin = match.homeGoals - match.awayGoals;
    const actual = settleH2h(margin);

    if (match.closingHomeOdds && match.closingDrawOdds && match.closingAwayOdds) {
      const pinProbs = devig3(match.closingHomeOdds, match.closingDrawOdds, match.closingAwayOdds);
      stats.dc.brier += brier3(dcProbs, actual);
      stats.dc.logLoss += logLoss3(dcProbs, actual);
      stats.dc.rps += rps3(dcProbs, actual);
      stats.pin.brier += brier3(pinProbs, actual);
      stats.pin.logLoss += logLoss3(pinProbs, actual);
      stats.pin.rps += rps3(pinProbs, actual);
      stats.predicted += 1;

      const blendProbs = {
        home: blendWeight * dcProbs.home + (1 - blendWeight) * pinProbs.home,
        draw: blendWeight * dcProbs.draw + (1 - blendWeight) * pinProbs.draw,
        away: blendWeight * dcProbs.away + (1 - blendWeight) * pinProbs.away,
      };
      const oddsFor = { home: match.closingHomeOdds, draw: match.closingDrawOdds, away: match.closingAwayOdds };
      for (const selection of ["home", "draw", "away"]) {
        placeIfEdge(stats.bets["h2h:dc"], dcProbs[selection], oddsFor[selection], actual === selection ? "win" : "loss");
        placeIfEdge(stats.bets["h2h:blend"], blendProbs[selection], oddsFor[selection], actual === selection ? "win" : "loss");
        placeIfEdge(stats.bets["h2h:pin-control"], pinProbs[selection], oddsFor[selection], actual === selection ? "win" : "loss");
      }
    }

    if (match.closingOverOdds && match.closingUnderOdds) {
      const totalGoals = match.homeGoals + match.awayGoals;
      const pinOver = devig2(match.closingOverOdds, match.closingUnderOdds).first;
      const actualOver = totalGoals > match.closingTotalsLine;
      stats.totalsDcBrier += (dcProbs.over25 - (actualOver ? 1 : 0)) ** 2;
      stats.totalsPinBrier += (pinOver - (actualOver ? 1 : 0)) ** 2;
      stats.totalsPredicted += 1;

      const blendOver = blendWeight * dcProbs.over25 + (1 - blendWeight) * pinOver;
      const oddsFor = { over: match.closingOverOdds, under: match.closingUnderOdds };
      const probFor = (model) => (model === "dc" ? { over: dcProbs.over25, under: dcProbs.under25 }
        : model === "blend" ? { over: blendOver, under: 1 - blendOver }
          : { over: pinOver, under: 1 - pinOver });
      for (const model of ["dc", "blend", "pin-control"]) {
        for (const selection of ["over", "under"]) {
          const probs = probFor(model);
          const settlement = settleTotals(totalGoals, match.closingTotalsLine, selection);
          placeIfEdge(stats.bets[`totals:${model}`], probs[selection], oddsFor[selection], settlement);
        }
      }
    }

    if (match.closingHandicapLine !== null && match.closingHandicapHomeOdds && match.closingHandicapAwayOdds) {
      const margins = marginDistribution(matrix);
      for (const side of ["home", "away"]) {
        const odds = side === "home" ? match.closingHandicapHomeOdds : match.closingHandicapAwayOdds;
        const dist = handicapSettlementDist(margins, match.closingHandicapLine, side);
        const ev = settlementEV(dist, odds);
        if (ev >= EDGE_GATE) {
          const settlement = settleHandicap(margin, match.closingHandicapLine, side);
          record(stats.bets["ah:dc"], settlement, odds);
        }
      }
    }
  }
  return stats;
}

function placeIfEdge(bucket, probability, odds, settlement) {
  if (!(probability > 0) || !(odds > 1)) return;
  if (probability * odds - 1 < EDGE_GATE) return;
  record(bucket, settlement, odds);
}

function record(bucket, settlement, odds) {
  bucket.bets += 1;
  if (settlement === "win" || settlement === "half-win") bucket.wins += 1;
  bucket.profit += settlementProfit(settlement, odds);
}

// ---------- CLI ----------

export async function loadLeagueMatches(leagues) {
  const files = (await readdir(DATA_DIR)).filter((name) => name.endsWith(".csv"));
  const byLeague = new Map(leagues.map((league) => [league, []]));
  for (const file of files) {
    const league = file.split("-")[0];
    if (!byLeague.has(league)) continue;
    const rows = parseFootballDataCsv(await readFile(path.join(DATA_DIR, file), "utf8"), { leagueCode: league });
    byLeague.get(league).push(...rows);
  }
  return byLeague;
}

function roiLine(label, bucket) {
  if (bucket.bets === 0) return `${label.padEnd(18)} ${"0 bets".padStart(10)}`;
  const roi = (bucket.profit / bucket.bets) * 100;
  const hit = (bucket.wins / bucket.bets) * 100;
  return `${label.padEnd(18)} ${String(bucket.bets).padStart(6)} bets  hit ${hit.toFixed(1).padStart(5)}%  ROI ${roi >= 0 ? "+" : ""}${roi.toFixed(2)}%`;
}

function printLeagueReport(league, stats) {
  const n = stats.predicted || 1;
  console.log(`\n=== ${league} — ${stats.predicted} matches predicted (h2h), ${stats.totalsPredicted} totals ===`);
  console.log(`metric      dc-v1      Pinnacle收盤`);
  console.log(`Brier   ${(stats.dc.brier / n).toFixed(4)}     ${(stats.pin.brier / n).toFixed(4)}`);
  console.log(`LogLoss ${(stats.dc.logLoss / n).toFixed(4)}     ${(stats.pin.logLoss / n).toFixed(4)}`);
  console.log(`RPS     ${(stats.dc.rps / n).toFixed(4)}     ${(stats.pin.rps / n).toFixed(4)}`);
  const tn = stats.totalsPredicted || 1;
  console.log(`大細Brier ${(stats.totalsDcBrier / tn).toFixed(4)}     ${(stats.totalsPinBrier / tn).toFixed(4)}`);
  console.log("--- 3% edge 閘門模擬落注（1 unit flat，用收盤價）---");
  for (const key of Object.keys(stats.bets)) console.log(roiLine(key, stats.bets[key]));
}

function mergeStats(target, source) {
  target.predicted += source.predicted;
  target.totalsPredicted += source.totalsPredicted;
  for (const k of ["brier", "logLoss", "rps"]) { target.dc[k] += source.dc[k]; target.pin[k] += source.pin[k]; }
  target.totalsDcBrier += source.totalsDcBrier;
  target.totalsPinBrier += source.totalsPinBrier;
  for (const key of Object.keys(source.bets)) {
    if (!target.bets[key]) target.bets[key] = { bets: 0, wins: 0, profit: 0 };
    target.bets[key].bets += source.bets[key].bets;
    target.bets[key].wins += source.bets[key].wins;
    target.bets[key].profit += source.bets[key].profit;
  }
}

function selfTest() {
  const rng = createRng(2026);
  const teams = ["A", "B", "C", "D", "E", "F"];
  const strength = { A: 0.4, B: 0.2, C: 0, D: -0.1, E: -0.2, F: -0.4 };
  const matches = [];
  let day = 0;
  const start = Date.UTC(2022, 7, 1);
  for (let season = 0; season < 3; season += 1) {
    const seasonLabel = `${2022 + season}-${String((2023 + season) % 100).padStart(2, "0")}`;
    for (const home of teams) {
      for (const away of teams) {
        if (home === away) continue;
        const lambda = Math.exp(0.15 + 0.25 + strength[home] + strength[away] * 0.5);
        const mu = Math.exp(0.15 + strength[away] + strength[home] * 0.5);
        const hg = samplePoisson(rng, lambda);
        const ag = samplePoisson(rng, mu);
        const pHome = 0.5; // rough stand-in; odds carry a 5% margin
        matches.push({
          matchDate: new Date(start + day * DAY_MS).toISOString().slice(0, 10),
          season: seasonLabel,
          homeTeam: home, awayTeam: away, homeGoals: hg, awayGoals: ag,
          closingHomeOdds: 1 / (pHome * 1.05), closingDrawOdds: 3.4, closingAwayOdds: 1 / ((1 - pHome - 0.29) * 1.05),
          closingTotalsLine: 2.5, closingOverOdds: 1.95, closingUnderOdds: 1.95,
          closingHandicapLine: -0.5, closingHandicapHomeOdds: 1.95, closingHandicapAwayOdds: 1.95,
        });
        day += 3;
      }
    }
  }
  const stats = runBacktest(matches, { refitDays: 14 });
  if (stats.predicted === 0) throw new Error("self-test: nothing predicted");
  const n = stats.predicted;
  const brier = stats.dc.brier / n;
  if (!(brier > 0 && brier < 2)) throw new Error(`self-test: brier out of range ${brier}`);
  if (stats.bets["h2h:pin-control"].bets !== 0) throw new Error("self-test: devigged closing should never pass its own gate");
  console.log(`[dc-v1-backtest] self-test passed (predicted=${stats.predicted}, brier=${brier.toFixed(4)})`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) return selfTest();
  const leagueIndex = argv.indexOf("--league");
  const leagues = leagueIndex >= 0 ? [argv[leagueIndex + 1].toUpperCase()] : DEFAULT_LEAGUES;
  const refitIndex = argv.indexOf("--refit-days");
  const refitDays = refitIndex >= 0 ? Number(argv[refitIndex + 1]) : 10;
  const blendIndex = argv.indexOf("--blend");
  const blendWeight = blendIndex >= 0 ? Number(argv[blendIndex + 1]) : 0.5;

  const byLeague = await loadLeagueMatches(leagues);
  const overall = { predicted: 0, totalsPredicted: 0, dc: { brier: 0, logLoss: 0, rps: 0 }, pin: { brier: 0, logLoss: 0, rps: 0 }, totalsDcBrier: 0, totalsPinBrier: 0, bets: {} };
  for (const [league, matches] of byLeague) {
    if (matches.length === 0) { console.log(`[dc-v1-backtest] ${league}: no CSV data, skipped`); continue; }
    const started = Date.now();
    const stats = runBacktest(matches, { refitDays, blendWeight });
    printLeagueReport(league, stats);
    console.log(`(fit+predict ${((Date.now() - started) / 1000).toFixed(1)}s)`);
    mergeStats(overall, stats);
  }
  if (leagues.length > 1) printLeagueReport("TOTAL 總計", overall);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[dc-v1-backtest] status=failed ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
