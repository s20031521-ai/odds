// dc-xg walk-forward comparison (ADR 0003 experiment).
//
// Scores four response-variable variants of the same engine on out-of-sample
// h2h predictions (log-loss / Brier / RPS against actual results):
//   goals   — baseline dc-v1, fit on scorelines
//   xg      — fit on Understat xG (continuous response, tau/rho off)
//   xg-rho  — xG-fitted rates + rho borrowed from the scoreline fit
//   mix     — 50/50 probability mixture of the goals and xg score matrices
//
// Data: data/historical CSVs joined with data/understat JSONs through the
// same matchXgRows logic used by the production join (scripts/join-xg-history).
//
// Usage:
//   node scripts/dc-xg-compare.mjs                 # all five leagues
//   node scripts/dc-xg-compare.mjs --league E0
//   node scripts/dc-xg-compare.mjs --self-test

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  fitDixonColes,
  expectedGoals,
  scoreMatrix,
  marketProbabilities,
  createRng,
  samplePoisson,
} from "./lib/dixon-coles.mjs";
import { brier3, logLoss3, rps3, settleH2h } from "./lib/backtest-metrics.mjs";
import { XI_BY_LEAGUE, DEFAULT_XI } from "./lib/dc-shadow.mjs";
import { parseLeagueData } from "./lib/understat-xg.mjs";
import { matchXgRows } from "./join-xg-history.mjs";
import { loadLeagueMatches } from "./dc-v1-backtest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const XG_DIR = path.join(root, "data", "understat");
const DEFAULT_LEAGUES = ["E0", "SP1", "D1", "I1", "F1"];
const DAY_MS = 86_400_000;
const VARIANTS = ["goals", "xg", "xg-rho", "mix"];

export async function loadLeagueMatchesWithXg(leagues, xgDir = XG_DIR) {
  const byLeague = await loadLeagueMatches(leagues);

  const xgRows = [];
  for (const entry of (await readdir(xgDir)).filter((name) => name.endsWith(".json"))) {
    const match = entry.match(/^([A-Z0-9]+)-(\d{4})\.json$/);
    if (!match || !byLeague.has(match[1])) continue;
    const payload = JSON.parse(await readFile(path.join(xgDir, entry), "utf8"));
    xgRows.push(...parseLeagueData(payload, { leagueCode: match[1], seasonStart: Number.parseInt(match[2], 10) }));
  }

  const dbLike = [];
  for (const [league, matches] of byLeague) {
    matches.forEach((m, index) => dbLike.push({
      id: `${league}:${index}`,
      league_code: league,
      match_date: m.matchDate,
      home_team: m.homeTeam,
      away_team: m.awayTeam,
      home_goals: m.homeGoals,
      away_goals: m.awayGoals,
    }));
  }
  const { updates, goalsMismatch } = matchXgRows(dbLike, xgRows);
  if (goalsMismatch > 0) {
    console.warn(`[dc-xg-compare] warning: ${goalsMismatch} joined rows disagree on the scoreline`);
  }
  const byId = new Map();
  for (const [league, matches] of byLeague) {
    matches.forEach((m, index) => byId.set(`${league}:${index}`, m));
  }
  let joined = 0;
  for (const u of updates) {
    const row = byId.get(u.id);
    if (!row) continue;
    row.homeXg = u.homeXg;
    row.awayXg = u.awayXg;
    joined += 1;
  }
  return { byLeague, joined };
}

function emptyScores() {
  return Object.fromEntries(VARIANTS.map((v) => [v, { brier: 0, logLoss: 0, rps: 0, n: 0 }]));
}

export function compareLeague(leagueMatches, { xi = DEFAULT_XI, refitDays = 10 } = {}) {
  const matches = [...leagueMatches].sort((a, b) => a.matchDate.localeCompare(b.matchDate));
  if (matches.length === 0) throw new Error("no matches");
  const firstSeason = matches[0].season;

  const scores = emptyScores();
  let fitGoals = null;
  let fitXg = null;
  let fitValidUntil = null;
  let trainEnd = 0;

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    if (match.season === firstSeason) { trainEnd = i + 1; continue; }
    const matchMs = Date.parse(`${match.matchDate}T00:00:00Z`);

    if (!fitGoals || matchMs >= fitValidUntil) {
      const training = matches.slice(0, trainEnd);
      const warm = fitGoals !== null;
      const fitOpts = {
        xi,
        refDate: match.matchDate,
        maxOuter: warm ? 3 : 10,
        sweepsPerOuter: warm ? 4 : 8,
      };
      fitGoals = fitDixonColes(training, { ...fitOpts, init: fitGoals ?? undefined });
      fitXg = fitDixonColes(training, { ...fitOpts, response: "xg", init: fitXg ?? undefined });
      fitValidUntil = matchMs + refitDays * DAY_MS;
    }
    while (trainEnd < matches.length && Date.parse(`${matches[trainEnd].matchDate}T00:00:00Z`) < matchMs) {
      trainEnd += 1;
    }

    const goalsRates = expectedGoals(fitGoals, match.homeTeam, match.awayTeam);
    const xgRates = expectedGoals(fitXg, match.homeTeam, match.awayTeam);
    const goalsMatrix = scoreMatrix(goalsRates.lambda, goalsRates.mu, fitGoals.rho);
    const xgMatrix = scoreMatrix(xgRates.lambda, xgRates.mu, 0);
    const xgRhoMatrix = scoreMatrix(xgRates.lambda, xgRates.mu, fitGoals.rho);
    const mixMatrix = goalsMatrix.map((row, h) => row.map((p, a) => (p + xgMatrix[h][a]) / 2));

    const probs = {
      goals: marketProbabilities(goalsMatrix),
      xg: marketProbabilities(xgMatrix),
      "xg-rho": marketProbabilities(xgRhoMatrix),
      mix: marketProbabilities(mixMatrix),
    };
    const actual = settleH2h(match.homeGoals - match.awayGoals);
    for (const variant of VARIANTS) {
      scores[variant].brier += brier3(probs[variant], actual);
      scores[variant].logLoss += logLoss3(probs[variant], actual);
      scores[variant].rps += rps3(probs[variant], actual);
      scores[variant].n += 1;
    }
  }
  return scores;
}

function printReport(league, scores) {
  const n = scores.goals.n || 1;
  console.log(`\n=== ${league} — ${n} matches predicted ===`);
  console.log(`variant    Brier     LogLoss   RPS`);
  for (const variant of VARIANTS) {
    const s = scores[variant];
    console.log(`${variant.padEnd(9)} ${(s.brier / n).toFixed(4)}    ${(s.logLoss / n).toFixed(4)}    ${(s.rps / n).toFixed(4)}`);
  }
}

function selfTest() {
  const rng = createRng(99);
  const teams = ["A", "B", "C", "D", "E", "F"];
  const matches = [];
  let day = 0;
  const start = Date.UTC(2022, 7, 1);
  for (let season = 0; season < 3; season += 1) {
    const seasonLabel = `${2022 + season}-${String((2023 + season) % 100).padStart(2, "0")}`;
    for (const home of teams) {
      for (const away of teams) {
        if (home === away) continue;
        const lambda = Math.exp(0.3 + 0.1 * teams.indexOf(home) * 0.1);
        const mu = Math.exp(0.2 - 0.05 * teams.indexOf(away));
        matches.push({
          matchDate: new Date(start + day * DAY_MS).toISOString().slice(0, 10),
          season: seasonLabel,
          homeTeam: home,
          awayTeam: away,
          homeGoals: samplePoisson(rng, lambda),
          awayGoals: samplePoisson(rng, mu),
          homeXg: lambda + (rng() - 0.5) * 0.4,
          awayXg: mu + (rng() - 0.5) * 0.4,
        });
        day += 3;
      }
    }
  }
  const scores = compareLeague(matches, { refitDays: 14 });
  for (const variant of VARIANTS) {
    if (scores[variant].n === 0) throw new Error(`self-test: variant ${variant} predicted nothing`);
    const brier = scores[variant].brier / scores[variant].n;
    if (!(brier > 0 && brier < 2)) throw new Error(`self-test: ${variant} brier out of range ${brier}`);
  }
  console.log(`[dc-xg-compare] self-test passed (n=${scores.goals.n})`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) return selfTest();
  const leagueIndex = argv.indexOf("--league");
  const leagues = leagueIndex >= 0 ? [argv[leagueIndex + 1].toUpperCase()] : DEFAULT_LEAGUES;

  const { byLeague, joined } = await loadLeagueMatchesWithXg(leagues);
  console.log(`[dc-xg-compare] xG joined onto ${joined} matches`);
  const overall = emptyScores();
  for (const [league, matches] of byLeague) {
    if (matches.length === 0) continue;
    const started = Date.now();
    const scores = compareLeague(matches, { xi: XI_BY_LEAGUE[league] ?? DEFAULT_XI });
    printReport(league, scores);
    console.log(`(${((Date.now() - started) / 1000).toFixed(1)}s)`);
    for (const variant of VARIANTS) {
      for (const k of ["brier", "logLoss", "rps"]) overall[variant][k] += scores[variant][k];
      overall[variant].n += scores[variant].n;
    }
  }
  if (leagues.length > 1) printReport("TOTAL 總計", overall);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[dc-xg-compare] status=failed ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
