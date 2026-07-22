import { liveOddsIdentity } from "../domain/identity.mjs";
import { withTransaction } from "./pool.mjs";

export function createOddsRepository(pool) {
  return {
    async replaceProviderSnapshot(provider, observedAt, entries) {
      validateEntries(entries);
      await withTransaction(pool, async (client) => {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
          [provider],
        );
        await client.query("DELETE FROM live_odds WHERE provider = $1", [provider]);
        for (const entry of entries) {
          await client.query(`
            INSERT INTO live_odds (
              identity_key, entry_id, provider, match_id, home_team, away_team,
              commence_time, market, selection, line, odds, observed_at,
              expires_at, raw
            ) VALUES (
              $1, $2, $3, $4, $5, $6,
              $7, $8, $9, $10, $11, $12,
              $13, $14
            )
          `, [
            liveOddsIdentity({ ...entry, provider }),
            entry.id ?? null,
            provider,
            entry.matchId ?? null,
            entry.homeTeam ?? null,
            entry.awayTeam ?? null,
            entry.commenceTime ?? null,
            entry.market ?? null,
            entry.selection ?? null,
            entry.line ?? null,
            entry.odds ?? null,
            observedAt,
            entry.expiresAt ?? null,
            entry,
          ]);
        }
      });
    },

    async listLive(now) {
      const result = await pool.query(`
        SELECT raw, entry_id, provider, match_id, observed_at, expires_at
        FROM live_odds
        WHERE expires_at > $1
      `, [now]);
      return result.rows.map((row) => ({
        ...row.raw,
        id: row.entry_id,
        provider: row.provider,
        matchId: row.match_id,
        observedAt: isoOrNull(row.observed_at),
        expiresAt: isoOrNull(row.expires_at),
      }));
    },
  };
}

function isoOrNull(value) {
  return value instanceof Date ? value.toISOString() : value ?? null;
}

function validateEntries(entries) {
  for (const entry of entries) {
    if (entry.line !== undefined && entry.line !== null && !Number.isFinite(entry.line)) {
      throw new TypeError("live odds line must be finite when present");
    }
    if (!Number.isFinite(entry.odds) || entry.odds <= 0) {
      throw new TypeError("live odds must have positive finite odds");
    }
  }
}
