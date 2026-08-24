// dc-blend walk-forward offline backtest — Phase 1 (market-anchored blend).
//
// Answers the pre-registered research questions in
// docs/research/PHASE-1-market-anchored-blend-2026-08-24.md:
//   RQ1  best model weight w in  blend = w·model + (1−w)·market anchor
//   RQ2  anchor choice: Pinnacle pre-closing (realistic) vs closing (academic)
//   RQ4  which market gains most from the blend (h2h / totals / handicap)
//
// Design:
//   Phase A — one walk-forward pass per league (same discipline as
//     dc-v1-backtest: first season burn-in, refit every --refit-days with a
//     warm start, per-league xi from dc-shadow.XI_BY_LEAGUE). Both the
//     scoreline fit (dc-v1) and the xG fit with borrowed rho (dc-xg-v1
//     variant) are fitted in the same pass. Per match we store only the
//     expected-goals rates and the raw prices, so the w sweep costs nothing.
//   Phase B — pure-function analysis over the stored records: for every
//     (model, anchor, w) we score probabilities (Brier / log-loss / RPS) and
//     simulate flat 1-unit bets through the production 3% edge gate, using
//     the production blend semantics (dc-shadow.blendQuoteEvaluation):
//     edge = (1−w)·(marketChance·odds − 1) + w·settlementEV(dist, odds).
//     Market de-vig mirrors production market-sharp: Shin for h2h, power
//     de-vig for two-way markets.
//
// Pre-registered splits (season of the predicted match):
//   tune       2020-21 … 2023-24   (2019-20 is the burn-in season)
//   validation 2024-25             (w is chosen here)
//   holdout    2025-26             (opened once, only with --include-holdout)
//
// Usage:
//   node scripts/dc-blend-backtest.mjs                       # tune+validation grids
//   node scripts/dc-blend-backtest.mjs --league E0
//   node scripts/dc-blend-backtest.mjs --rebuild             # ignore records cache
//   node scripts/dc-blend-backtest.mjs --include-holdout --pick model=xg,anchor=open,w=0.2
//   node scripts/dc-blend-backtest.mjs --self-test

import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  settleH2h,
  settleHandicap,
  settlementProfit,
  calibrationSummary,
  edgeBucketSummary,
  bootstrapRoiCi,
} from "./lib/backtest-metrics.mjs";
import { shinProbabilities, powerNoVigTwoWay } from "./lib/market-sharp.mjs";
import { XI_BY_LEAGUE, DEFAULT_XI } from "./lib/dc-shadow.mjs";
import { loadLeagueMatchesWithXg } from "./dc-xg-compare.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(root, "data", "blend-backtest");
const DEFAULT_LEAGUES = ["E0", "SP1", "D1", "I1", "F1"];
const EDGE_GATE = 0.03; // production BUY_EDGE_THRESHOLD — do not lower (ADR 0003)
const DAY_MS = 86_400_000;

export const W_GRID = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 1];
export const MODELS = ["goals", "xg"];
export const ANCHORS = ["open", "close"];
const H2H_SELECTIONS = ["home", "draw", "away"];

const VALIDATION_SEASON = "2024-25";
const HOLDOUT_SEASON = "2025-26";

export function scopeOf(season) {
  if (season === VALIDATION_SEASON) return "validation";
  if (season === HOLDOUT_SEASON) return "holdout";
  return "tune";
}

// ---------- Phase A: walk-forward record building ----------

// One record per predicted match: model rates (both variants) + raw prices.
// Probabilities are recomputed from rates in Phase B, so sweeping w never
// refits anything.
export function buildLeagueRecords(leagueMatches, { xi = DEFAULT_XI, refitDays = 10 } = {}) {
  const matches = [...leagueMatches].sort((a, b) => a.matchDate.localeCompare(b.matchDate));
  if (matches.length === 0) throw new Error("no matches");
  const firstSeason = matches[0].season;

  const records = [];
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
    records.push({
      season: match.season,
      matchDate: match.matchDate,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeGoals: match.homeGoals,
      awayGoals: match.awayGoals,
      goals: { lambda: goalsRates.lambda, mu: goalsRates.mu, rho: fitGoals.rho },
      xg: { lambda: xgRates.lambda, mu: xgRates.mu, rho: fitGoals.rho }, // borrowed rho = production xg-rho variant
      prices: {
        pinOpen: {
          h: match.pinOpenHomeOdds, d: match.pinOpenDrawOdds, a: match.pinOpenAwayOdds,
          over: match.pinOpenOverOdds, under: match.pinOpenUnderOdds,
          ahLine: match.pinOpenHandicapLine,
          ahH: match.pinOpenHandicapHomeOdds, ahA: match.pinOpenHandicapAwayOdds,
        },
        pinClose: {
          h: match.pinCloseHomeOdds, d: match.pinCloseDrawOdds, a: match.pinCloseAwayOdds,
          over: match.pinCloseOverOdds, under: match.pinCloseUnderOdds,
          ahLine: match.pinCloseHandicapLine,
          ahH: match.pinCloseHandicapHomeOdds, ahA: match.pinCloseHandicapAwayOdds,
        },
        avgOpen: {
          h: match.avgOpenHomeOdds, d: match.avgOpenDrawOdds, a: match.avgOpenAwayOdds,
          over: match.avgOpenOverOdds, under: match.avgOpenUnderOdds,
          ahH: match.avgOpenHandicapHomeOdds, ahA: match.avgOpenHandicapAwayOdds,
        },
        avgClose: {
          h: match.avgCloseHomeOdds, d: match.avgCloseDrawOdds, a: match.avgCloseAwayOdds,
          over: match.avgCloseOverOdds, under: match.avgCloseUnderOdds,
          ahH: match.avgCloseHandicapHomeOdds, ahA: match.avgCloseHandicapAwayOdds,
        },
      },
    });
  }
  return records;
}

// ---------- Phase B: analysis ----------

function emptyMarketEval() {
  // scores[model][anchor][w] and bets[model][anchor][betPrice][w]
  const scores = {};
  const bets = {};
  for (const model of MODELS) {
    scores[model] = {};
    bets[model] = {};
    for (const anchor of ANCHORS) {
      scores[model][anchor] = Object.fromEntries(W_GRID.map((w) => [w, { n: 0, brier: 0, logLoss: 0, rps: 0 }]));
      bets[model][anchor] = {};
    }
  }
  return { scores, bets, consensusBets: [], calibrationPairs: {}, coverage: 0 };
}

function betBucket(betsByModel, model, anchor, betPrice, w) {
  const byAnchor = betsByModel[model][anchor];
  const key = `${betPrice}|${w}`;
  if (!byAnchor[key]) byAnchor[key] = [];
  return byAnchor[key];
}

function recordBet(list, scope, matchKey, edge, settlement, odds) {
  list.push({ scope, matchKey, edge, profit: settlementProfit(settlement, odds), won: settlement === "win" || settlement === "half-win" ? 1 : 0 });
}

// Evaluates one market over all records. `h2h` gets full scoring; `totals`
// gets a two-way Brier; `handicap` is EV-only (no probability scoring, like
// the production shadow, because the market side carries no full dist).
export function evaluateH2h(records) {
  const out = emptyMarketEval();
  for (const record of records) {
    const scope = scopeOf(record.season);
    const actual = settleH2h(record.homeGoals - record.awayGoals);
    const pinOpen = record.prices.pinOpen;
    const pinClose = record.prices.pinClose;
    const anchorProbs = {
      open: shinProbabilities({ home: pinOpen.h, draw: pinOpen.d, away: pinOpen.a }),
      close: shinProbabilities({ home: pinClose.h, draw: pinClose.d, away: pinClose.a }),
    };
    if (!anchorProbs.open && !anchorProbs.close) continue;
    out.coverage += 1;
    const matchKey = `${record.matchDate}|${record.homeTeam}|${record.awayTeam}`;

    for (const model of MODELS) {
      const rates = record[model];
      const dcProbs = marketProbabilities(scoreMatrix(rates.lambda, rates.mu, rates.rho));
      for (const anchor of ANCHORS) {
        const anchorP = anchorProbs[anchor];
        if (!anchorP) continue;
        for (const w of W_GRID) {
          const probs = Object.fromEntries(H2H_SELECTIONS.map((s) => [s, w * dcProbs[s] + (1 - w) * anchorP[s]]));
          const score = out.scores[model][anchor][w];
          score.n += 1;
          score.brier += brier3(probs, actual);
          score.logLoss += logLoss3(probs, actual);
          score.rps += rps3(probs, actual);
          for (const betPrice of ANCHORS) {
            const oddsFor = betPrice === "open" ? pinOpen : pinClose;
            for (const selection of H2H_SELECTIONS) {
              const odds = oddsFor[{ home: "h", draw: "d", away: "a" }[selection]];
              if (!Number.isFinite(odds) || odds <= 1) continue;
              const edge = probs[selection] * odds - 1;
              if (edge < EDGE_GATE) continue;
              recordBet(betBucket(out.bets, model, anchor, betPrice, w), scope, matchKey, edge,
                actual === selection ? "win" : "loss", odds);
            }
          }
          // Calibration pairs are only needed for the report configs; collect
          // pooled (prob, hit) across selections for every (model, anchor, w).
          const calKey = `${model}|${anchor}|${w}`;
          out.calibrationPairs[calKey] = out.calibrationPairs[calKey] ?? { tune: [], validation: [], holdout: [] };
          for (const selection of H2H_SELECTIONS) {
            out.calibrationPairs[calKey][scope].push({ prob: probs[selection], hit: actual === selection ? 1 : 0 });
          }
        }
      }
    }

    // Baseline 4 — consensus-v1 proxy: equal-weight market average (Avg*),
    // proportional de-vig, betting at Pinnacle prices (LOO approximation).
    for (const timing of ANCHORS) {
      const avg = timing === "open" ? record.prices.avgOpen : record.prices.avgClose;
      const pin = timing === "open" ? pinOpen : pinClose;
      if (![avg.h, avg.d, avg.a].every(Number.isFinite)) continue;
      const chance = shinProbabilities({ home: avg.h, draw: avg.d, away: avg.a });
      if (!chance) continue;
      for (const selection of H2H_SELECTIONS) {
        const odds = pin[{ home: "h", draw: "d", away: "a" }[selection]];
        if (!Number.isFinite(odds) || odds <= 1) continue;
        const edge = chance[selection] * odds - 1;
        if (edge < EDGE_GATE) continue;
        recordBet(out.consensusBets, scope, `${matchKey}|consensus-${timing}`, edge, actual === selection ? "win" : "loss", odds);
      }
    }
  }
  return out;
}

export function evaluateTotals(records) {
  const out = emptyMarketEval();
  for (const record of records) {
    const scope = scopeOf(record.season);
    const totalGoals = record.homeGoals + record.awayGoals;
    const actualOver = totalGoals > 2.5;
    const pinOpen = record.prices.pinOpen;
    const pinClose = record.prices.pinClose;
    const anchorOver = {
      open: Number.isFinite(pinOpen.over) && Number.isFinite(pinOpen.under) ? powerNoVigTwoWay(pinOpen.over, pinOpen.under)[0] : null,
      close: Number.isFinite(pinClose.over) && Number.isFinite(pinClose.under) ? powerNoVigTwoWay(pinClose.over, pinClose.under)[0] : null,
    };
    if (anchorOver.open === null && anchorOver.close === null) continue;
    out.coverage += 1;
    const matchKey = `${record.matchDate}|${record.homeTeam}|${record.awayTeam}`;

    for (const model of MODELS) {
      const rates = record[model];
      const dcProbs = marketProbabilities(scoreMatrix(rates.lambda, rates.mu, rates.rho));
      for (const anchor of ANCHORS) {
        if (anchorOver[anchor] === null) continue;
        for (const w of W_GRID) {
          const pOver = w * dcProbs.over25 + (1 - w) * anchorOver[anchor];
          const score = out.scores[model][anchor][w];
          score.n += 1;
          score.brier += (pOver - (actualOver ? 1 : 0)) ** 2;
          for (const betPrice of ANCHORS) {
            const oddsFor = betPrice === "open" ? pinOpen : pinClose;
            for (const selection of ["over", "under"]) {
              const odds = oddsFor[selection];
              if (!Number.isFinite(odds) || odds <= 1) continue;
              const p = selection === "over" ? pOver : 1 - pOver;
              const edge = p * odds - 1;
              if (edge < EDGE_GATE) continue;
              recordBet(betBucket(out.bets, model, anchor, betPrice, w), scope, matchKey, edge,
                (selection === "over") === actualOver ? "win" : "loss", odds);
            }
          }
          const calKey = `${model}|${anchor}|${w}`;
          out.calibrationPairs[calKey] = out.calibrationPairs[calKey] ?? { tune: [], validation: [], holdout: [] };
          out.calibrationPairs[calKey][scope].push({ prob: pOver, hit: actualOver ? 1 : 0 });
        }
      }
    }

    for (const timing of ANCHORS) {
      const avg = timing === "open" ? record.prices.avgOpen : record.prices.avgClose;
      const pin = timing === "open" ? pinOpen : pinClose;
      if (!Number.isFinite(avg.over) || !Number.isFinite(avg.under)) continue;
      const [avgOver] = powerNoVigTwoWay(avg.over, avg.under);
      for (const selection of ["over", "under"]) {
        const odds = pin[selection];
        if (!Number.isFinite(odds) || odds <= 1) continue;
        const p = selection === "over" ? avgOver : 1 - avgOver;
        const edge = p * odds - 1;
        if (edge < EDGE_GATE) continue;
        recordBet(out.consensusBets, scope, `${matchKey}|consensus-${timing}`, edge,
          (selection === "over") === actualOver ? "win" : "loss", odds);
      }
    }
  }
  return out;
}

export function evaluateHandicap(records) {
  const out = emptyMarketEval();
  for (const record of records) {
    const scope = scopeOf(record.season);
    const margin = record.homeGoals - record.awayGoals;
    const matchKey = `${record.matchDate}|${record.homeTeam}|${record.awayTeam}`;
    // Anchor and bet price share the line (AHh for open, AHCh for close), so
    // cross-price betting is undefined here — betPrice === anchor.
    const sides = {
      open: record.prices.pinOpen,
      close: record.prices.pinClose,
    };
    const marketChance = {};
    for (const anchor of ANCHORS) {
      const side = sides[anchor];
      if (!Number.isFinite(side.ahLine) || !Number.isFinite(side.ahH) || !Number.isFinite(side.ahA)) continue;
      const [homeChance] = powerNoVigTwoWay(side.ahH, side.ahA);
      marketChance[anchor] = { line: side.ahLine, home: homeChance, away: 1 - homeChance, odds: { home: side.ahH, away: side.ahA } };
    }
    if (!marketChance.open && !marketChance.close) continue;
    out.coverage += 1;

    for (const model of MODELS) {
      const rates = record[model];
      const margins = marginDistribution(scoreMatrix(rates.lambda, rates.mu, rates.rho));
      for (const anchor of ANCHORS) {
        const mc = marketChance[anchor];
        if (!mc) continue;
        for (const w of W_GRID) {
          for (const selection of ["home", "away"]) {
            const odds = mc.odds[selection];
            const dist = handicapSettlementDist(margins, mc.line, selection);
            const edge = (1 - w) * (mc[selection] * odds - 1) + w * settlementEV(dist, odds);
            if (edge < EDGE_GATE) continue;
            recordBet(betBucket(out.bets, model, anchor, anchor, w), scope, matchKey, edge,
              settleHandicap(margin, mc.line, selection), odds);
          }
        }
      }
    }

    for (const timing of ANCHORS) {
      const avg = timing === "open" ? record.prices.avgOpen : record.prices.avgClose;
      const mc = marketChance[timing];
      if (!mc || !Number.isFinite(avg.ahH) || !Number.isFinite(avg.ahA)) continue;
      const [avgHome] = powerNoVigTwoWay(avg.ahH, avg.ahA);
      for (const selection of ["home", "away"]) {
        const odds = mc.odds[selection];
        const p = selection === "home" ? avgHome : 1 - avgHome;
        const edge = p * odds - 1;
        if (edge < EDGE_GATE) continue;
        recordBet(out.consensusBets, scope, `${matchKey}|consensus-${timing}`, edge,
          settleHandicap(margin, mc.line, selection), odds);
      }
    }
  }
  return out;
}

// ---------- reporting helpers ----------

export function roiSummary(bets, { clusters = true } = {}) {
  const profits = bets.map((bet) => bet.profit);
  const ci = bootstrapRoiCi(profits, {
    reps: 5000,
    clusters: clusters ? bets.map((bet) => bet.matchKey) : null,
  });
  return {
    bets: bets.length,
    hitRate: bets.length > 0 ? bets.reduce((sum, bet) => sum + bet.won, 0) / bets.length : null,
    roi: ci.roi,
    lower: ci.lower,
    upper: ci.upper,
  };
}

function pct(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "   n/a";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function scoreRow(label, score) {
  const n = score.n || 1;
  const parts = [`${label.padEnd(22)} n=${String(score.n).padStart(5)}`, `Brier ${(score.brier / n).toFixed(4)}`];
  if (score.logLoss !== 0 || score.rps !== 0) {
    parts.push(`LogLoss ${(score.logLoss / n).toFixed(4)}`, `RPS ${(score.rps / n).toFixed(4)}`);
  }
  return parts.join("  ");
}

// Re-scores records restricted to one scope (scores are cheap; kept separate
// from the bet pass so scope filtering is exact rather than accumulated).
export function scoreGridByScope(records, market, scope) {
  const scoped = records.filter((record) => scopeOf(record.season) === scope);
  const evalFn = market === "h2h" ? evaluateH2h : market === "totals" ? evaluateTotals : evaluateHandicap;
  const result = evalFn(scoped);
  return { scores: result.scores, coverage: result.coverage, bets: result.bets, consensusBets: result.consensusBets, calibrationPairs: result.calibrationPairs };
}

function printScopeReport(label, records, scopes) {
  for (const scope of scopes) {
    console.log(`\n================ ${label} · scope=${scope} ================`);
    for (const market of ["h2h", "totals", "handicap"]) {
      const { scores, coverage, bets, consensusBets } = scoreGridByScope(records, market, scope);
      console.log(`\n## ${market} (coverage: ${coverage} matches)`);
      if (market !== "handicap") {
        for (const model of MODELS) {
          for (const anchor of ANCHORS) {
            for (const w of W_GRID) {
              console.log(scoreRow(`${model} anchor=${anchor} w=${w}`, scores[model][anchor][w]));
            }
          }
        }
      }
      console.log(`## ${market} simulated bets (3% gate, flat 1u)`);
      for (const model of MODELS) {
        for (const anchor of ANCHORS) {
          const byPrice = bets[model][anchor];
          for (const [key, betList] of Object.entries(byPrice)) {
            const summary = roiSummary(betList);
            console.log(`${`${model} a=${anchor} ${key}`.padEnd(26)} ${String(summary.bets).padStart(5)} bets  hit ${summary.hitRate === null ? " n/a " : pct(summary.hitRate, 1)}  ROI ${pct(summary.roi)}  CI[${pct(summary.lower)}, ${pct(summary.upper)}]`);
          }
        }
      }
      const consensus = roiSummary(consensusBets);
      console.log(`${"consensus-proxy (Avg→Pin)".padEnd(26)} ${String(consensus.bets).padStart(5)} bets  hit ${consensus.hitRate === null ? " n/a " : pct(consensus.hitRate, 1)}  ROI ${pct(consensus.roi)}  CI[${pct(consensus.lower)}, ${pct(consensus.upper)}]`);
    }
  }
}

// ---------- self-test ----------

function selfTest() {
  const rng = createRng(20260824);
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
        matches.push({
          matchDate: new Date(start + day * DAY_MS).toISOString().slice(0, 10),
          season: seasonLabel,
          homeTeam: home, awayTeam: away, homeGoals: hg, awayGoals: ag,
          homeXg: lambda + (rng() - 0.5) * 0.3, awayXg: mu + (rng() - 0.5) * 0.3,
          pinOpenHomeOdds: 2.0, pinOpenDrawOdds: 3.4, pinOpenAwayOdds: 3.8,
          pinCloseHomeOdds: 2.05, pinCloseDrawOdds: 3.4, pinCloseAwayOdds: 3.7,
          pinOpenOverOdds: 1.95, pinOpenUnderOdds: 1.95,
          pinCloseOverOdds: 1.9, pinCloseUnderOdds: 2.0,
          pinOpenHandicapLine: -0.5, pinOpenHandicapHomeOdds: 1.95, pinOpenHandicapAwayOdds: 1.95,
          pinCloseHandicapLine: -0.5, pinCloseHandicapHomeOdds: 2.0, pinCloseHandicapAwayOdds: 1.9,
          avgOpenHomeOdds: 1.95, avgOpenDrawOdds: 3.3, avgOpenAwayOdds: 3.7,
          avgCloseHomeOdds: 2.0, avgCloseDrawOdds: 3.3, avgCloseAwayOdds: 3.6,
          avgOpenOverOdds: 1.93, avgOpenUnderOdds: 1.93,
          avgCloseOverOdds: 1.9, avgCloseUnderOdds: 1.95,
          avgOpenHandicapHomeOdds: 1.93, avgOpenHandicapAwayOdds: 1.93,
          avgCloseHandicapHomeOdds: 1.95, avgCloseHandicapAwayOdds: 1.9,
        });
        day += 3;
      }
    }
  }
  const records = buildLeagueRecords(matches, { refitDays: 14 });
  if (records.length === 0) throw new Error("self-test: nothing predicted");
  for (const market of ["h2h", "totals", "handicap"]) {
    const { scores, bets, coverage } = scoreGridByScope(records, market, "tune");
    if (coverage === 0) throw new Error(`self-test: ${market} zero coverage`);
    if (market !== "handicap") {
      for (const model of MODELS) {
        for (const anchor of ANCHORS) {
          for (const w of W_GRID) {
            const score = scores[model][anchor][w];
            if (score.n === 0) throw new Error(`self-test: ${market} ${model}/${anchor}/w=${w} scored nothing`);
            if (!(score.brier / score.n > 0 && score.brier / score.n < 2)) throw new Error(`self-test: ${market} brier out of range`);
          }
        }
      }
    }
    // Sanity: pure market (w=0) at its own closing price must never bet.
    for (const model of MODELS) {
      const ownPrice = bets[model].close;
      for (const [key, list] of Object.entries(ownPrice)) {
        if (key.endsWith("|0") && list.length > 0) {
          throw new Error(`self-test: ${market} w=0 at closing price should never bet (${model} ${key})`);
        }
      }
    }
  }
  const ci = bootstrapRoiCi([1, -1, 1, -1, 1], { reps: 100, seed: 1 });
  if (!(ci.lower <= ci.roi && ci.roi <= ci.upper)) throw new Error("self-test: bootstrap CI broken");
  console.log(`[dc-blend-backtest] self-test passed (records=${records.length})`);
}

// ---------- CLI ----------

async function loadRecords(leagues, { rebuild = false } = {}) {
  await mkdir(CACHE_DIR, { recursive: true });
  const byLeague = new Map();
  const needBuild = [];
  for (const league of leagues) {
    const cacheFile = path.join(CACHE_DIR, `records-${league}.json`);
    if (!rebuild) {
      try {
        byLeague.set(league, JSON.parse(await readFile(cacheFile, "utf8")));
        continue;
      } catch { /* fall through to rebuild */ }
    }
    needBuild.push(league);
  }
  if (needBuild.length > 0) {
    const { byLeague: matchesByLeague, joined } = await loadLeagueMatchesWithXg(needBuild);
    console.log(`[dc-blend-backtest] xG joined onto ${joined} matches (leagues: ${needBuild.join(",")})`);
    for (const league of needBuild) {
      const matches = matchesByLeague.get(league) ?? [];
      if (matches.length === 0) { console.log(`[dc-blend-backtest] ${league}: no CSV data, skipped`); continue; }
      const started = Date.now();
      const records = buildLeagueRecords(matches, { xi: XI_BY_LEAGUE[league] ?? DEFAULT_XI });
      byLeague.set(league, records);
      await writeFile(path.join(CACHE_DIR, `records-${league}.json`), JSON.stringify(records));
      console.log(`[dc-blend-backtest] ${league}: ${records.length} records (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    }
  }
  return byLeague;
}

// Detailed view for one chosen (model, anchor, w, betPrice) config:
// calibration bins (h2h + totals), edge-bucket ROI monotonicity, and a
// per-league ROI breakdown (single-league-only effects read as overfitting).
export function pickDetail(records, pick, scopes) {
  const detail = { calibration: {}, edgeBuckets: {}, perLeague: {} };
  const calKey = `${pick.model}|${pick.anchor}|${pick.w}`;
  for (const scope of scopes) {
    for (const market of ["h2h", "totals", "handicap"]) {
      const { bets, calibrationPairs } = scoreGridByScope(records, market, scope);
      if (market !== "handicap") {
        const pairs = calibrationPairs[calKey]?.[scope] ?? [];
        detail.calibration[`${market}|${scope}`] = calibrationSummary(pairs, 10);
      }
      const betPrice = market === "handicap" ? pick.anchor : pick.betPrice;
      const betList = bets[pick.model][pick.anchor][`${betPrice}|${pick.w}`] ?? [];
      detail.edgeBuckets[`${market}|${scope}`] = edgeBucketSummary(betList);
    }
  }
  const byLeague = new Map();
  for (const record of records) {
    byLeague.set(record.league ?? "?", [...(byLeague.get(record.league ?? "?") ?? []), record]);
  }
  for (const scope of scopes) {
    detail.perLeague[scope] = {};
    for (const market of ["h2h", "totals", "handicap"]) {
      const betPrice = market === "handicap" ? pick.anchor : pick.betPrice;
      detail.perLeague[scope][market] = {};
      for (const [league, leagueRecords] of byLeague) {
        const { bets } = scoreGridByScope(leagueRecords, market, scope);
        const betList = bets[pick.model][pick.anchor][`${betPrice}|${pick.w}`] ?? [];
        detail.perLeague[scope][market][league] = roiSummary(betList, { clusters: true });
      }
    }
  }
  return detail;
}

function printPickDetail(detail, pick, scopes) {
  console.log(`\n================ PICK model=${pick.model} anchor=${pick.anchor} w=${pick.w} betPrice=${pick.betPrice} ================`);
  for (const scope of scopes) {
    for (const market of ["h2h", "totals"]) {
      console.log(`\n## 校準 ${market} (${scope})  bin: n / meanProb → hitRate (gap)`);
      for (const bin of detail.calibration[`${market}|${scope}`]) {
        console.log(`  [${bin.min.toFixed(1)},${bin.max.toFixed(1)})  n=${String(bin.n).padStart(5)}  ${bin.meanProb.toFixed(3)} → ${bin.hitRate.toFixed(3)}  (${bin.gap >= 0 ? "+" : ""}${bin.gap.toFixed(3)})`);
      }
    }
    for (const market of ["h2h", "totals", "handicap"]) {
      const buckets = detail.edgeBuckets[`${market}|${scope}`];
      console.log(`## edge 分桶 ${market} (${scope})  monotone=${buckets.monotone}`);
      for (const bucket of buckets.buckets) {
        console.log(`  edge ≥ ${bucket.min.toFixed(2)}${bucket.max === Infinity ? "" : `–${bucket.max.toFixed(2)}`}  n=${String(bucket.n).padStart(5)}  ROI ${pct(bucket.roi)}`);
      }
    }
    for (const market of ["h2h", "totals", "handicap"]) {
      console.log(`## 逐聯賽 ROI ${market} (${scope})`);
      for (const [league, summary] of Object.entries(detail.perLeague[scope][market])) {
        console.log(`  ${league.padEnd(4)} ${String(summary.bets).padStart(5)} bets  ROI ${pct(summary.roi)}  CI[${pct(summary.lower)}, ${pct(summary.upper)}]`);
      }
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) return selfTest();
  const leagueIndex = argv.indexOf("--league");
  const leagues = leagueIndex >= 0 ? [argv[leagueIndex + 1].toUpperCase()] : DEFAULT_LEAGUES;
  const includeHoldout = argv.includes("--include-holdout");
  const rebuild = argv.includes("--rebuild");

  const byLeague = await loadRecords(leagues, { rebuild });
  for (const [league, records] of byLeague) {
    for (const record of records) record.league = league;
  }
  const allRecords = [...byLeague.values()].flat();
  if (allRecords.length === 0) throw new Error("no records built");

  const scopes = includeHoldout ? ["tune", "validation", "holdout"] : ["tune", "validation"];
  printScopeReport("ALL", allRecords, scopes);

  const pickIndex = argv.indexOf("--pick");
  const pick = { model: "goals", anchor: "open", w: 0.3, betPrice: "open" };
  if (pickIndex >= 0) {
    for (const pair of argv[pickIndex + 1].split(",")) {
      const [key, value] = pair.split("=");
      if (key === "w") pick.w = Number(value);
      else if (["model", "anchor", "betPrice"].includes(key)) pick[key] = value;
    }
  }
  const detail = pickDetail(allRecords, pick, scopes);
  printPickDetail(detail, pick, scopes);

  // Machine-readable output for the report.
  const out = { generatedAt: new Date().toISOString(), scopes, leagues, pick, perScope: {}, pickDetail: detail };
  for (const scope of scopes) {
    out.perScope[scope] = {};
    for (const market of ["h2h", "totals", "handicap"]) {
      const { scores, coverage, bets, consensusBets } = scoreGridByScope(allRecords, market, scope);
      const betSummary = {};
      for (const model of MODELS) {
        betSummary[model] = {};
        for (const anchor of ANCHORS) {
          betSummary[model][anchor] = Object.fromEntries(
            Object.entries(bets[model][anchor]).map(([key, list]) => [key, roiSummary(list)]),
          );
        }
      }
      const scoreSummary = {};
      for (const model of MODELS) {
        scoreSummary[model] = {};
        for (const anchor of ANCHORS) {
          scoreSummary[model][anchor] = {};
          for (const w of W_GRID) {
            const s = scores[model][anchor][w];
            const n = s.n || 1;
            scoreSummary[model][anchor][w] = {
              n: s.n,
              brier: s.brier / n,
              ...(market === "h2h" ? { logLoss: s.logLoss / n, rps: s.rps / n } : {}),
            };
          }
        }
      }
      out.perScope[scope][market] = {
        coverage,
        scores: scoreSummary,
        bets: betSummary,
        consensus: roiSummary(consensusBets),
      };
    }
  }
  await mkdir(CACHE_DIR, { recursive: true });
  const outFile = path.join(CACHE_DIR, `blend-results${includeHoldout ? "-with-holdout" : ""}.json`);
  await writeFile(outFile, JSON.stringify(out, null, 2));
  console.log(`\n[dc-blend-backtest] results written to ${outFile}`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[dc-blend-backtest] status=failed ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
