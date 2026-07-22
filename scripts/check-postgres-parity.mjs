import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPool } from "../server/db/pool.mjs";
import { createResultRepository } from "../server/db/result-repository.mjs";
import { createSnapshotRepository } from "../server/db/snapshot-repository.mjs";
import { buildBacktest } from "../server/domain/backtest.mjs";
import { resultIdentity, snapshotIdentity } from "../server/domain/identity.mjs";
import { classifySnapshot } from "../shared/snapshot-policy.mjs";
import { classifyImportedRow, IMPORTER_VERSION, loadLegacySources, parseJsonl } from "./import-legacy-to-postgres.mjs";

export async function checkPostgresParity({ pool, sourceRoot, importerVersion = IMPORTER_VERSION, now = Date.now() }) {
  const sources = (await loadLegacySources(path.resolve(sourceRoot))).map((source) => ({ ...source, rows: parseJsonl(source.bytes, source.sourceName) }));
  const runs = [];
  for (const source of sources) {
    const result = await pool.query(`
      SELECT id, status, total_rows, accepted_rows, rejected_rows
      FROM import_runs
      WHERE source_name = $1 AND source_sha256 = $2 AND importer_version = $3
    `, [source.sourceName, source.sourceSha256, importerVersion]);
    parityEqual(result.rowCount, 1, "source run count");
    parityEqual(result.rows[0].status, "complete", "source run status");
    parityEqual(result.rows[0].total_rows, source.rows.length, "source row count");
    const classes = source.rows.map((row) => classifyImportedRow(row, source));
    parityEqual(result.rows[0].accepted_rows, classes.filter((row) => row.classification !== "invalid").length, "accepted row count");
    parityEqual(result.rows[0].rejected_rows, classes.filter((row) => row.classification === "invalid").length, "rejected row count");
    runs.push({ ...source, runId: result.rows[0].id });
  }

  const dbAudit = [];
  for (const run of runs) {
    const result = await pool.query(`
      SELECT source_row, idempotency_key, classification, rejection_reason, record_kind, raw
      FROM import_rows
      WHERE import_run_id = $1
      ORDER BY source_row
    `, [run.runId]);
    parityEqual(result.rowCount, run.rows.length, "audit row count");
    dbAudit.push(...result.rows.map((row) => ({ ...row, sourceName: run.sourceName })));
  }

  const expectedAudit = sources.flatMap((source) => source.rows.map(({ sourceRow, raw }) => {
    const classified = classifyImportedRow({ sourceRow, raw }, source);
    return {
      sourceName: source.sourceName,
      source_row: sourceRow,
      idempotency_key: classified.idempotencyKey,
      classification: classified.classification,
      rejection_reason: classified.rejectionReason,
      record_kind: source.recordKind,
      raw,
    };
  }));
  parityDeepEqual(dbAudit, expectedAudit, "audit classifications and identities");

  const fileSnapshots = expectedAudit.filter(({ record_kind }) => record_kind === "snapshot").map(({ raw }) => raw);
  const snapshotAudit = expectedAudit.filter(({ record_kind }) => record_kind === "snapshot");
  const resultAudit = expectedAudit.filter(({ record_kind }) => record_kind === "result");
  const auditSnapshots = dbAudit.filter(({ record_kind }) => record_kind === "snapshot").map(({ raw }) => raw);
  const fileResultRows = expectedAudit.filter(({ record_kind, classification }) => record_kind === "result" && classification !== "invalid").map(({ raw }) => raw);
  const expectedResults = prioritizeResults(fileResultRows);
  const dbSnapshots = (await createSnapshotRepository(pool).listAll()).filter(isLegacySnapshot);
  const dbCurrent = (await createSnapshotRepository(pool).listCurrent()).filter(isLegacySnapshot);
  const dbResults = await createResultRepository(pool).listAll();
  const acceptedSnapshots = fileSnapshots.filter((row) => classifySnapshot(row).status !== "invalid");
  const currentSnapshots = fileSnapshots.filter((row) => classifySnapshot(row).status === "valid-current");
  const acceptedSnapshotsWithStrategy = acceptedSnapshots.map(withLegacyStrategy);
  const currentSnapshotsWithStrategy = currentSnapshots.map(withLegacyStrategy);
  const orderedExpectedResults = orderByIdentity(expectedResults, resultIdentity);
  const orderedDbResults = orderByIdentity(dbResults, resultIdentity);

  parityDeepEqual(sortedIdentities(dbSnapshots, snapshotIdentity), sortedIdentities(acceptedSnapshotsWithStrategy, snapshotIdentity), "snapshot identity set");
  parityDeepEqual(
    domainRepresentatives(dbSnapshots, snapshotIdentity),
    domainRepresentatives(acceptedSnapshotsWithStrategy, snapshotIdentity),
    "snapshot domain representatives",
  );
  parityDeepEqual(sortedIdentities(dbResults, resultIdentity), sortedIdentities(expectedResults, resultIdentity), "result identity set");
  parityDeepEqual(orderedDbResults, orderedExpectedResults, "result priority representatives");

  const fileBacktest = buildBacktest(fileSnapshots, orderedExpectedResults, now);
  const dbBacktest = buildBacktest(auditSnapshots, orderedDbResults, now);
  parityDeepEqual(dbBacktest.snapshotQuality, fileBacktest.snapshotQuality, "snapshot quality");
  parityDeepEqual(dbBacktest.summary, fileBacktest.summary, "backtest summary");
  parityDeepEqual(dbBacktest.byMarket, fileBacktest.byMarket, "market summaries");
  parityDeepEqual(dbBacktest.buckets, fileBacktest.buckets, "chance buckets");
  parityDeepEqual(dbBacktest.rows, fileBacktest.rows, "representative backtest rows");
  parityDeepEqual(dbBacktest.readiness, fileBacktest.readiness, "audit readiness");
  parityDeepEqual(
    buildBacktest(orderByIdentity(dbCurrent, snapshotIdentity), orderedDbResults, now).readiness,
    buildBacktest(orderByIdentity(currentSnapshotsWithStrategy, snapshotIdentity), orderedExpectedResults, now).readiness,
    "repository current readiness",
  );
  parityEqual(new Set(dbBacktest.rows.map(({ matchId }) => matchId)).size, new Set(fileBacktest.rows.map(({ matchId }) => matchId)).size, "distinct matches");

  const strategyCounts = await pool.query(`
    SELECT count(*)::int AS strategy_rows,
           count(*) FILTER (WHERE strategy_version IS NULL)::int AS legacy_strategy_rows,
           count(*) FILTER (WHERE strategy_version = 'unified-buyable-v1')::int AS unified_strategy_rows
    FROM prediction_snapshots
    WHERE snapshot_status IN ('valid-current', 'legacy')
  `);
  const observationCount = await pool.query("SELECT count(*)::int AS observation_rows FROM recommendation_observations");

  return {
    status: "ok",
    snapshotRows: fileSnapshots.length,
    resultRows: resultAudit.length,
    resultRejected: resultAudit.filter(({ classification }) => classification === "invalid").length,
    snapshotValidCurrent: snapshotAudit.filter(({ classification }) => classification === "valid-current").length,
    snapshotLegacy: snapshotAudit.filter(({ classification }) => classification === "legacy").length,
    snapshotInvalid: snapshotAudit.filter(({ classification }) => classification === "invalid").length,
    distinctMatches: new Set(fileBacktest.rows.map(({ matchId }) => matchId)).size,
    settlements: fileBacktest.summary.finished,
    strategyRows: strategyCounts.rows[0].strategy_rows,
    legacyStrategyRows: strategyCounts.rows[0].legacy_strategy_rows,
    unifiedStrategyRows: strategyCounts.rows[0].unified_strategy_rows,
    observationRows: observationCount.rows[0].observation_rows,
    sourceHashes: Object.fromEntries(sources.map(({ sourceName, sourceSha256 }) => [sourceName, sourceSha256])),
  };
}

function withLegacyStrategy(row) {
  return { ...row, strategyVersion: row.strategyVersion ?? "legacy-v0" };
}

function isLegacySnapshot(row) {
  return (row.strategyVersion ?? "legacy-v0") === "legacy-v0";
}

function prioritizeResults(rows) {
  const selected = new Map();
  for (const row of rows) {
    const key = resultIdentity(row);
    const current = selected.get(key);
    if (!current || (row.sourcePriority ?? 0) > (current.sourcePriority ?? 0)) selected.set(key, row);
  }
  return [...selected.values()];
}


function sortedIdentities(rows, identity) {
  return [...new Set(rows.map(identity))].sort();
}

function orderByIdentity(rows, identity) {
  return [...rows].sort((left, right) => identity(left).localeCompare(identity(right)));
}

function domainRepresentatives(rows, identity) {
  const selected = new Map();
  for (const row of rows) {
    const key = identity(row);
    if (!selected.has(key)) selected.set(key, row);
  }
  return [...selected].sort(([left], [right]) => left.localeCompare(right));
}

function parityEqual(actual, expected, label) {
  try {
    assert.equal(actual, expected);
  } catch {
    throw new Error(`parity mismatch: ${label}`);
  }
}

function parityDeepEqual(actual, expected, label) {
  try {
    assert.deepEqual(actual, expected);
  } catch {
    throw new Error(`parity mismatch: ${label}`);
  }
}

function parseSourceRoot(argv) {
  const index = argv.indexOf("--source-root");
  if (index < 0 || !argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error("--source-root is required");
  return argv[index + 1];
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = createPool(databaseUrl);
  try {
    const result = await checkPostgresParity({ pool, sourceRoot: parseSourceRoot(process.argv.slice(2)) });
    let index = 0;
    for (const hash of Object.values(result.sourceHashes)) console.log(`file${++index}Hash=${hash}`);
    for (const [name, value] of Object.entries(result)) {
      if (name !== "sourceHashes") console.log(`${name}=${value}`);
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error("status=failed");
    process.exitCode = 1;
  });
}
