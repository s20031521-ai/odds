import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createPostgresSink } from "./lib/postgres-sink.mjs";
import { withDatabaseUrl } from "./lib/test-db.mjs";
import { analyzeRows, formatMetrics } from "./check-data-integrity.mjs";
import { createOpportunityRepository } from "../server/db/opportunity-repository.mjs";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(PROJECT_ROOT, "scripts", "check-data-integrity.mjs");

test("analyzeRows reports clean fixture rows without failures", () => {
  const metrics = analyzeRows({
    snapshots: [validSnapshot()],
    results: [validResult()],
  });
  assert.equal(metrics.snapshots, 1);
  assert.equal(metrics.results, 1);
  assert.equal(metrics.lateSnapshots, 0);
  assert.equal(metrics.duplicateSnapshotKeys, 0);
  assert.equal(metrics.duplicateResultKeys, 0);
  assert.equal(metrics.negativeScores, 0);
  assert.equal(metrics.snapshotQuality.validCurrent, 1);
  assert.deepEqual(metrics.failures, []);
});

test("analyzeRows detects late snapshots, duplicates, and negative scores like file mode", () => {
  const late = { ...validSnapshot(), matchId: "late-match", savedAt: "2026-07-18T12:30:00.000Z" };
  const dupeSnapshot = { ...validSnapshot(), matchId: "dupe" };
  const metrics = analyzeRows({
    snapshots: [validSnapshot(), late, dupeSnapshot, dupeSnapshot],
    results: [validResult(), validResult(), { ...validResult(), matchId: "neg", score: "-1-2" }],
  });
  assert.equal(metrics.lateSnapshots, 1);
  assert.equal(metrics.duplicateSnapshotKeys, 1);
  assert.equal(metrics.duplicateResultKeys, 1, "two identical matchId|market rows");
  assert.equal(metrics.negativeScores, 1);
  assert.equal(metrics.failures.length, 4);
  assert.match(metrics.failures.join(","), /post-kick/);
  assert.match(metrics.failures.join(","), /negative provider scores/);
});

test("analyzeRows detects duplicate, future-input, and post-kick recommendation observations", () => {
  const snapshot = validSnapshot({ sampleId: 42 });
  const observation = {
    snapshotId: 42,
    fingerprint: "same",
    firstEvaluatedAt: "2026-07-18T11:00:00.000Z",
    lastEvaluatedAt: "2026-07-18T11:05:00.000Z",
    inputs: [{ observedAt: "2026-07-18T11:06:00.000Z" }],
  };
  const postKick = {
    snapshotId: 42,
    fingerprint: "post-kick",
    firstEvaluatedAt: "2026-07-18T11:59:00.000Z",
    lastEvaluatedAt: "2026-07-18T12:01:00.000Z",
    inputs: [],
  };
  const metrics = analyzeRows({
    snapshots: [snapshot],
    results: [],
    observations: [observation, { ...observation }, postKick],
  });

  assert.equal(metrics.observations, 3);
  assert.equal(metrics.duplicateObservationFingerprints, 1);
  assert.equal(metrics.futureObservationInputs, 2);
  assert.equal(metrics.postKickObservations, 1);
  assert.match(metrics.failures.join(","), /duplicate recommendation observation fingerprints/);
  assert.match(metrics.failures.join(","), /future observation inputs/);
  assert.match(metrics.failures.join(","), /post-kick recommendation observations/);
});

test("unified integrity identity keeps distinct selections on the same fixture and line", () => {
  const home = validUnifiedSnapshot({ selection: "home" });
  const away = validUnifiedSnapshot({ selection: "away" });
  const metrics = analyzeRows({ snapshots: [home, away], results: [], observations: [] });

  assert.equal(metrics.duplicateSnapshotKeys, 0);
  assert.equal(metrics.snapshotQuality.validCurrent, 2);
  assert.equal(metrics.snapshotQuality.invalid, 0);
  assert.deepEqual(metrics.failures, []);
});

test("unified integrity detects a true full-identity duplicate", () => {
  const row = validUnifiedSnapshot();
  const metrics = analyzeRows({ snapshots: [row, { ...row }], results: [], observations: [] });

  assert.equal(metrics.duplicateSnapshotKeys, 1);
  assert.match(metrics.failures.join(","), /duplicate prediction snapshot keys/);
});

test("unified integrity validates its required identity fields without legacy quote scalars", () => {
  const metrics = analyzeRows({
    snapshots: [validUnifiedSnapshot({ fixtureId: undefined })],
    results: [],
    observations: [],
  });

  assert.equal(metrics.snapshotQuality.validCurrent, 0);
  assert.equal(metrics.snapshotQuality.invalid, 1);
  assert.equal(metrics.snapshotQuality.invalidReasons["missing-fixture-id"], 1);
});

test("formatMetrics preserves the legacy file-mode line format", () => {
  const lines = formatMetrics(analyzeRows({ snapshots: [validSnapshot()], results: [validResult()] }));
  assert.deepEqual(lines.map((line) => line.split("=")[0]), [
    "snapshots",
    "results",
    "lateSnapshots",
    "duplicateSnapshotKeys",
    "duplicateResultKeys",
    "negativeScores",
    "snapshotsMissingCommenceTime",
    "snapshotQualityValidCurrent",
    "snapshotQualityLegacy",
    "snapshotQualityInvalid",
    "snapshotQualityInvalidReasons",
    "observations",
    "duplicateObservationFingerprints",
    "futureObservationInputs",
    "postKickObservations",
  ]);
});

test("--database mode refuses to start without DATABASE_URL", async () => {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  await assert.rejects(
    execFileAsync(process.execPath, [SCRIPT, "--database"], { cwd: PROJECT_ROOT, env }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(String(error.stderr), /--database mode requires DATABASE_URL/);
      return true;
    },
  );
});

test("--database mode applies the same checks over repository rows", async (t) => {
  await withDatabaseUrl(t, async (pool, scopedUrl) => {
    const sink = createPostgresSink({ pool });
    await sink.saveSnapshots([validSnapshot()]);
    await sink.saveResults([validResult({ sourcePriority: 10 })]);
    const fixtureId = "00000000-0000-4000-8000-000000000042";
    await pool.query(`
      INSERT INTO fixtures (id, home_team, away_team, normalized_home_team, normalized_away_team, commence_time)
      VALUES ($1, 'Home', 'Away', 'home', 'away', '2026-07-19T12:00:00Z')
    `, [fixtureId]);
    await createOpportunityRepository(pool).recordEvaluation({
      evaluatedAt: "2026-07-19T10:00:00Z",
      inputs: [],
      opportunities: [{
        ...validUnifiedSnapshot({ fixtureId, commenceTime: "2026-07-19T12:00:00Z", firstQualifiedAt: undefined }),
        quotes: [{ bookmaker: "Book", provider: "fixture", odds: 2.1, chance: 0.55, edge: 0.155, minimumBuyOdds: 1.88, observedAt: "2026-07-19T09:59:00Z" }],
      }],
    });

    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [SCRIPT, "--database"],
      { cwd: PROJECT_ROOT, env: { ...process.env, DATABASE_URL: scopedUrl } },
    );

    assert.equal(stderr, "");
    const lines = stdout.trim().split(/\r?\n/);
    assert.equal(lines[0], "mode=database");
    assert.match(stdout, /^snapshots=2$/m);
    assert.match(stdout, /^results=1$/m);
    assert.match(stdout, /^lateSnapshots=0$/m);
    assert.match(stdout, /^duplicateSnapshotKeys=0$/m);
    assert.match(stdout, /^duplicateResultKeys=0$/m);
    assert.match(stdout, /^negativeScores=0$/m);
    assert.match(stdout, /^snapshotQualityValidCurrent=2$/m);
    assert.match(stdout, /^observations=1$/m);
  });
});

function validSnapshot(overrides = {}) {
  return {
    matchId: "integrity-match-1",
    market: "大細波",
    prediction: "大",
    line: 2.5,
    odds: 2.05,
    chance: 0.58,
    edge: 0.05,
    savedAt: "2026-07-18T10:00:00.000Z",
    commenceTime: "2026-07-18T12:00:00.000Z",
    modelVersion: "integrity-test-v1",
    source: "integrity-test",
    ...overrides,
  };
}

function validResult(overrides = {}) {
  return {
    matchId: "integrity-match-1",
    market: "大細波",
    actual: "大",
    score: "3-1",
    source: "integrity-test",
    completedAt: "2026-07-18T14:00:00.000Z",
    ...overrides,
  };
}

function validUnifiedSnapshot(overrides = {}) {
  return {
    fixtureId: "fixture-integrity-1",
    matchId: "provider-match-1",
    market: "handicap",
    selection: "home",
    line: -0.5,
    modelVersion: "hdc-loo-v2",
    strategyVersion: "unified-buyable-v1",
    commenceTime: "2026-07-18T12:00:00.000Z",
    firstQualifiedAt: "2026-07-18T10:00:00.000Z",
    ...overrides,
  };
}
