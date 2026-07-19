import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const CREATE_MIGRATION_LEDGER = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    checksum_sha256 text NOT NULL,
    applied_at timestamptz NOT NULL
  )
`;
const MIGRATION_LOCK_ID = "7957694271668822348";

export async function runMigrations(pool, migrationsDir) {
  const client = await pool.connect();
  let lockHeld = false;
  let primaryError;
  let cleanupError;
  const connectionState = {
    lockAcquisitionUncertain: false,
    transactionUncertain: false,
  };

  try {
    connectionState.lockAcquisitionUncertain = true;
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    connectionState.lockAcquisitionUncertain = false;
    lockHeld = true;
    return await runLockedMigrations(client, migrationsDir, connectionState);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (lockHeld) {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
        lockHeld = false;
      } catch (unlockError) {
        cleanupError = unlockError;
        if (primaryError && (typeof primaryError === "object" || typeof primaryError === "function")) {
          primaryError.unlockError = unlockError;
        }
      }
    }
    const uncertainStateError = (
      connectionState.lockAcquisitionUncertain || connectionState.transactionUncertain
    )
      ? (primaryError instanceof Error ? primaryError : new Error("Migration connection state is uncertain"))
      : undefined;
    client.release(cleanupError ?? primaryError?.rollbackError ?? uncertainStateError);
    if (cleanupError && !primaryError) throw cleanupError;
  }
}

async function runLockedMigrations(client, migrationsDir, connectionState) {
  await client.query(CREATE_MIGRATION_LEDGER);

  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const filenames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
  const recorded = await client.query("SELECT version, checksum_sha256 FROM schema_migrations");
  const appliedChecksums = new Map(recorded.rows.map(({ version, checksum_sha256 }) => [version, checksum_sha256]));
  const availableFilenames = new Set(filenames);
  const missingVersions = [...appliedChecksums.keys()]
    .filter((version) => !availableFilenames.has(version))
    .sort();
  if (missingVersions.length > 0) {
    throw new Error(`Recorded migration ${missingVersions[0]} is missing from the migration directory`);
  }
  let latestApplied = [...appliedChecksums.keys()].sort().at(-1);
  const applied = [];

  for (const filename of filenames) {
    const sql = await readFile(path.join(migrationsDir, filename), "utf8");
    const checksum = createHash("sha256").update(sql, "utf8").digest("hex");
    const appliedChecksum = appliedChecksums.get(filename);

    if (appliedChecksum !== undefined) {
      if (appliedChecksum !== checksum) {
        throw new Error(`Migration checksum changed for ${filename}`);
      }
      continue;
    }

    if (latestApplied && filename < latestApplied) {
      throw new Error(`Migration ${filename} sorts before already-applied ${latestApplied}`);
    }

    await applyMigration(client, filename, checksum, sql, connectionState);
    appliedChecksums.set(filename, checksum);
    latestApplied = filename;
    applied.push(filename);
  }

  return applied;
}

async function applyMigration(client, filename, checksum, sql, connectionState) {
  connectionState.transactionUncertain = true;
  await client.query("BEGIN");
  connectionState.transactionUncertain = false;
  let commitAttempted = false;
  try {
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations (version, checksum_sha256, applied_at) VALUES ($1, $2, CURRENT_TIMESTAMP)",
      [filename, checksum],
    );
    connectionState.transactionUncertain = true;
    commitAttempted = true;
    await client.query("COMMIT");
    connectionState.transactionUncertain = false;
  } catch (error) {
    if (!commitAttempted) {
      connectionState.transactionUncertain = true;
      try {
        await client.query("ROLLBACK");
        connectionState.transactionUncertain = false;
      } catch (rollbackError) {
        if (error && (typeof error === "object" || typeof error === "function")) {
          error.rollbackError = rollbackError;
        }
      }
    }
    throw error;
  }
}
