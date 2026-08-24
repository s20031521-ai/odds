#!/usr/bin/env node
// Phase 3 replay harness (docs/research/PHASE-3-quote-quality-gate-
// 2026-08-24.md §4.1). Read-only: replays the settled unified-buyable-v1
// recommendation population (the 164 corner picks with known outcomes, plus
// the other markets) through quote-gate parameter grids and answers:
//
//   「閘門擋咗幾多 % 嘅虧損 vs 擋咗幾多 % 嘅盈利?」
//
// No model math is touched; every configuration is evaluated counterfactually
// on the SAME samples whose settlements are already known.
//
// Usage:
//   node scripts/replay-quote-gate.mjs --self-test
//   node scripts/replay-quote-gate.mjs --database [--market corners] [--json]
//
// --database requires DATABASE_URL (read-only SELECTs only). Against
// production, run inside the api container, e.g.:
//   sudo docker exec odds-tool-api-1 sh -c \
//     'DATABASE_URL="postgres://odds_app:$(cat /run/secrets/pg_app_password)@postgres:5432/odds" \
//      node scripts/replay-quote-gate.mjs --database'
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { settleAgainstActual } from "../server/domain/backtest.mjs";
import {
  QUOTE_GATE_CONFIG,
  QUOTE_GATE_CONFIG_VERSION,
} from "../shared/quote-gate-config.mjs";
import { gateContextRows, gateOpportunityQuotes } from "../shared/quote-quality-gate.mjs";

const UNIFIED_STRATEGY = "unified-buyable-v1";
const SETTLED = new Set(["win", "half-win", "push", "half-loss", "loss"]);

// ---------- parameter grid ----------

// 三個主要獨立旋鈕;相對新鮮度同盤口單調喺 grid 入面固定開住(佢哋嘅
// 敏感度用 --vary-secondary 先展開)。
const GRID = {
  cornersMaxOdds: [4, 5, 6, 8, 10, null],
  maxEdge: [0.10, 0.15, 0.20, null],
  maxSharpEdge: [0.10, 0.15, null],
};

export function* parameterGrid() {
  for (const cornersCap of GRID.cornersMaxOdds) {
    for (const maxEdge of GRID.maxEdge) {
      for (const maxSharpEdge of GRID.maxSharpEdge) {
        yield {
          label: `corners≤${cornersCap ?? "∞"} edge≤${maxEdge ?? "∞"} sharp≤${maxSharpEdge ?? "∞"}`,
          config: {
            ...QUOTE_GATE_CONFIG,
            maxOdds: { ...QUOTE_GATE_CONFIG.maxOdds, corners: cornersCap ?? Number.POSITIVE_INFINITY },
            maxEdge: maxEdge ?? Number.POSITIVE_INFINITY,
            maxSharpEdge: maxSharpEdge ?? Number.POSITIVE_INFINITY,
          },
        };
      }
    }
  }
}

// ---------- settlement ----------

function canonicalMarket(value) {
  if (value === "h2h" || value === "主客和") return "h2h";
  if (value === "handicap" || value === "亞洲讓球") return "handicap";
  if (value === "totals" || value === "大細波") return "totals";
  if (value === "corners" || value === "角球") return "corners";
  return value;
}

function settlementProfit(settlement, odds) {
  if (settlement === "win") return odds - 1;
  if (settlement === "half-win") return (odds - 1) / 2;
  if (settlement === "half-loss") return -0.5;
  if (settlement === "loss") return -1;
  return 0;
}

function resultForSample(results, sample) {
  return results.find((result) => {
    const sameFixture = result.fixtureId && sample.fixtureId
      ? result.fixtureId === sample.fixtureId
      : result.matchId && result.matchId === sample.matchId;
    return sameFixture && canonicalMarket(result.market) === canonicalMarket(sample.market);
  }) ?? null;
}

/**
 * Turns raw sample rows (one per observation) into replayable units:
 * { sampleId, market, selection, line, quotes, inputs, commenceTime,
 *   settlement } — quotes/inputs from the LAST pre-kick observation that had
 * buyable quotes, settlement from the known result.
 */
export function buildReplayUnits(sampleRows, results) {
  const bySample = new Map();
  for (const row of sampleRows) {
    const entry = bySample.get(row.id) ?? {
      id: row.id,
      fixtureId: row.fixtureId ?? row.fixture_id ?? null,
      matchId: row.matchId ?? row.match_id ?? null,
      market: row.market,
      selection: row.selection ?? row.prediction,
      line: Number.isFinite(row.line) ? row.line : undefined,
      commenceTime: iso(row.commenceTime ?? row.commence_time),
      observations: [],
    };
    if (row.buyableQuotes ?? row.buyable_quotes) {
      entry.observations.push({
        firstEvaluatedAt: iso(row.firstEvaluatedAt ?? row.first_evaluated_at),
        lastEvaluatedAt: iso(row.lastEvaluatedAt ?? row.last_evaluated_at),
        inputs: row.inputs ?? [],
        buyableQuotes: row.buyableQuotes ?? row.buyable_quotes ?? [],
      });
    }
    bySample.set(row.id, entry);
  }

  const units = [];
  for (const sample of bySample.values()) {
    const kickoff = Date.parse(sample.commenceTime ?? "");
    const priced = sample.observations
      .filter((observation) => observation.buyableQuotes.length > 0)
      .filter((observation) => {
        const evaluated = Date.parse(observation.lastEvaluatedAt ?? "");
        return !Number.isFinite(kickoff) || (Number.isFinite(evaluated) && evaluated < kickoff);
      })
      .sort((a, b) => Date.parse(a.lastEvaluatedAt) - Date.parse(b.lastEvaluatedAt));
    if (priced.length === 0) continue;
    const last = priced[priced.length - 1];
    const result = resultForSample(results, sample);
    const settlement = result
      ? settleAgainstActual({ market: sample.market, selection: sample.selection, line: sample.line }, result.actual)
      : null;
    if (!SETTLED.has(settlement)) continue;
    units.push({
      sampleId: sample.id,
      fixtureId: sample.fixtureId,
      market: canonicalMarket(sample.market),
      selection: sample.selection,
      line: sample.line,
      commenceTime: sample.commenceTime,
      quotes: last.buyableQuotes,
      inputs: last.inputs,
      settlement,
    });
  }
  return units;
}

// ---------- replay ----------

function profitRange(unit, quotes) {
  const profits = quotes.map((quote) => settlementProfit(unit.settlement, quote.odds));
  return { lower: Math.min(...profits), upper: Math.max(...profits) };
}

export function replayConfig(units, config) {
  let kept = 0;
  let blocked = 0;
  let keptQuotes = 0;
  let blockedQuotes = 0;
  let keptLower = 0;
  let keptUpper = 0;
  let blockedLower = 0;
  let blockedUpper = 0;
  const reasonCounts = {};
  const blockedDetail = [];

  for (const unit of units) {
    const opportunity = {
      fixtureId: unit.fixtureId,
      market: unit.market,
      selection: unit.selection,
      ...(Number.isFinite(unit.line) ? { line: unit.line } : {}),
      quotes: unit.quotes,
    };
    const { quotes, rejected } = gateOpportunityQuotes(
      opportunity,
      gateContextRows(unit.inputs, opportunity),
      config,
    );
    keptQuotes += quotes.length;
    blockedQuotes += rejected.length;
    for (const { reasons } of rejected) {
      for (const reason of reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    }
    if (quotes.length === 0) {
      blocked += 1;
      const range = profitRange(unit, unit.quotes);
      blockedLower += range.lower;
      blockedUpper += range.upper;
      blockedDetail.push({ sampleId: unit.sampleId, market: unit.market, selection: unit.selection, line: unit.line ?? null, reasons: [...new Set(rejected.flatMap((r) => r.reasons))] });
    } else {
      kept += 1;
      const range = profitRange(unit, quotes);
      keptLower += range.lower;
      keptUpper += range.upper;
    }
  }

  return { kept, blocked, keptQuotes, blockedQuotes, keptLower, keptUpper, blockedLower, blockedUpper, reasonCounts, blockedDetail };
}

export function replayGrid(units) {
  const baseline = replayConfig(units, nullConfig());
  const totalLoss = Math.min(baseline.keptLower, 0);
  const totalGain = Math.max(baseline.keptUpper, 0);

  const rows = [...parameterGrid()].map(({ label, config }) => {
    const outcome = replayConfig(units, config);
    return {
      label,
      kept: outcome.kept,
      blocked: outcome.blocked,
      keptRoiLower: outcome.kept > 0 ? outcome.keptLower / outcome.kept : null,
      keptRoiUpper: outcome.kept > 0 ? outcome.keptUpper / outcome.kept : null,
      blockedProfitLower: outcome.blockedLower,
      blockedProfitUpper: outcome.blockedUpper,
      // 理想閘門:大比例擋虧損、細比例誤擋盈利。
      lossBlockedPct: totalLoss < 0 ? Math.max(0, -outcome.blockedUpper) / -totalLoss : null,
      gainBlockedPct: totalGain > 0 ? Math.max(0, outcome.blockedLower) / totalGain : null,
    };
  }).sort((a, b) =>
    (b.lossBlockedPct ?? 0) - (a.lossBlockedPct ?? 0)
    || (a.gainBlockedPct ?? 0) - (b.gainBlockedPct ?? 0));

  const shipped = replayConfig(units, QUOTE_GATE_CONFIG);
  return { baseline, totalLoss, totalGain, rows, shipped, shippedVersion: QUOTE_GATE_CONFIG_VERSION };
}

// 無閘門 = 全部旋鈕關晒。
function nullConfig() {
  return {
    ...QUOTE_GATE_CONFIG,
    maxOdds: {},
    maxEdge: Number.POSITIVE_INFINITY,
    maxSharpEdge: Number.POSITIVE_INFINITY,
    maxRelativeStalenessMs: Number.POSITIVE_INFINITY,
    enforceLineMonotonicity: false,
  };
}

// ---------- report ----------

function pct(value) {
  return value === null ? "  n/a" : `${(value * 100).toFixed(1).padStart(5)}%`;
}

export function formatReplay(report, units) {
  const lines = [];
  const corners = units.filter((unit) => unit.market === "corners");
  lines.push(`Quote-gate replay — ${units.length} settled recommendations (${corners.length} corners)`);
  lines.push("");
  lines.push(`無閘門基線: kept=${report.baseline.kept} profit=[${report.baseline.keptLower.toFixed(2)}, ${report.baseline.keptUpper.toFixed(2)}] roi=[${(report.baseline.keptLower / report.baseline.kept * 100).toFixed(1)}%, ${(report.baseline.keptUpper / report.baseline.kept * 100).toFixed(1)}%]`);
  lines.push(`總虧損(下限口徑)= ${report.totalLoss.toFixed(2)}u · 總盈利(上限口徑)= +${report.totalGain.toFixed(2)}u`);
  lines.push("");
  lines.push(`現行配置 ${report.shippedVersion}: 擋 ${report.shipped.blocked}/${units.length} 個推薦、${report.shipped.blockedQuotes} 個報價`);
  lines.push(`  被擋推薦嘅虧損區間: [${report.shipped.blockedLower.toFixed(2)}, ${report.shipped.blockedUpper.toFixed(2)}]u`);
  lines.push(`  保留推薦嘅 ROI 區間: [${(report.shipped.keptLower / Math.max(report.shipped.kept, 1) * 100).toFixed(1)}%, ${(report.shipped.keptUpper / Math.max(report.shipped.kept, 1) * 100).toFixed(1)}%] (n=${report.shipped.kept})`);
  const reasons = Object.entries(report.shipped.reasonCounts).sort((a, b) => b[1] - a[1]);
  if (reasons.length > 0) lines.push(`  擋截原因: ${reasons.map(([reason, count]) => `${reason}×${count}`).join("  ")}`);
  lines.push("");
  lines.push("參數 grid(按擋虧損排序,頭 15):");
  lines.push("config                                          kept  blocked  keptROI        擋虧損   誤擋盈利");
  for (const row of report.rows.slice(0, 15)) {
    lines.push(`${row.label.padEnd(46)} ${String(row.kept).padStart(4)} ${String(row.blocked).padStart(8)}  ${pct(row.keptRoiLower)}..${pct(row.keptRoiUpper)}  ${pct(row.lossBlockedPct)}  ${pct(row.gainBlockedPct)}`);
  }
  return lines.join("\n");
}

// ---------- database mode (read-only) ----------

async function loadFromDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("--database mode requires DATABASE_URL");
  const { createPool } = await import("../server/db/pool.mjs");
  const pool = createPool(databaseUrl);
  try {
    const sampleResult = await pool.query(`
      SELECT s.id, s.fixture_id, s.match_id, s.market, s.prediction, s.line,
             COALESCE(f.commence_time, s.commence_time) AS commence_time,
             o.inputs, o.buyable_quotes, o.first_evaluated_at, o.last_evaluated_at
      FROM prediction_snapshots AS s
      LEFT JOIN fixtures AS f ON f.id = s.fixture_id
      LEFT JOIN recommendation_observations AS o ON o.snapshot_id = s.id
      WHERE s.strategy_version = $1
      ORDER BY s.id, o.first_evaluated_at
    `, [UNIFIED_STRATEGY]);
    const resultRows = await pool.query("SELECT raw FROM results");
    return {
      samples: sampleResult.rows,
      results: resultRows.rows.map(({ raw }) => raw),
    };
  } finally {
    await pool.end();
  }
}

function iso(value) {
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

// ---------- self-test ----------

function selfTest() {
  const kickoff = "2026-08-24T15:00:00.000Z";
  const sharp = [
    { fixtureId: "fx-a", market: "corners", selection: "over", line: 9.5, odds: 1.9, bookmaker: "Pinnacle", provider: "hdc", observedAt: "2026-08-24T14:00:00.000Z" },
    { fixtureId: "fx-a", market: "corners", selection: "under", line: 9.5, odds: 1.9, bookmaker: "Pinnacle", provider: "hdc", observedAt: "2026-08-24T14:00:00.000Z" },
    { fixtureId: "fx-a", market: "corners", selection: "over", line: 9.5, odds: 1.9, bookmaker: "Bet365", provider: "hdc", observedAt: "2026-08-24T14:00:00.000Z" },
    { fixtureId: "fx-a", market: "corners", selection: "under", line: 9.5, odds: 1.9, bookmaker: "Bet365", provider: "hdc", observedAt: "2026-08-24T14:00:00.000Z" },
  ];
  const trapQuote = { bookmaker: "Superbet", provider: "hdc", odds: 12, chance: 0.4, edge: 3.8, observedAt: "2026-08-24T13:00:00.000Z" };
  const fairQuote = { bookmaker: "Betway", provider: "hdc", odds: 2.05, chance: 0.5, edge: 0.025, observedAt: "2026-08-24T14:00:00.000Z" };
  const rows = [
    // 陷阱樣本:12 倍錯價,實際輸。
    { id: 1, fixtureId: "fx-a", matchId: "m-a", market: "corners", selection: "over", line: 9.5, commenceTime: kickoff, inputs: sharp, buyableQuotes: [trapQuote], firstEvaluatedAt: "2026-08-24T14:00:00.000Z", lastEvaluatedAt: "2026-08-24T14:05:00.000Z" },
    // 合理樣本:fair quote,實際贏。
    { id: 2, fixtureId: "fx-a", matchId: "m-a", market: "corners", selection: "under", line: 9.5, commenceTime: kickoff, inputs: sharp, buyableQuotes: [fairQuote], firstEvaluatedAt: "2026-08-24T14:00:00.000Z", lastEvaluatedAt: "2026-08-24T14:05:00.000Z" },
  ];
  const results = [
    { fixtureId: "fx-a", matchId: "m-a", market: "角球", actual: "8 角球" },
  ];
  const units = buildReplayUnits(rows, results);
  if (units.length !== 2) throw new Error(`expected 2 replay units, got ${units.length}`);
  const report = replayGrid(units);
  // 現行配置必須擋到 12 倍陷阱,保留 2.05 合理報價。
  if (report.shipped.blocked !== 1 || report.shipped.kept !== 1) {
    throw new Error(`shipped config expected blocked=1 kept=1, got ${JSON.stringify({ blocked: report.shipped.blocked, kept: report.shipped.kept })}`);
  }
  // 無閘門基線 ROI 係負(陷阱 -1 + 合理 +1.05 → 淨 +0.05/2…實際贏咗,改用
  // lossBlockedPct 檢查):被擋嘅係輸錢嗰注。
  if (report.shipped.blockedUpper >= 0) throw new Error("the blocked sample must be the losing trap");
  console.log("[replay-quote-gate] self-test passed");
}

// ---------- main ----------

function parseArgs(argv) {
  const options = { database: false, selfTest: false, json: false, market: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--database") options.database = true;
    else if (arg === "--self-test") options.selfTest = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--market") options.market = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    selfTest();
    return;
  }
  if (!options.database) {
    throw new Error("replay-quote-gate reads PostgreSQL only — pass --database (DATABASE_URL required), or --self-test");
  }
  const { samples, results } = await loadFromDatabase();
  let units = buildReplayUnits(samples, results);
  if (options.market) units = units.filter((unit) => unit.market === options.market);
  const report = replayGrid(units);
  console.log(options.json
    ? JSON.stringify({ units: units.length, ...report, blockedDetail: report.shipped.blockedDetail }, null, 2)
    : formatReplay(report, units));
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
