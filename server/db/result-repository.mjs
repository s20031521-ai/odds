import { resultIdentity } from "../domain/identity.mjs";
import { withTransaction } from "./pool.mjs";

export function createResultRepository(db) {
  return {
    async upsertBatch(results) {
      return inRepositoryTransaction(db, async (client) => {
        const counts = { inserted: 0, updated: 0, ignored: 0 };
        for (const row of results) {
          const resolved = await resolveFixtureAlias(client, row);
          const outcome = await client.query(`
            INSERT INTO results (
              identity_key, match_id, market, actual, source,
              source_priority, completed_at, raw
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (identity_key) DO UPDATE SET
              match_id = EXCLUDED.match_id,
              market = EXCLUDED.market,
              actual = EXCLUDED.actual,
              source = EXCLUDED.source,
              source_priority = EXCLUDED.source_priority,
              completed_at = EXCLUDED.completed_at,
              raw = EXCLUDED.raw
            WHERE results.source_priority IS NULL
               OR EXCLUDED.source_priority > results.source_priority
            RETURNING (xmax = 0) AS inserted
          `, [
            resultIdentity(resolved),
            resolved.matchId ?? null,
            resolved.market ?? null,
            resolved.actual ?? null,
            resolved.source ?? null,
            resolved.sourcePriority ?? 0,
            resolved.completedAt ?? null,
            resolved,
          ]);

          if (outcome.rowCount === 0) counts.ignored += 1;
          else if (outcome.rows[0].inserted) counts.inserted += 1;
          else counts.updated += 1;
        }
        return counts;
      });
    },

    async listAll() {
      const result = await db.query("SELECT raw FROM results");
      return result.rows.map(({ raw }) => raw);
    },
  };
}

async function resolveFixtureAlias(client, row) {
  if (row?.fixtureId || typeof row?.provider !== "string" || typeof row?.matchId !== "string") return row;
  const alias = await client.query(`
    SELECT fixture_id
    FROM fixture_aliases
    WHERE provider = $1 AND provider_match_id = $2
  `, [row.provider, row.matchId]);
  return alias.rows[0]?.fixture_id ? { ...row, fixtureId: alias.rows[0].fixture_id } : row;
}

function inRepositoryTransaction(db, callback) {
  return typeof db.release === "function" ? callback(db) : withTransaction(db, callback);
}
