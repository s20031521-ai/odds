import { classifySnapshot } from "../../shared/snapshot-policy.mjs";
import { snapshotIdentity } from "../domain/identity.mjs";
import { withTransaction } from "./pool.mjs";

export function createSnapshotRepository(db) {
  return {
    async insertBatch(snapshots) {
      const accepted = [];
      const rejectedByReason = {};

      for (const snapshot of snapshots) {
        if (snapshot?.strategyVersion === "unified-buyable-v1") {
          const reason = "server-only-strategy";
          rejectedByReason[reason] = (rejectedByReason[reason] ?? 0) + 1;
          continue;
        }
        const classification = classifySnapshot(snapshot);
        if (classification.status === "invalid") {
          const reason = classification.reason ?? "invalid-snapshot";
          rejectedByReason[reason] = (rejectedByReason[reason] ?? 0) + 1;
        } else {
          accepted.push({ snapshot, classification });
        }
      }

      const inserted = await inRepositoryTransaction(db, async (client) => {
        let count = 0;
        for (const { snapshot, classification } of accepted) {
          const result = await client.query(`
            INSERT INTO prediction_snapshots (
              identity_key, match_id, market, prediction, line, odds, chance, edge,
              saved_at, commence_time, model_version, source, snapshot_status,
              rejection_reason, raw, strategy_version
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8,
              $9, $10, $11, $12, $13, $14, $15, $16
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
            snapshot.strategyVersion ?? null,
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
      const result = await db.query(`
        SELECT raw, strategy_version
        FROM prediction_snapshots
        WHERE snapshot_status IN ('valid-current', 'legacy')
      `);
      return result.rows.map(snapshotWithStrategy);
    },

    async listCurrent() {
      const result = await db.query(`
        SELECT raw, strategy_version
        FROM prediction_snapshots
        WHERE snapshot_status = 'valid-current'
      `);
      return result.rows.map(snapshotWithStrategy);
    },
  };
}

function snapshotWithStrategy({ raw, strategy_version: strategyVersion }) {
  return { ...raw, strategyVersion: strategyVersion ?? "legacy-v0" };
}

function inRepositoryTransaction(db, callback) {
  return typeof db.release === "function" ? callback(db) : withTransaction(db, callback);
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
