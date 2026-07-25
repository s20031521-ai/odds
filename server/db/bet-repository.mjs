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
  };
}
