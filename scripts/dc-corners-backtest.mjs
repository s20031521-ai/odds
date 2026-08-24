// dc-corners walk-forward offline backtest — Phase 2 (corner model feasibility).
//
// Answers the pre-registered feasibility questions in
// docs/research/PHASE-2-corner-model-feasibility-2026-08-24.md:
//   - can a Dixon-Coles-shaped model on corner counts (response: "corners",
//     independent Poisson, no tau/rho) predict total corners better than
//     simple baselines?
//   - is the over/under probability calibrated across corner lines?
//
// No corner odds exist in the historical CSVs (§4 of the research doc), so
// this backtest validates PREDICTION QUALITY ONLY — log-loss / RPS on the
// total-corner distribution and O/U calibration. ROI can only be collected
// later in shadow mode.
//
// Baselines (both walk-forward, training data only):
//   league-mean — Poisson(expanding mean of total corners in training)
//   team-mean   — Poisson(shrunk per-team home/away corner means added
//                 together; shrinkage k=6 toward league side means)
//
// Pass/fail (pre-registered in the research doc §8):
//   PASS  — total log-loss clearly better than the league-mean baseline AND
//           better than the team-mean baseline, O/U calibration reasonable,
//           stable across leagues
//   FAIL  — the model merely ties the team-mean baseline (corner
//           predictability too low) → stop; steps 5–6 of the plan are dropped
//
// Pre-registered splits (season of the predicted match), same as Phase 1:
//   tune       2020-21 … 2023-24   (2019-20 is the burn-in season)
//   validation 2024-25             (xi is chosen on tune, checked here)
//   holdout    2025-26             (opened once, only with --include-holdout)
//
// Usage:
//   node scripts/dc-corners-backtest.mjs                      # tune xi per league, eval tune+validation
//   node scripts/dc-corners-backtest.mjs --league E0
//   node scripts/dc-corners-backtest.mjs --rebuild            # ignore records cache
//   node scripts/dc-corners-backtest.mjs --include-holdout    # one-shot holdout opening
//   node scripts/dc-corners-backtest.mjs --self-test

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  fitDixonColes,
  expectedGoals,
  poissonTotalDistribution,
  createRng,
  samplePoisson,
} from "./lib/dixon-coles.mjs";
import { calibrationSummary } from "./lib/backtest-metrics.mjs";
import { loadLeagueMatches } from "./dc-v1-backtest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(root, "data", "corners-backtest");
const DEFAULT_LEAGUES = ["E0", "SP1", "D1", "I1", "F1"];
const DAY_MS = 86_400_000;
const MAX_TOTAL = 40;
const SHRINK_K = 6;

const VALIDATION_SEASON = "2024-25";
const HOLDOUT_SEASON = "2025-26";

// Tuning grid for the corners-specific time decay (research doc §3.1: corner
// decay may differ from goals; tune on the tune scope only).
export const XI_GRID = [0, 0.0005, 0.001, 0.0019, 0.003, 0.005];
const OU_LINES = [8.5, 9.5, 10.5, 11.5];

export function scopeOf(season) {
  if (season === VALIDATION_SEASON) return "validation";
  if (season === HOLDOUT_SEASON) return "holdout";
  return "tune";
}

// ---------- Phase A: walk-forward record building ----------

// One record per predicted match: dc-corners rates + both baseline rates +
// actual corner counts. All three rate sets come from the same training
// window (matches strictly before the predicted match's date).
export function buildLeagueRecords(leagueMatches, { xi = 0.0019, refitDays = 10 } = {}) {
  const all = [...leagueMatches].sort((a, b) => a.matchDate.localeCompare(b.matchDate));
  const matches = all.filter((m) => Number.isInteger(m.homeCorners) && Number.isInteger(m.awayCorners));
  if (matches.length === 0) throw new Error("no matches with corner data");
  const firstSeason = matches[0].season;

  const records = [];
  let fit = null;
  let fitValidUntil = null;
  let trainEnd = 0;

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    if (match.season === firstSeason) { trainEnd = i + 1; continue; }
    const matchMs = Date.parse(`${match.matchDate}T00:00:00Z`);

    if (!fit || matchMs >= fitValidUntil) {
      const training = matches.slice(0, trainEnd);
      const warm = fit !== null;
      fit = fitDixonColes(training, {
        xi,
        refDate: match.matchDate,
        response: "corners",
        init: fit ?? undefined,
        maxOuter: warm ? 3 : 10,
        sweepsPerOuter: warm ? 4 : 8,
      });
      fitValidUntil = matchMs + refitDays * DAY_MS;
    }
    while (trainEnd < matches.length && Date.parse(`${matches[trainEnd].matchDate}T00:00:00Z`) < matchMs) {
      trainEnd += 1;
    }

    const rates = expectedGoals(fit, match.homeTeam, match.awayTeam);
    const baseline = baselineRates(matches.slice(0, trainEnd), match.homeTeam, match.awayTeam);
    records.push({
      season: match.season,
      matchDate: match.matchDate,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeCorners: match.homeCorners,
      awayCorners: match.awayCorners,
      dc: { lambda: rates.lambda, mu: rates.mu },
      leagueMean: { rate: baseline.leagueTotalRate },
      teamMean: { rate: baseline.teamTotalRate },
    });
  }
  return records;
}

// Walk-forward baselines from the training window only.
// leagueTotalRate: plain expanding mean of (homeCorners + awayCorners).
// teamTotalRate:  shrunk home-mean of the home team + shrunk away-mean of the
// away team (shrinkage SHRINK_K toward the league home/away means, so newly
// promoted teams start at the league average).
export function baselineRates(training, homeTeam, awayTeam) {
  let totalSum = 0;
  let homeSum = 0;
  let awaySum = 0;
  const homeStats = new Map(); // team -> { sum, n } for home games
  const awayStats = new Map();
  for (const m of training) {
    totalSum += m.homeCorners + m.awayCorners;
    homeSum += m.homeCorners;
    awaySum += m.awayCorners;
    const h = homeStats.get(m.homeTeam) ?? { sum: 0, n: 0 };
    h.sum += m.homeCorners; h.n += 1; homeStats.set(m.homeTeam, h);
    const a = awayStats.get(m.awayTeam) ?? { sum: 0, n: 0 };
    a.sum += m.awayCorners; a.n += 1; awayStats.set(m.awayTeam, a);
  }
  const n = training.length || 1;
  const leagueTotalRate = totalSum / n;
  const leagueHomeMean = homeSum / n;
  const leagueAwayMean = awaySum / n;
  const h = homeStats.get(homeTeam) ?? { sum: 0, n: 0 };
  const a = awayStats.get(awayTeam) ?? { sum: 0, n: 0 };
  const teamHomeRate = (h.sum + SHRINK_K * leagueHomeMean) / (h.n + SHRINK_K);
  const teamAwayRate = (a.sum + SHRINK_K * leagueAwayMean) / (a.n + SHRINK_K);
  return { leagueTotalRate, teamTotalRate: teamHomeRate + teamAwayRate };
}

// ---------- Phase B: scoring ----------

function logLossTotal(dist, actual) {
  const p = Math.max(1e-12, dist.get(actual) ?? 0);
  return -Math.log(p);
}

// Ranked probability score over ordered totals 0..MAX_TOTAL.
function rpsTotal(dist, actual) {
  let cumP = 0;
  let sum = 0;
  for (let k = 0; k < MAX_TOTAL; k += 1) {
    cumP += dist.get(k) ?? 0;
    const cumO = actual <= k ? 1 : 0;
    sum += (cumP - cumO) ** 2;
  }
  return sum / MAX_TOTAL;
}

function overProb(dist, line) {
  let under = 0;
  for (let k = 0; k <= Math.floor(line); k += 1) under += dist.get(k) ?? 0;
  return 1 - under;
}

const MODEL_KEYS = ["dc", "leagueMean", "teamMean"];

function emptyScores() {
  return Object.fromEntries(MODEL_KEYS.map((k) => [k, { n: 0, logLoss: 0, rps: 0 }]));
}

export function scoreRecords(records) {
  const scores = emptyScores();
  const ouBrier = Object.fromEntries(MODEL_KEYS.map((k) => [k, Object.fromEntries(OU_LINES.map((l) => [l, { n: 0, brier: 0 }]))]));
  const calibrationPairs = Object.fromEntries(MODEL_KEYS.map((k) => [k, []]));
  const dists = {
    dc: (r) => poissonTotalDistribution(r.dc.lambda, r.dc.mu, MAX_TOTAL),
    leagueMean: (r) => poissonTotalDistribution(r.leagueMean.rate / 2, r.leagueMean.rate / 2, MAX_TOTAL),
    teamMean: (r) => poissonTotalDistribution(r.teamMean.rate / 2, r.teamMean.rate / 2, MAX_TOTAL),
  };
  for (const record of records) {
    const total = record.homeCorners + record.awayCorners;
    for (const key of MODEL_KEYS) {
      const dist = dists[key](record);
      scores[key].n += 1;
      scores[key].logLoss += logLossTotal(dist, total);
      scores[key].rps += rpsTotal(dist, total);
      for (const line of OU_LINES) {
        const p = overProb(dist, line);
        const hit = total > line ? 1 : 0;
        ouBrier[key][line].n += 1;
        ouBrier[key][line].brier += (p - hit) ** 2;
        if (line === 10.5) calibrationPairs[key].push({ prob: p, hit });
      }
    }
  }
  return { scores, ouBrier, calibrationPairs };
}

// ---------- xi tuning ----------

export function tuneXi(recordsByXi) {
  // recordsByXi: Map xi -> records[] (one league). Pick by tune-scope
  // total-corner log-loss.
  const table = [];
  for (const [xi, records] of recordsByXi) {
    const tune = records.filter((r) => scopeOf(r.season) === "tune");
    const { scores } = scoreRecords(tune);
    table.push({ xi, n: scores.dc.n, logLoss: scores.dc.logLoss / (scores.dc.n || 1), rps: scores.dc.rps / (scores.dc.n || 1) });
  }
  table.sort((a, b) => a.xi - b.xi);
  const best = table.reduce((a, b) => (b.logLoss < a.logLoss ? b : a), table[0]);
  return { table, bestXi: best.xi };
}

// ---------- reporting ----------

function printScores(label, records, scopes) {
  for (const scope of scopes) {
    const scoped = records.filter((r) => scopeOf(r.season) === scope);
    if (scoped.length === 0) continue;
    const { scores, ouBrier, calibrationPairs } = scoreRecords(scoped);
    console.log(`\n================ ${label} · scope=${scope} (n=${scoped.length}) ================`);
    console.log("model        LogLoss    RPS       LogLoss vs league-mean");
    const base = scores.leagueMean.logLoss / (scores.leagueMean.n || 1);
    for (const key of MODEL_KEYS) {
      const s = scores[key];
      const n = s.n || 1;
      const ll = s.logLoss / n;
      console.log(`${key.padEnd(12)} ${ll.toFixed(4)}   ${(s.rps / n).toFixed(4)}   ${key === "leagueMean" ? "—" : `${(((ll - base) / base) * 100).toFixed(2)}%`}`);
    }
    for (const line of OU_LINES) {
      const parts = MODEL_KEYS.map((key) => {
        const b = ouBrier[key][line];
        return `${key} ${(b.brier / (b.n || 1)).toFixed(4)}`;
      });
      console.log(`大細 ${String(line).padEnd(4)} Brier:  ${parts.join("   ")}`);
    }
    console.log(`校準 (大 10.5, 10 bins):`);
    for (const key of MODEL_KEYS) {
      const bins = calibrationSummary(calibrationPairs[key], 10);
      const line = bins.map((b) => `[${b.min.toFixed(1)}) ${b.meanProb.toFixed(2)}→${b.hitRate.toFixed(2)}`).join(" ");
      console.log(`  ${key.padEnd(12)} ${line}`);
    }
  }
}

// ---------- self-test ----------

function selfTest() {
  const rng = createRng(20260824);
  const teams = ["A", "B", "C", "D", "E", "F"];
  // Wide per-team spread so the dc fit can separate teams well above Poisson
  // noise within the small synthetic training windows (a tight spread makes
  // the attack/defence split fit noise — that is a data property, not a bug).
  const cornerBase = { A: 9.0, B: 7.8, C: 6.4, D: 5.2, E: 4.2, F: 3.2 };
  const matches = [];
  let day = 0;
  const start = Date.UTC(2021, 7, 1);
  for (let season = 0; season < 4; season += 1) {
    const seasonLabel = `${2021 + season}-${String((2022 + season) % 100).padStart(2, "0")}`;
    for (const home of teams) {
      for (const away of teams) {
        if (home === away) continue;
        matches.push({
          matchDate: new Date(start + day * DAY_MS).toISOString().slice(0, 10),
          season: seasonLabel,
          homeTeam: home, awayTeam: away,
          homeCorners: samplePoisson(rng, cornerBase[home]),
          awayCorners: samplePoisson(rng, cornerBase[away]),
        });
        day += 3;
      }
    }
  }
  const records = buildLeagueRecords(matches, { xi: 0.001, refitDays: 14 });
  if (records.length === 0) throw new Error("self-test: nothing predicted");
  const { scores, ouBrier, calibrationPairs } = scoreRecords(records);
  for (const key of MODEL_KEYS) {
    if (scores[key].n === 0) throw new Error(`self-test: ${key} scored nothing`);
    const ll = scores[key].logLoss / scores[key].n;
    if (!(ll > 0 && ll < 10)) throw new Error(`self-test: ${key} log-loss out of range ${ll}`);
    if (!(ouBrier[key][10.5].brier / ouBrier[key][10.5].n < 1)) throw new Error(`self-test: ${key} O/U brier out of range`);
    if (calibrationPairs[key].length === 0) throw new Error(`self-test: ${key} calibration empty`);
  }
  // On data with genuine per-team corner rates, the dc model must beat the
  // league-mean baseline on total log-loss.
  if (scores.dc.logLoss >= scores.leagueMean.logLoss) {
    throw new Error("self-test: dc should beat league-mean baseline on synthetic team-strength data");
  }
  const tuning = tuneXi(new Map([[0.001, records], [0.003, records]]));
  if (!Number.isFinite(tuning.bestXi)) throw new Error("self-test: tuning failed");
  console.log(`[dc-corners-backtest] self-test passed (records=${records.length})`);
}

// ---------- CLI ----------

async function loadRecords(league, xi, { rebuild = false } = {}) {
  await mkdir(CACHE_DIR, { recursive: true });
  const cacheFile = path.join(CACHE_DIR, `records-${league}-xi${xi}.json`);
  if (!rebuild) {
    try {
      return JSON.parse(await readFile(cacheFile, "utf8"));
    } catch { /* fall through to rebuild */ }
  }
  const byLeague = await loadLeagueMatches([league]);
  const matches = byLeague.get(league) ?? [];
  if (matches.length === 0) return [];
  const started = Date.now();
  const records = buildLeagueRecords(matches, { xi });
  await writeFile(cacheFile, JSON.stringify(records));
  console.log(`[dc-corners-backtest] ${league} xi=${xi}: ${records.length} records (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  return records;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) return selfTest();
  const leagueIndex = argv.indexOf("--league");
  const leagues = leagueIndex >= 0 ? [argv[leagueIndex + 1].toUpperCase()] : DEFAULT_LEAGUES;
  const includeHoldout = argv.includes("--include-holdout");
  const rebuild = argv.includes("--rebuild");
  const scopes = includeHoldout ? ["tune", "validation", "holdout"] : ["tune", "validation"];

  const out = { generatedAt: new Date().toISOString(), scopes, leagues: {}, bestXiByLeague: {} };

  for (const league of leagues) {
    // Coverage note: how many rows have corners at all.
    const byLeague = await loadLeagueMatches([league]);
    const all = byLeague.get(league) ?? [];
    const withCorners = all.filter((m) => Number.isInteger(m.homeCorners) && Number.isInteger(m.awayCorners));
    console.log(`[dc-corners-backtest] ${league}: ${withCorners.length}/${all.length} matches have HC/AC`);

    const recordsByXi = new Map();
    for (const xi of XI_GRID) {
      recordsByXi.set(xi, await loadRecords(league, xi, { rebuild }));
    }
    const tuning = tuneXi(recordsByXi);
    console.log(`\n=== ${league} xi tuning (tune scope log-loss) ===`);
    for (const row of tuning.table) {
      console.log(`  xi=${String(row.xi).padEnd(7)} n=${String(row.n).padStart(5)} LogLoss ${row.logLoss.toFixed(4)}  RPS ${row.rps.toFixed(4)}${row.xi === tuning.bestXi ? "  <- best" : ""}`);
    }
    out.leagues[league] = { coverage: { total: all.length, withCorners: withCorners.length }, xiTuning: tuning.table };
    out.bestXiByLeague[league] = tuning.bestXi;

    const best = recordsByXi.get(tuning.bestXi);
    for (const record of best) record.league = league;
    printScores(league, best, scopes);
  }

  // Pooled view across leagues at each league's best xi.
  const pooled = [];
  for (const league of leagues) {
    const records = await loadRecords(league, out.bestXiByLeague[league], { rebuild: false });
    for (const record of records) record.league = league;
    pooled.push(...records);
  }
  if (leagues.length > 1) printScores("TOTAL 總計 (每聯賽 best xi)", pooled, scopes);

  // Machine-readable summary per scope for the report.
  for (const scope of scopes) {
    const scoped = pooled.filter((r) => scopeOf(r.season) === scope);
    if (scoped.length === 0) continue;
    const { scores, ouBrier } = scoreRecords(scoped);
    out[scope] = {
      n: scoped.length,
      scores: Object.fromEntries(MODEL_KEYS.map((k) => {
        const s = scores[k];
        const n = s.n || 1;
        return [k, { n: s.n, logLoss: s.logLoss / n, rps: s.rps / n }];
      })),
      ouBrier: Object.fromEntries(MODEL_KEYS.map((k) => [k,
        Object.fromEntries(OU_LINES.map((l) => [l, ouBrier[k][l].brier / (ouBrier[k][l].n || 1)]))])),
    };
  }
  // Per-league stability at best xi (pooled scopes separately).
  out.perLeague = {};
  for (const league of leagues) {
    const records = pooled.filter((r) => r.league === league);
    out.perLeague[league] = {};
    for (const scope of scopes) {
      const scoped = records.filter((r) => scopeOf(r.season) === scope);
      if (scoped.length === 0) continue;
      const { scores } = scoreRecords(scoped);
      out.perLeague[league][scope] = Object.fromEntries(MODEL_KEYS.map((k) => {
        const s = scores[k];
        return [k, { n: s.n, logLoss: s.logLoss / (s.n || 1) }];
      }));
    }
  }

  await mkdir(CACHE_DIR, { recursive: true });
  const outFile = path.join(CACHE_DIR, `corners-results${includeHoldout ? "-with-holdout" : ""}.json`);
  await writeFile(outFile, JSON.stringify(out, null, 2));
  console.log(`\n[dc-corners-backtest] results written to ${outFile}`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[dc-corners-backtest] status=failed ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
