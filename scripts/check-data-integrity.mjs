import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifySnapshot } from "../shared/snapshot-policy.mjs";

const root = process.cwd();
const snapshotPath = path.join(root, "data", "prediction-snapshots.jsonl");
const resultPath = path.join(root, "data", "result-archive.jsonl");

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${path.relative(root, file)}:${index + 1} is not valid JSON: ${error.message}`);
      }
    });
}

function snapshotKey(item) {
  if (item.strategyVersion === "unified-buyable-v1") {
    return [
      item.fixtureId ?? "",
      item.market ?? "",
      item.selection ?? "",
      Number.isFinite(item.line) ? item.line : "",
      item.modelVersion ?? "",
      item.strategyVersion,
    ].join("|");
  }
  return `${item.matchId ?? ""}|${item.market ?? ""}|${Number.isFinite(item.line) ? item.line : ""}|${item.modelVersion ?? "legacy-v0"}`;
}

function resultKey(item) {
  return `${item.matchId ?? ""}|${item.market ?? ""}`;
}

function isLateSnapshot(item) {
  const savedAt = Date.parse(item.strategyVersion === "unified-buyable-v1"
    ? item.firstQualifiedAt ?? ""
    : item.savedAt ?? "");
  const commenceTime = Date.parse(item.commenceTime ?? "");
  return Number.isFinite(savedAt) && Number.isFinite(commenceTime) && savedAt >= commenceTime;
}

function hasProviderNegativeScore(item) {
  const score = String(item.score ?? "").trim();
  const match = score.match(/^(-?\d+)\s*-\s*(-?\d+)$/);
  return Boolean(match && (Number(match[1]) < 0 || Number(match[2]) < 0));
}

function duplicateKeys(rows, keyFn) {
  const seen = new Set();
  const duplicates = new Set();
  for (const row of rows) {
    const key = keyFn(row);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates];
}

// Pure check core shared by file mode and --database mode.
export function analyzeRows({ snapshots, results, observations = [] }) {
  const snapshotQuality = summarizeIntegritySnapshotQuality(snapshots);
  const lateSnapshots = snapshots.filter(isLateSnapshot);
  const duplicateSnapshotKeys = duplicateKeys(snapshots, snapshotKey);
  const duplicateResultKeys = duplicateKeys(results, resultKey);
  const negativeScores = results.filter(hasProviderNegativeScore);
  const snapshotsMissingCommenceTime = snapshots.filter((item) => !item.commenceTime);
  const duplicateObservationFingerprints = duplicateKeys(
    observations,
    (item) => `${item.snapshotId ?? item.sampleId ?? ""}|${item.fingerprint ?? ""}`,
  );
  const snapshotKickoffs = new Map(snapshots.flatMap((item) => {
    const id = item.sampleId ?? item.id;
    return id == null ? [] : [[String(id), Date.parse(item.commenceTime ?? "")]];
  }));
  const futureObservationInputs = observations.flatMap((observation) => {
    const evaluatedAt = Date.parse(observation.lastEvaluatedAt ?? observation.firstEvaluatedAt ?? "");
    return (Array.isArray(observation.inputs) ? observation.inputs : []).filter((input) => {
      const observedAt = Date.parse(input?.observedAt ?? "");
      return Number.isFinite(observedAt) && Number.isFinite(evaluatedAt) && observedAt > evaluatedAt;
    });
  });
  const postKickObservations = observations.filter((observation) => {
    const kickoff = snapshotKickoffs.get(String(observation.snapshotId ?? observation.sampleId ?? ""));
    const evaluatedAt = Date.parse(observation.lastEvaluatedAt ?? observation.firstEvaluatedAt ?? "");
    return Number.isFinite(kickoff) && Number.isFinite(evaluatedAt) && evaluatedAt >= kickoff;
  });

  const failures = [];
  if (lateSnapshots.length) failures.push(`${lateSnapshots.length} post-kick prediction snapshots`);
  if (duplicateSnapshotKeys.length) failures.push(`${duplicateSnapshotKeys.length} duplicate prediction snapshot keys`);
  if (duplicateResultKeys.length) failures.push(`${duplicateResultKeys.length} duplicate result archive keys`);
  if (negativeScores.length) failures.push(`${negativeScores.length} negative provider scores`);
  if (duplicateObservationFingerprints.length) failures.push(`${duplicateObservationFingerprints.length} duplicate recommendation observation fingerprints`);
  if (futureObservationInputs.length) failures.push(`${futureObservationInputs.length} future observation inputs`);
  if (postKickObservations.length) failures.push(`${postKickObservations.length} post-kick recommendation observations`);

  return {
    snapshots: snapshots.length,
    results: results.length,
    lateSnapshots: lateSnapshots.length,
    duplicateSnapshotKeys: duplicateSnapshotKeys.length,
    duplicateResultKeys: duplicateResultKeys.length,
    negativeScores: negativeScores.length,
    snapshotsMissingCommenceTime: snapshotsMissingCommenceTime.length,
    snapshotQuality,
    observations: observations.length,
    duplicateObservationFingerprints: duplicateObservationFingerprints.length,
    futureObservationInputs: futureObservationInputs.length,
    postKickObservations: postKickObservations.length,
    failures,
  };
}

function summarizeIntegritySnapshotQuality(snapshots) {
  const summary = { raw: snapshots.length, validCurrent: 0, legacy: 0, invalid: 0, invalidReasons: {} };
  for (const snapshot of snapshots) {
    const classification = snapshot?.strategyVersion === "unified-buyable-v1"
      ? classifyUnifiedSnapshot(snapshot)
      : classifySnapshot(snapshot);
    if (classification.status === "valid-current") summary.validCurrent += 1;
    else if (classification.status === "legacy") summary.legacy += 1;
    else {
      summary.invalid += 1;
      const reason = classification.reason ?? "invalid-snapshot";
      summary.invalidReasons[reason] = (summary.invalidReasons[reason] ?? 0) + 1;
    }
  }
  return summary;
}

function classifyUnifiedSnapshot(snapshot) {
  if (!nonEmpty(snapshot.fixtureId)) return invalid("missing-fixture-id");
  if (!nonEmpty(snapshot.market)) return invalid("missing-market");
  if (!nonEmpty(snapshot.selection)) return invalid("missing-selection");
  if (!nonEmpty(snapshot.modelVersion)) return invalid("missing-model-version");
  if (snapshot.strategyVersion !== "unified-buyable-v1") return invalid("invalid-strategy-version");
  if (["handicap", "totals", "corners"].includes(snapshot.market) && !Number.isFinite(snapshot.line)) return invalid("missing-line");
  if (snapshot.line != null && !Number.isFinite(snapshot.line)) return invalid("invalid-line");
  if (!validTimestamp(snapshot.commenceTime)) return invalid("invalid-commence-time");
  if (!validTimestamp(snapshot.firstQualifiedAt)) return invalid("invalid-first-qualified-at");
  return { status: "valid-current", reason: null };
}

function invalid(reason) {
  return { status: "invalid", reason };
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validTimestamp(value) {
  return nonEmpty(value) && Number.isFinite(Date.parse(value));
}

export function formatMetrics(metrics) {
  return [
    `snapshots=${metrics.snapshots}`,
    `results=${metrics.results}`,
    `lateSnapshots=${metrics.lateSnapshots}`,
    `duplicateSnapshotKeys=${metrics.duplicateSnapshotKeys}`,
    `duplicateResultKeys=${metrics.duplicateResultKeys}`,
    `negativeScores=${metrics.negativeScores}`,
    `snapshotsMissingCommenceTime=${metrics.snapshotsMissingCommenceTime} (legacy/backfilled rows may be expected)`,
    `snapshotQualityValidCurrent=${metrics.snapshotQuality.validCurrent}`,
    `snapshotQualityLegacy=${metrics.snapshotQuality.legacy}`,
    `snapshotQualityInvalid=${metrics.snapshotQuality.invalid}`,
    `snapshotQualityInvalidReasons=${JSON.stringify(metrics.snapshotQuality.invalidReasons)}`,
    `observations=${metrics.observations}`,
    `duplicateObservationFingerprints=${metrics.duplicateObservationFingerprints}`,
    `futureObservationInputs=${metrics.futureObservationInputs}`,
    `postKickObservations=${metrics.postKickObservations}`,
  ];
}

function report(metrics, { databaseMode }) {
  if (databaseMode) console.log("mode=database");
  for (const line of formatMetrics(metrics)) console.log(line);
  if (metrics.failures.length) {
    console.error(`Data integrity check failed: ${metrics.failures.join(", ")}`);
    process.exit(1);
  }
}

async function runDatabaseMode() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("--database mode requires DATABASE_URL");
  }
  const { createPool } = await import("../server/db/pool.mjs");
  const { createResultRepository } = await import("../server/db/result-repository.mjs");
  const pool = createPool(databaseUrl);
  try {
    // Strictly read-only: repository listAll() only; no writes, no migrations.
    const results = await createResultRepository(pool).listAll();
    const observationResult = await pool.query(`
      SELECT observation.snapshot_id, observation.fingerprint,
             observation.first_evaluated_at, observation.last_evaluated_at,
             observation.inputs, snapshot.commence_time
      FROM recommendation_observations AS observation
      JOIN prediction_snapshots AS snapshot ON snapshot.id = observation.snapshot_id
    `);
    const observations = observationResult.rows.map((row) => ({
      snapshotId: row.snapshot_id,
      fingerprint: row.fingerprint,
      firstEvaluatedAt: row.first_evaluated_at,
      lastEvaluatedAt: row.last_evaluated_at,
      inputs: row.inputs,
    }));
    const snapshotsByIdentity = await pool.query(`
      SELECT snapshot.id, snapshot.raw, snapshot.fixture_id, snapshot.market,
             snapshot.prediction, snapshot.line, snapshot.model_version,
             snapshot.strategy_version, snapshot.first_qualified_at,
             COALESCE(fixture.commence_time, snapshot.commence_time) AS commence_time
      FROM prediction_snapshots AS snapshot
      LEFT JOIN fixtures AS fixture ON fixture.id = snapshot.fixture_id
      WHERE snapshot.snapshot_status IN ('valid-current', 'legacy')
    `);
    const identifiedSnapshots = snapshotsByIdentity.rows.map((row) => ({
      ...row.raw,
      sampleId: row.id,
      fixtureId: row.fixture_id ?? row.raw.fixtureId,
      market: row.market ?? row.raw.market,
      selection: row.prediction ?? row.raw.selection,
      ...(row.line === null ? {} : { line: row.line }),
      modelVersion: row.model_version ?? row.raw.modelVersion,
      strategyVersion: row.strategy_version ?? row.raw.strategyVersion ?? "legacy-v0",
      firstQualifiedAt: row.first_qualified_at instanceof Date
        ? row.first_qualified_at.toISOString()
        : row.first_qualified_at ?? row.raw.firstQualifiedAt,
      commenceTime: row.commence_time instanceof Date
        ? row.commence_time.toISOString()
        : row.commence_time ?? row.raw.commenceTime,
    }));
    report(analyzeRows({ snapshots: identifiedSnapshots, results, observations }), { databaseMode: true });
  } finally {
    await pool.end();
  }
}

async function main() {
  if (process.argv.includes("--database")) {
    await runDatabaseMode();
    return;
  }
  const snapshots = readJsonl(snapshotPath);
  const results = readJsonl(resultPath);
  report(analyzeRows({ snapshots, results }), { databaseMode: false });
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await main();
}
