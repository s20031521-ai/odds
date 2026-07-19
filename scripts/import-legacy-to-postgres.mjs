import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPool } from "../server/db/pool.mjs";
import { createResultRepository } from "../server/db/result-repository.mjs";
import { createSnapshotRepository } from "../server/db/snapshot-repository.mjs";
import { resultIdentity, snapshotIdentity } from "../server/domain/identity.mjs";
import { classifySnapshot } from "../shared/snapshot-policy.mjs";

export const IMPORTER_VERSION = "phase1-v1";
export const LEGACY_SOURCES = Object.freeze([
  Object.freeze({ sourceName: "data/prediction-snapshots.jsonl", recordKind: "snapshot" }),
  Object.freeze({ sourceName: "data/background-hdc-snapshots.jsonl", recordKind: "snapshot" }),
  Object.freeze({ sourceName: "data/result-archive.jsonl", recordKind: "result" }),
  Object.freeze({ sourceName: "data/background-result-archive.jsonl", recordKind: "result" }),
]);

export async function importLegacyArchives({ pool, sourceRoot, importerVersion = IMPORTER_VERSION }) {
  if (!pool?.query || !pool?.connect) throw new TypeError("pool is required");
  if (typeof sourceRoot !== "string" || !sourceRoot.trim()) throw new TypeError("sourceRoot is required");

  const files = [];
  for (const source of await loadLegacySources(sourceRoot)) {
    files.push(await importSourceFile(pool, source, importerVersion));
  }
  return { status: "complete", files, totals: sumFileCounts(files) };
}

async function importSourceFile(pool, source, importerVersion) {
  const { bytes, sourceSha256 } = source;
  const run = await ensureRun(pool, source.sourceName, sourceSha256, importerVersion);

  if (run.status === "complete") {
    return emptyFileResult(source, sourceSha256, run.totalRows, "already-complete");
  }

  let rows;
  try {
    rows = parseJsonl(bytes, source.sourceName);
  } catch (error) {
    try {
      await pool.query(`
        UPDATE import_runs
        SET status = 'failed', total_rows = $2, accepted_rows = 0,
            rejected_rows = 0, finished_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status IN ('pending', 'failed')
      `, [run.id, countNonblankLines(bytes)]);
    } catch (statusUpdateError) {
      if (error && (typeof error === "object" || typeof error === "function")) error.statusUpdateError = statusUpdateError;
    }
    throw error;
  }

  const client = await pool.connect();
  let counts;
  let commitAttempted = false;
  let releaseError;
  let clientReleased = false;
  try {
    await client.query("BEGIN");
    const locked = await client.query("SELECT status FROM import_runs WHERE id = $1 FOR UPDATE", [run.id]);
    if (locked.rows[0]?.status === "complete") {
      await client.query("ROLLBACK");
      return emptyFileResult(source, sourceSha256, rows.length, "already-complete");
    }
    await client.query("DELETE FROM import_rows WHERE import_run_id = $1", [run.id]);
    await client.query(`
      UPDATE import_runs
      SET status = 'running', total_rows = $2, accepted_rows = 0,
          rejected_rows = 0, started_at = CURRENT_TIMESTAMP, finished_at = NULL
      WHERE id = $1
    `, [run.id, rows.length]);

    const classified = rows.map((row) => classifyImportedRow(row, source));
    for (const item of classified) {
      await client.query(`
        INSERT INTO import_rows (
          import_run_id, source_row, idempotency_key, classification,
        rejection_reason, raw, record_kind
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
      `, [
        run.id, item.sourceRow, item.idempotencyKey, item.classification,
        item.rejectionReason, JSON.stringify(item.raw), source.recordKind,
      ]);
    }

    const acceptedSnapshots = classified
      .filter((item) => source.recordKind === "snapshot" && item.classification !== "invalid")
      .map((item) => item.raw);
    const importedResults = classified
      .filter((item) => source.recordKind === "result" && item.classification !== "invalid")
      .map((item) => item.raw);
    const snapshotCounts = acceptedSnapshots.length
      ? await createSnapshotRepository(client).insertBatch(acceptedSnapshots)
      : { inserted: 0, duplicate: 0, rejected: 0, rejectedByReason: {} };
    const resultCounts = importedResults.length
      ? await createResultRepository(client).upsertBatch(importedResults)
      : { inserted: 0, updated: 0, ignored: 0 };
    const rejectedRows = classified.filter((item) => item.classification === "invalid").length;
    const acceptedRows = classified.length - rejectedRows;
    await client.query(`
      UPDATE import_runs
      SET status = 'complete', total_rows = $2, accepted_rows = $3, rejected_rows = $4,
          finished_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [run.id, rows.length, acceptedRows, rejectedRows]);
    commitAttempted = true;
    await client.query("COMMIT");
    counts = {
      sourceRows: rows.length,
      auditRowsAdded: rows.length,
      snapshotInserted: snapshotCounts.inserted,
      snapshotDuplicate: snapshotCounts.duplicate,
      snapshotRejected: source.recordKind === "snapshot" ? rejectedRows : 0,
      resultRejected: source.recordKind === "result" ? rejectedRows : 0,
      resultInserted: resultCounts.inserted,
      resultUpdated: resultCounts.updated,
      resultIgnored: resultCounts.ignored,
    };
  } catch (error) {
    if (commitAttempted) {
      releaseError = error;
    } else {
      try {
        await client.query("ROLLBACK");
        await client.query(`
          UPDATE import_runs SET status = 'failed', finished_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND status IN ('pending', 'failed')
        `, [run.id]);
      } catch (rollbackError) {
        releaseError = rollbackError;
        if (error && (typeof error === "object" || typeof error === "function")) error.rollbackError = rollbackError;
        client.release(releaseError);
        clientReleased = true;
      }
      if (clientReleased) {
        try {
          await pool.query(`
            UPDATE import_runs SET status = 'failed', finished_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND status IN ('pending', 'failed')
          `, [run.id]);
        } catch (statusError) {
          if (error && (typeof error === "object" || typeof error === "function")) error.statusUpdateError = statusError;
        }
      }
    }
    throw error;
  } finally {
    if (!clientReleased) client.release(releaseError);
  }
  return { sourceName: source.sourceName, recordKind: source.recordKind, sourceSha256, status: "complete", ...counts };
}

async function ensureRun(pool, sourceName, sourceSha256, importerVersion) {
  const found = await findRun(pool, sourceName, sourceSha256, importerVersion);
  if (found) return found;
  const id = randomUUID();
  const inserted = await pool.query(`
    INSERT INTO import_runs (
      id, source_name, source_sha256, importer_version, status,
      total_rows, accepted_rows, rejected_rows, started_at
    ) VALUES ($1, $2, $3, $4, 'pending', 0, 0, 0, CURRENT_TIMESTAMP)
    ON CONFLICT (source_name, source_sha256, importer_version) DO NOTHING
    RETURNING id, status, total_rows AS "totalRows"
  `, [id, sourceName, sourceSha256, importerVersion]);
  if (inserted.rowCount) return inserted.rows[0];
  return findRun(pool, sourceName, sourceSha256, importerVersion);
}

async function findRun(pool, sourceName, sourceSha256, importerVersion) {
  const existing = await pool.query(`
    SELECT id, status, total_rows AS "totalRows"
    FROM import_runs
    WHERE source_name = $1 AND source_sha256 = $2 AND importer_version = $3
  `, [sourceName, sourceSha256, importerVersion]);
  return existing.rows[0];
}

export function parseJsonl(bytes, sourceName) {
  const physicalLines = bytes.toString("utf8").split(/\r?\n/);
  const rows = [];
  for (let index = 0; index < physicalLines.length; index += 1) {
    const text = physicalLines[index].trim();
    if (!text) continue;
    try {
      rows.push({ sourceRow: index + 1, raw: JSON.parse(text) });
    } catch {
      throw new Error(`${sourceName}:${index + 1} contains malformed JSON`);
    }
  }
  return rows;
}

function countNonblankLines(bytes) {
  return bytes.toString("utf8").split(/\r?\n/).filter((line) => line.trim()).length;
}

export function classifyImportedRow({ sourceRow, raw }, source) {
  const isObject = raw !== null && typeof raw === "object" && !Array.isArray(raw);
  if (!isObject) {
    return { sourceRow, raw, idempotencyKey: `audit|${source.recordKind}|${source.sourceName}|${sourceRow}`, classification: "invalid", rejectionReason: `invalid-${source.recordKind}` };
  }
  if (source.recordKind === "snapshot") {
    const classification = classifySnapshot(raw);
    return {
      sourceRow,
      raw,
      idempotencyKey: snapshotIdentity(raw),
      classification: classification.status,
      rejectionReason: classification.reason,
    };
  }
  return {
    sourceRow,
    raw,
    idempotencyKey: resultIdentity(raw),
    classification: "result",
    rejectionReason: null,
  };
}

export async function loadLegacySources(sourceRoot) {
  const root = await realpath(path.resolve(sourceRoot));
  const sources = [];
  for (const source of LEGACY_SOURCES) {
    const resolved = await realpath(path.join(root, ...source.sourceName.split("/")));
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`source containment failed: ${source.sourceName}`);
    }
    const bytes = await readFile(resolved);
    sources.push({ ...source, bytes, sourceSha256: createHash("sha256").update(bytes).digest("hex") });
  }
  return sources;
}

function emptyFileResult(source, sourceSha256, sourceRows, status) {
  return {
    sourceName: source.sourceName,
    recordKind: source.recordKind,
    sourceSha256,
    status,
    sourceRows,
    auditRowsAdded: 0,
    snapshotInserted: 0,
    snapshotDuplicate: 0,
    snapshotRejected: 0,
    resultRejected: 0,
    resultInserted: 0,
    resultUpdated: 0,
    resultIgnored: 0,
  };
}

function sumFileCounts(files) {
  const fields = [
    "sourceRows", "auditRowsAdded", "snapshotInserted", "snapshotDuplicate",
    "snapshotRejected", "resultRejected", "resultInserted", "resultUpdated", "resultIgnored",
  ];
  return Object.fromEntries(fields.map((field) => [field, files.reduce((sum, file) => sum + file[field], 0)]));
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
    const outcome = await importLegacyArchives({ pool, sourceRoot: parseSourceRoot(process.argv.slice(2)) });
    for (const [index, file] of outcome.files.entries()) {
      console.log(`file${index + 1}Hash=${file.sourceSha256}`);
      console.log(`file${index + 1}Rows=${file.sourceRows}`);
      console.log(`file${index + 1}Status=${file.status}`);
    }
    for (const [name, count] of Object.entries(outcome.totals)) console.log(`${name}=${count}`);
    console.log(`status=${outcome.status}`);
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
