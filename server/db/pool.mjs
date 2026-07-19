import pg from "pg";

const { Pool } = pg;

export function createPool(databaseUrl) {
  return new Pool({ connectionString: databaseUrl });
}

export async function withTransaction(pool, callback) {
  const client = await pool.connect();
  let releaseError;
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      releaseError = rollbackError;
      if (error && (typeof error === "object" || typeof error === "function")) {
        error.rollbackError = rollbackError;
      }
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}
