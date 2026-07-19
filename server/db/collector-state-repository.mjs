export function createCollectorStateRepository(pool) {
  return {
    async get(stateKey) {
      const result = await pool.query(
        "SELECT state FROM collector_state WHERE state_key = $1",
        [stateKey],
      );
      return result.rows[0]?.state;
    },

    async set(stateKey, state, updatedAt) {
      await pool.query(`
        INSERT INTO collector_state (state_key, state, updated_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (state_key) DO UPDATE SET
          state = EXCLUDED.state,
          updated_at = EXCLUDED.updated_at
      `, [stateKey, state, updatedAt]);
    },
  };
}
