#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  BUY_EDGE_THRESHOLD,
  UNIFIED_STRATEGY_VERSION,
  canonicalBookmaker,
  evaluateUnifiedOdds,
  observationFingerprint,
} from "../shared/unified-recommendations.mjs";
import { createPool } from "../server/db/pool.mjs";
import { createPostgresSink } from "./lib/postgres-sink.mjs";

const LOCK_NAME = "unified-buyable-sampler";
const MODEL_VERSIONS = {
  h2h: "consensus-v1",
  handicap: "hdc-loo-v2",
  totals: "totals-loo-v1",
  corners: "corner-loo-v1",
};
const MARKET_SELECTIONS = {
  h2h: ["home", "draw", "away"],
  handicap: ["home", "away"],
  totals: ["over", "under"],
  corners: ["over", "under"],
};

export async function runUnifiedSampler({ sink, now }) {
  assertSamplerSink(sink);
  const evaluatedAt = timestamp(now, "sampler now");
  return sink.acquireCollectorLock(LOCK_NAME, async () => {
    const liveRows = await sink.listLiveOdds(evaluatedAt);
    const resolvedFixtures = await sink.resolveFixtures(liveRows);
    const evaluation = createUnifiedEvaluation(liveRows, resolvedFixtures, evaluatedAt);
    await sink.recordRecommendationEvaluation(evaluation);
  });
}

export function createUnifiedEvaluation(liveRows, resolvedFixtures, now) {
  if (!Array.isArray(liveRows)) throw new TypeError("liveRows must be an array");
  const evaluatedAt = timestamp(now, "evaluation time");
  const fixtureRows = Array.isArray(resolvedFixtures)
    ? resolvedFixtures
    : resolvedFixtures?.fixtures;
  if (!Array.isArray(fixtureRows)) throw new TypeError("resolvedFixtures must contain a fixtures array");

  const evaluated = evaluateUnifiedOdds(fixtureRows, evaluatedAt);
  const byIdentity = new Map(evaluated.opportunities.map((opportunity) => [
    evaluationIdentity(opportunity),
    opportunity,
  ]));
  for (const empty of emptyOpportunityShells(evaluated.inputs)) {
    if (!byIdentity.has(evaluationIdentity(empty))) byIdentity.set(evaluationIdentity(empty), empty);
  }
  return {
    evaluatedAt,
    inputs: evaluated.inputs,
    opportunities: [...byIdentity.values()].sort(compareOpportunities),
  };
}

function emptyOpportunityShells(inputs) {
  const groups = new Map();
  for (const row of inputs) {
    const key = `${row.fixtureId}|${row.market}|${row.line ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const shells = [];
  for (const rows of groups.values()) {
    const first = rows[0];
    const selections = MARKET_SELECTIONS[first.market] ?? [];
    const modelVersion = MODEL_VERSIONS[first.market];
    if (!modelVersion) continue;
    const owner = rows.find(({ provider }) => provider === "hkjc") ?? first;
    for (const selection of selections) {
      shells.push({
        fixtureId: owner.fixtureId,
        ...(owner.matchId ? { matchId: owner.matchId } : {}),
        homeTeam: owner.homeTeam,
        awayTeam: owner.awayTeam,
        ...(owner.homeTeamZh ? { homeTeamZh: owner.homeTeamZh } : {}),
        ...(owner.awayTeamZh ? { awayTeamZh: owner.awayTeamZh } : {}),
        commenceTime: owner.commenceTime,
        ...(owner.league ? { league: owner.league } : {}),
        ...(owner.leagueZh ? { leagueZh: owner.leagueZh } : {}),
        strategyVersion: UNIFIED_STRATEGY_VERSION,
        modelVersion,
        market: owner.market,
        selection,
        ...(owner.market === "h2h" ? {} : { line: owner.line }),
        quotes: [],
      });
    }
  }
  return shells;
}

function evaluationIdentity(value) {
  return [
    value.fixtureId,
    value.market,
    value.selection,
    value.line ?? "",
    value.modelVersion,
    value.strategyVersion,
  ].join("|");
}

function compareOpportunities(left, right) {
  return Date.parse(left.commenceTime) - Date.parse(right.commenceTime)
    || String(left.fixtureId).localeCompare(String(right.fixtureId))
    || String(left.market).localeCompare(String(right.market))
    || (left.line ?? 0) - (right.line ?? 0)
    || String(left.selection).localeCompare(String(right.selection));
}

function assertSamplerSink(sink) {
  for (const method of ["acquireCollectorLock", "listLiveOdds", "resolveFixtures", "recordRecommendationEvaluation"]) {
    if (typeof sink?.[method] !== "function") throw new TypeError(`sampler sink requires ${method}()`);
  }
}

function timestamp(value, label) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} must be a valid timestamp`);
  return new Date(parsed).toISOString();
}

function selfTestQuote(bookmaker, selection, odds) {
  return {
    id: `${canonicalBookmaker(bookmaker)}-${selection}`,
    fixtureId: "11111111-1111-4111-8111-111111111111",
    matchId: "self-test-match",
    homeTeam: "Alpha",
    awayTeam: "Beta",
    commenceTime: "2026-07-18T12:00:00.000Z",
    provider: "self-test",
    bookmaker,
    market: "totals",
    selection,
    line: 2.5,
    odds,
    observedAt: "2026-07-18T10:00:00.000Z",
  };
}

function selfTest() {
  const rows = [
    selfTestQuote("Book A", "over", 2.3),
    selfTestQuote("Book A", "under", 1.65),
    selfTestQuote("Book B", "over", 2.3),
    selfTestQuote("Book B", "under", 1.65),
    selfTestQuote("Book C", "over", 1.5),
    selfTestQuote("Book C", "under", 2),
  ];
  const first = createUnifiedEvaluation(rows, { fixtures: rows }, "2026-07-18T10:05:00.000Z");
  const second = createUnifiedEvaluation(rows, { fixtures: rows }, "2026-07-18T10:10:00.000Z");
  const over = first.opportunities.find(({ selection, quotes }) => selection === "over" && quotes.length > 0);
  assert.ok(over);
  assert.equal(over.quotes.length, 2);
  assert.equal(over.quotes.every(({ edge }) => edge >= BUY_EDGE_THRESHOLD), true);
  const fingerprint = (evaluation) => observationFingerprint({
    inputs: evaluation.inputs,
    buyableQuotes: evaluation.opportunities.find(({ selection }) => selection === "over").quotes,
  });
  assert.equal(fingerprint(first), fingerprint(second));
  console.log("[unified-sampler] self-test passed");
}

async function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = createPool(process.env.DATABASE_URL);
  try {
    const status = await runUnifiedSampler({
      sink: createPostgresSink({ pool }),
      now: new Date().toISOString(),
    });
    console.log(`[unified-sampler] ${status}`);
  } finally {
    await pool.end();
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
