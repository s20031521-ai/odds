// Read-side repository for team_match_history (migration 006).
// Used by the dc-v1 shadow pipeline (ADR 0003) to fit per-league models
// inside the unified sampler. Writes happen offline via
// scripts/import-historical-scores.mjs.
export function createTeamHistoryRepository(pool) {
  return {
    async listAll() {
      const result = await pool.query(`
        SELECT league_code,
               to_char(match_date, 'YYYY-MM-DD') AS match_date,
               home_team,
               away_team,
               home_goals,
               away_goals
        FROM team_match_history
        ORDER BY league_code, match_date, id
      `);
      return result.rows.map((row) => ({
        leagueCode: row.league_code,
        matchDate: row.match_date,
        homeTeam: row.home_team,
        awayTeam: row.away_team,
        homeGoals: row.home_goals,
        awayGoals: row.away_goals,
      }));
    },
  };
}
