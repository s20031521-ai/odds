import fs from "node:fs";
import path from "node:path";

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
  return `${item.matchId ?? ""}|${item.market ?? ""}|${Number.isFinite(item.line) ? item.line : ""}|${item.modelVersion ?? "legacy-v0"}`;
}

function resultKey(item) {
  return `${item.matchId ?? ""}|${item.market ?? ""}`;
}

function isLateSnapshot(item) {
  const savedAt = Date.parse(item.savedAt ?? "");
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

const snapshots = readJsonl(snapshotPath);
const results = readJsonl(resultPath);

const lateSnapshots = snapshots.filter(isLateSnapshot);
const duplicateSnapshotKeys = duplicateKeys(snapshots, snapshotKey);
const duplicateResultKeys = duplicateKeys(results, resultKey);
const negativeScores = results.filter(hasProviderNegativeScore);
const snapshotsMissingCommenceTime = snapshots.filter((item) => !item.commenceTime);

const failures = [];
if (lateSnapshots.length) failures.push(`${lateSnapshots.length} post-kick prediction snapshots`);
if (duplicateSnapshotKeys.length) failures.push(`${duplicateSnapshotKeys.length} duplicate prediction snapshot keys`);
if (duplicateResultKeys.length) failures.push(`${duplicateResultKeys.length} duplicate result archive keys`);
if (negativeScores.length) failures.push(`${negativeScores.length} negative provider scores`);

console.log(`snapshots=${snapshots.length}`);
console.log(`results=${results.length}`);
console.log(`lateSnapshots=${lateSnapshots.length}`);
console.log(`duplicateSnapshotKeys=${duplicateSnapshotKeys.length}`);
console.log(`duplicateResultKeys=${duplicateResultKeys.length}`);
console.log(`negativeScores=${negativeScores.length}`);
console.log(`snapshotsMissingCommenceTime=${snapshotsMissingCommenceTime.length} (legacy/backfilled rows may be expected)`);

if (failures.length) {
  console.error(`Data integrity check failed: ${failures.join(", ")}`);
  process.exit(1);
}
