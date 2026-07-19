import { classifySnapshot } from "../../shared/snapshot-policy.mjs";
import { snapshotIdentity } from "../domain/identity.mjs";
import { withTransaction } from "./pool.mjs";

export function createSnapshotRepository(pool) {
  return {
    async insertBatch(snapshots) {
      const accepted = [];
      const rejectedByReason = {};

      for (const snapshot of snapshots) {
        const classification = classifySnapshot(snapshot);
        if (classification.status === "invalid") {
          const reason = classification.reason ?? "invalid-snapshot";
          rejectedByReason[reason] = (rejectedByReason[reason] ?? 0) + 1;
        } else {
          accepted.push({ snapshot, classification });
        }
      }

      const inserted = await withTransaction(pool, async (client) => {
        let count = 0;
        for (const { snapshot, classification } of accepted) {
          const result = await client.query(`
            INSERT INTO prediction_snapshots (
              identity_key, match_id, market, prediction, line, odds, chance, edge,
              saved_at, commence_time, model_version, source, snapshot_status,
              rejection_reason, raw
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8,
              $9, $10, $11, $12, $13, $14, $15
            )
            ON CONFLICT (identity_key) DO NOTHING
            RETURNING identity_key
          `, [
            snapshotIdentity(snapshot),
            snapshot.matchId ?? null,
            snapshot.market ?? null,
            snapshot.prediction ?? null,
            finiteOrNull(snapshot.line),
            positiveFiniteOrNull(snapshot.odds),
            probabilityOrNull(snapshot.chance),
            finiteOrNull(snapshot.edge),
            timestampOrNull(snapshot.savedAt),
            timestampOrNull(snapshot.commenceTime),
            snapshot.modelVersion ?? null,
            snapshot.source ?? null,
            classification.status,
            classification.reason,
            snapshot,
          ]);
          count += result.rowCount;
        }
        return count;
      });

      return {
        inserted,
        duplicate: accepted.length - inserted,
        rejected: snapshots.length - accepted.length,
        rejectedByReason,
      };
    },

    async listAll() {
      const result = await pool.query(`
        SELECT raw
        FROM prediction_snapshots
        WHERE snapshot_status IN ('valid-current', 'legacy')
      `);
      return result.rows.map(({ raw }) => raw);
    },

    async listCurrent() {
      const result = await pool.query(`
        SELECT raw
        FROM prediction_snapshots
        WHERE snapshot_status = 'valid-current'
      `);
      return result.rows.map(({ raw }) => raw);
    },
  };
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function positiveFiniteOrNull(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function probabilityOrNull(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function timestampOrNull(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
