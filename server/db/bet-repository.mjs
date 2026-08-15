import { insertPersonalBetSample, settlePersonalBet } from "../domain/personal-bet-sample.mjs";

export function createBetRepository(db) {
  return {
    async create(ownerId, bet) {
      const result = await db.query(
        `INSERT INTO bet_slips
          (owner_id, fixture_id, match_id, sample_id,
           home_team, home_team_zh, away_team, away_team_zh,
           commence_time, market, selection, line, odds, stake, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [
          ownerId, bet.fixtureId ?? null, bet.matchId ?? null, bet.sampleId ?? null,
          bet.homeTeam ?? null, bet.homeTeamZh ?? null, bet.awayTeam ?? null, bet.awayTeamZh ?? null,
          bet.commenceTime ?? null, bet.market, bet.selection, bet.line ?? null,
          bet.odds, bet.stake, bet.source,
        ],
      );
      return result.rows[0];
    },

    async listByOwner(ownerId) {
      const result = await db.query(
        `SELECT * FROM bet_slips WHERE owner_id = $1 ORDER BY created_at DESC`,
        [ownerId],
      );
      return result.rows;
    },

    /** Bets not yet promoted into prediction_snapshots. */
    async listWithoutSample(ownerId) {
      const result = await db.query(
        `SELECT * FROM bet_slips
         WHERE owner_id = $1 AND sample_id IS NULL
         ORDER BY created_at ASC`,
        [ownerId],
      );
      return result.rows;
    },

    async listPending(ownerId) {
      const result = await db.query(
        `SELECT * FROM bet_slips
         WHERE owner_id = $1 AND settlement = 'pending'
         ORDER BY created_at ASC`,
        [ownerId],
      );
      return result.rows;
    },

    async getById(ownerId, betId) {
      const result = await db.query(
        `SELECT * FROM bet_slips WHERE id = $1 AND owner_id = $2`,
        [betId, ownerId],
      );
      return result.rows[0] ?? null;
    },

    /** Update editable fields; pending bets only (settled history stays immutable). */
    async update(ownerId, betId, bet) {
      const result = await db.query(
        `UPDATE bet_slips SET
           fixture_id = $3, match_id = $4,
           home_team = $5, home_team_zh = $6, away_team = $7, away_team_zh = $8,
           commence_time = $9, market = $10, selection = $11, line = $12,
           odds = $13, stake = $14, updated_at = now()
         WHERE id = $1 AND owner_id = $2 AND settlement = 'pending'
         RETURNING *`,
        [
          betId, ownerId,
          bet.fixtureId ?? null, bet.matchId ?? null,
          bet.homeTeam ?? null, bet.homeTeamZh ?? null, bet.awayTeam ?? null, bet.awayTeamZh ?? null,
          bet.commenceTime ?? null, bet.market, bet.selection, bet.line ?? null,
          bet.odds, bet.stake,
        ],
      );
      return result.rows[0] ?? null;
    },

    async remove(ownerId, betId) {
      const result = await db.query(
        `DELETE FROM bet_slips WHERE id = $1 AND owner_id = $2 RETURNING id`,
        [betId, ownerId],
      );
      return result.rows.length > 0;
    },

    async setSampleId(betId, sampleId) {
      const result = await db.query(
        `UPDATE bet_slips SET sample_id = $2, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [betId, sampleId],
      );
      return result.rows[0] ?? null;
    },

    async setSettlement(betId, settlement) {
      const result = await db.query(
        `UPDATE bet_slips
         SET settlement = $2, settled_at = now(), updated_at = now()
         WHERE id = $1 AND settlement = 'pending'
         RETURNING *`,
        [betId, settlement],
      );
      return result.rows[0] ?? null;
    },

    /**
     * Promote a personal bet into prediction_snapshots (sample) if not yet linked.
     * Returns updated bet row.
     */
    async ensureSample(bet) {
      if (!bet) return bet;
      if (bet.sample_id != null) return bet;
      const sampleId = await insertPersonalBetSample(db, bet);
      return await this.setSampleId(bet.id, sampleId);
    },

    /**
     * Try to settle pending bets that have a match_id against results.
     * findResultsByMatchId(matchId) => Promise<resultRaw[]>
     */
    async settlePendingWithResults(ownerId, findResultsByMatchId) {
      const pending = await this.listPending(ownerId);
      const updated = [];
      for (const bet of pending) {
        if (!bet.match_id) continue;
        const results = await findResultsByMatchId(bet.match_id);
        const settlement = settlePersonalBet(bet, results);
        if (!settlement) continue;
        const row = await this.setSettlement(bet.id, settlement);
        if (row) updated.push(row);
      }
      return updated;
    },
  };
}
