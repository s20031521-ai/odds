#!/usr/bin/env node
// Phase 0 shadow-evidence monitor (docs/research/PHASE-0-shadow-evidence-ops-
// baseline-2026-08-24.md §3.3). Read-only weekly health check answering:
//   1. Is every shadow line still accumulating NEW observations?
//   2. How many fixtures per league got fresh evidence this window
//      (target: >= weeklyTarget per active league)?
//   3. dc fit coverage: what share of supported-league fixtures evaluated by
//      the unified strategy also produced dc-family shadow rows?
//      (low coverage = fixture-alias / team-history gaps)
//   4. HDC quota state: remaining credits, reserve blocks, key rotation.
//
// Usage:
//   node scripts/shadow-evidence-report.mjs --database [--days 7] [--target 10] [--json]
// --database requires DATABASE_URL (read-only queries only). Against
// production, run inside the api container, e.g.:
//   sudo docker exec odds-tool-api-1 sh -c \
//     'DATABASE_URL="postgres://odds_app:$(cat /run/secrets/pg_app_password)@postgres:5432/odds" \
//      node scripts/shadow-evidence-report.mjs --database'
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { leagueCodeFromName } from "./lib/dc-shadow.mjs";

export const UNIFIED_STRATEGY = "unified-buyable-v1";
export const DC_FAMILY_STRATEGIES = ["dc-shadow-v1", "dc-blend-v1", "dc-xg-shadow-v1"];
export const SHARP_STRATEGY = "market-sharp-v1";
export const TRACKED_STRATEGIES = [
  UNIFIED_STRATEGY,
  ...DC_FAMILY_STRATEGIES,
  SHARP_STRATEGY,
];

const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_WEEKLY_TARGET = 10;
const COLLECTOR_STALE_MS = 6 * 60 * 60 * 1000;
const COVERAGE_WARN_PCT = 80;

// PostgreSQL rows arrive as Date instances; normalize every timestamp the
// same way check-data-integrity.mjs does.
function timeMs(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function iso(value) {
  const ms = timeMs(value);
  return ms === null ? null : new Date(ms).toISOString();
}

function fixtureKeyOf(snapshot) {
  return snapshot.fixtureId ?? snapshot.identityKey ?? `snapshot:${snapshot.id}`;
}

function emptyStrategyBucket(strategyVersion) {
  return {
    strategyVersion,
    snapshotsTotal: 0,
    snapshotsNew: 0,
    observationsTotal: 0,
    observationsNew: 0,
    fixturesNew: 0,
    leagues: {},
  };
}

export function analyzeShadowEvidence({ snapshots, observations, collectorStates = [], now, windowDays = DEFAULT_WINDOW_DAYS, weeklyTarget = DEFAULT_WEEKLY_TARGET }) {
  const nowMs = timeMs(now);
  if (nowMs === null) throw new TypeError("now must be a valid timestamp");
  const windowStartMs = nowMs - windowDays * 24 * 60 * 60 * 1000;

  const snapshotById = new Map();
  const buckets = new Map(TRACKED_STRATEGIES.map((version) => [version, emptyStrategyBucket(version)]));
  const newObservationCountBySnapshot = new Map();

  for (const raw of snapshots ?? []) {
    // pg returns snake_case column names; accept both casings.
    const strategyVersion = raw.strategyVersion ?? raw.strategy_version;
    const bucket = buckets.get(strategyVersion);
    if (!bucket) continue;
    const snapshot = {
      id: raw.id,
      identityKey: raw.identityKey ?? raw.identity_key ?? null,
      fixtureId: raw.fixtureId ?? raw.fixture_id ?? null,
      league: raw.league ?? null,
      firstQualifiedMs: timeMs(raw.firstQualifiedAt ?? raw.first_qualified_at),
    };
    snapshotById.set(snapshot.id, { ...snapshot, strategyVersion });
    bucket.snapshotsTotal += 1;
    if (snapshot.firstQualifiedMs !== null && snapshot.firstQualifiedMs >= windowStartMs) {
      bucket.snapshotsNew += 1;
    }
  }

  for (const raw of observations ?? []) {
    const snapshotId = raw.snapshotId ?? raw.snapshot_id;
    const snapshot = snapshotById.get(snapshotId);
    if (!snapshot) continue;
    const bucket = buckets.get(snapshot.strategyVersion);
    bucket.observationsTotal += 1;
    const firstMs = timeMs(raw.firstEvaluatedAt ?? raw.first_evaluated_at);
    if (firstMs !== null && firstMs >= windowStartMs) {
      bucket.observationsNew += 1;
      newObservationCountBySnapshot.set(snapshotId, (newObservationCountBySnapshot.get(snapshotId) ?? 0) + 1);
    }
  }

  // Fixtures with fresh evidence, per strategy and per league.
  for (const bucket of buckets.values()) {
    const fixtures = new Set();
    const leagueFixtures = new Map();
    for (const [snapshotId] of newObservationCountBySnapshot) {
      const snapshot = snapshotById.get(snapshotId);
      if (!snapshot || snapshot.strategyVersion !== bucket.strategyVersion) continue;
      const key = fixtureKeyOf(snapshot);
      fixtures.add(key);
      const code = leagueCodeFromName(snapshot.league) ?? "other";
      if (!leagueFixtures.has(code)) leagueFixtures.set(code, new Set());
      leagueFixtures.get(code).add(key);
    }
    bucket.fixturesNew = fixtures.size;
    for (const [code, keys] of [...leagueFixtures.entries()].sort()) {
      bucket.leagues[code] = { fixtures: keys.size };
    }
  }

  // dc fit coverage: supported-league fixtures the unified strategy evaluated
  // in-window vs. how many of them any dc-family shadow also covered.
  const unified = buckets.get(UNIFIED_STRATEGY);
  const unifiedSupported = new Map();
  for (const snapshot of snapshotById.values()) {
    if (snapshot.strategyVersion !== UNIFIED_STRATEGY) continue;
    if (snapshot.firstQualifiedMs === null || snapshot.firstQualifiedMs < windowStartMs) continue;
    const code = leagueCodeFromName(snapshot.league);
    if (!code) continue;
    unifiedSupported.set(fixtureKeyOf(snapshot), code);
  }
  const dcCovered = new Set();
  const sharpCovered = new Set();
  for (const snapshot of snapshotById.values()) {
    const key = fixtureKeyOf(snapshot);
    if (!unifiedSupported.has(key)) continue;
    if (DC_FAMILY_STRATEGIES.includes(snapshot.strategyVersion)) dcCovered.add(key);
    if (snapshot.strategyVersion === SHARP_STRATEGY) sharpCovered.add(key);
  }
  const denominator = unifiedSupported.size;
  const coverage = {
    windowDays,
    supportedFixtures: denominator,
    dcCovered: dcCovered.size,
    dcCoveragePct: denominator === 0 ? null : Math.round((dcCovered.size / denominator) * 1000) / 10,
    sharpCovered: sharpCovered.size,
    sharpCoveragePct: denominator === 0 ? null : Math.round((sharpCovered.size / denominator) * 1000) / 10,
  };

  const collector = (collectorStates ?? []).map((row) => {
    const state = row.state ?? {};
    const updatedMs = timeMs(row.updatedAt ?? row.updated_at);
    return {
      stateKey: row.stateKey ?? row.state_key,
      quotaRemaining: state.quotaRemaining ?? null,
      quotaUsed: state.quotaUsed ?? null,
      quotaMinimum: state.quotaMinimum ?? null,
      paidCollectionBlocked: state.paidCollectionBlocked === true,
      paidCollectionBlockedReason: state.paidCollectionBlockedReason ?? null,
      keyRotation: state.keyRotation ?? null,
      updatedAt: iso(row.updatedAt ?? row.updated_at),
      ageMinutes: updatedMs === null ? null : Math.round((nowMs - updatedMs) / 60000),
    };
  });

  const warnings = [];
  const unifiedActiveLeagues = new Set(unifiedSupported.values());
  for (const version of [...DC_FAMILY_STRATEGIES, SHARP_STRATEGY]) {
    const bucket = buckets.get(version);
    if (bucket.observationsNew === 0 && unified.snapshotsNew > 0) {
      warnings.push(`${version}: no new observations in ${windowDays}d while unified-buyable-v1 recorded ${unified.snapshotsNew} new snapshots — shadow line stalled?`);
    }
    for (const code of unifiedActiveLeagues) {
      const fixtures = bucket.leagues[code]?.fixtures ?? 0;
      if (fixtures < weeklyTarget) {
        warnings.push(`${version}: ${code} has ${fixtures} fixtures with fresh evidence (target >= ${weeklyTarget}/week)`);
      }
    }
  }
  if (denominator > 0 && coverage.dcCoveragePct !== null && coverage.dcCoveragePct < COVERAGE_WARN_PCT) {
    warnings.push(`dc fit coverage ${coverage.dcCoveragePct}% < ${COVERAGE_WARN_PCT}% — check fixture aliases / team_match_history gaps`);
  }
  for (const entry of collector) {
    if (entry.quotaRemaining !== null && entry.quotaMinimum !== null && entry.quotaRemaining <= entry.quotaMinimum) {
      warnings.push(`${entry.stateKey}: quotaRemaining ${entry.quotaRemaining} at/below reserve floor ${entry.quotaMinimum}`);
    }
    if (entry.paidCollectionBlocked) {
      warnings.push(`${entry.stateKey}: paid collection blocked (${entry.paidCollectionBlockedReason ?? "unknown reason"})`);
    }
    if (entry.ageMinutes !== null && entry.ageMinutes * 60000 > COLLECTOR_STALE_MS) {
      warnings.push(`${entry.stateKey}: collector state stale — last update ${Math.round(entry.ageMinutes / 60)}h ago`);
    }
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    windowDays,
    weeklyTarget,
    windowStart: new Date(windowStartMs).toISOString(),
    strategies: TRACKED_STRATEGIES.map((version) => buckets.get(version)),
    coverage,
    collector,
    warnings,
  };
}

export function formatReport(report) {
  const lines = [];
  lines.push(`Shadow evidence report — generated ${report.generatedAt}`);
  lines.push(`Window: last ${report.windowDays} days (since ${report.windowStart}), target >= ${report.weeklyTarget} fixtures/league/week`);
  lines.push("");
  lines.push("strategy            snapshots(new)  observations(new)  fixtures(new)  leagues(fixtures)");
  for (const bucket of report.strategies) {
    const leagues = Object.entries(bucket.leagues)
      .map(([code, entry]) => `${code}:${entry.fixtures}`)
      .join(" ") || "-";
    lines.push(
      `${bucket.strategyVersion.padEnd(19)} ${String(`${bucket.snapshotsTotal}(${bucket.snapshotsNew})`).padStart(15)} ${String(`${bucket.observationsTotal}(${bucket.observationsNew})`).padStart(18)} ${String(bucket.fixturesNew).padStart(14)}  ${leagues}`,
    );
  }
  lines.push("");
  const coverage = report.coverage;
  if (coverage.supportedFixtures === 0) {
    lines.push("dc fit coverage: no supported-league fixtures evaluated in-window (off-season or collector idle)");
  } else {
    lines.push(`dc fit coverage: ${coverage.dcCovered}/${coverage.supportedFixtures} fixtures (${coverage.dcCoveragePct}%)  |  market-sharp: ${coverage.sharpCovered}/${coverage.supportedFixtures} (${coverage.sharpCoveragePct}%)`);
  }
  lines.push("");
  if (report.collector.length === 0) {
    lines.push("collector_state: no rows");
  }
  for (const entry of report.collector) {
    const rotation = entry.keyRotation ? ` keyRotation(week=${entry.keyRotation.week},offset=${entry.keyRotation.offset})` : "";
    const blocked = entry.paidCollectionBlocked ? ` BLOCKED(${entry.paidCollectionBlockedReason ?? "?"})` : "";
    lines.push(`collector ${entry.stateKey}: quotaRemaining=${entry.quotaRemaining ?? "?"} quotaUsed=${entry.quotaUsed ?? "?"} min=${entry.quotaMinimum ?? "?"} updated=${entry.updatedAt ?? "?"}${rotation}${blocked}`);
  }
  lines.push("");
  if (report.warnings.length === 0) {
    lines.push("VERDICT: OK — no warnings");
  } else {
    lines.push(`VERDICT: ${report.warnings.length} warning(s)`);
    for (const warning of report.warnings) lines.push(`  WARN ${warning}`);
  }
  return lines.join("\n");
}

function parseArgs(argv) {
  const options = { database: false, json: false, days: DEFAULT_WINDOW_DAYS, target: DEFAULT_WEEKLY_TARGET };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--database") options.database = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--days") options.days = Number(argv[++index]);
    else if (arg === "--target") options.target = Number(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isFinite(options.days) || options.days <= 0) throw new Error("--days must be a positive number");
  if (!Number.isFinite(options.target) || options.target <= 0) throw new Error("--target must be a positive number");
  return options;
}

async function runDatabaseMode(options) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("--database mode requires DATABASE_URL");
  const { createPool } = await import("../server/db/pool.mjs");
  const pool = createPool(databaseUrl);
  try {
    // Strictly read-only: three SELECTs, no writes, no migrations.
    const snapshotResult = await pool.query(`
      SELECT s.id, s.identity_key, s.strategy_version, s.fixture_id,
             s.first_qualified_at,
             COALESCE(f.league, s.raw->>'league') AS league
      FROM prediction_snapshots AS s
      LEFT JOIN fixtures AS f ON f.id = s.fixture_id
      WHERE s.strategy_version = ANY($1::text[])
    `, [TRACKED_STRATEGIES]);
    const observationResult = await pool.query(`
      SELECT o.id, o.snapshot_id, o.first_evaluated_at, o.last_evaluated_at
      FROM recommendation_observations AS o
      JOIN prediction_snapshots AS s ON s.id = o.snapshot_id
      WHERE s.strategy_version = ANY($1::text[])
    `, [TRACKED_STRATEGIES]);
    const stateResult = await pool.query(
      "SELECT state_key, state, updated_at FROM collector_state ORDER BY state_key",
    );
    const report = analyzeShadowEvidence({
      snapshots: snapshotResult.rows,
      observations: observationResult.rows,
      collectorStates: stateResult.rows,
      now: new Date().toISOString(),
      windowDays: options.days,
      weeklyTarget: options.target,
    });
    console.log(options.json ? JSON.stringify(report, null, 2) : formatReport(report));
    if (report.warnings.length > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.database) {
    throw new Error("shadow-evidence-report reads PostgreSQL only — pass --database (DATABASE_URL required)");
  }
  await runDatabaseMode(options);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await main();
}
