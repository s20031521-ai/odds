// Storage backend resolution for collector/monitor scripts.
//
// "file" mode preserves the legacy JSON/JSONL persistence behavior.
// "postgres" mode wraps a pg Pool with createPostgresSink and persists
// exclusively through the Task 3 repositories. Migrations are owned by the
// server entry point; collector scripts never run them.

export const FILE_BACKEND = "file";
export const POSTGRES_BACKEND = "postgres";

export function resolveStorageBackend(env = process.env) {
  const raw = env.STORAGE_BACKEND;
  const backend = raw == null || String(raw).trim() === "" ? FILE_BACKEND : String(raw).trim();
  if (backend !== FILE_BACKEND && backend !== POSTGRES_BACKEND) {
    throw new Error(`STORAGE_BACKEND must be "file" or "postgres", got ${JSON.stringify(raw)}`);
  }
  if (backend === POSTGRES_BACKEND && !env.DATABASE_URL) {
    throw new Error("STORAGE_BACKEND=postgres requires DATABASE_URL");
  }
  if (env.NODE_ENV === "production" && backend !== POSTGRES_BACKEND) {
    throw new Error("NODE_ENV=production requires STORAGE_BACKEND=postgres; file mode is not selectable in production");
  }
  return backend;
}

export async function createStorageBackend(env = process.env) {
  const backend = resolveStorageBackend(env);
  if (backend === FILE_BACKEND) {
    return { backend, sink: null, pool: null, async close() {} };
  }
  const { createPool } = await import("../../server/db/pool.mjs");
  const { createPostgresSink } = await import("./postgres-sink.mjs");
  const pool = createPool(env.DATABASE_URL);
  const sink = createPostgresSink({ pool });
  return {
    backend,
    sink,
    pool,
    async close() {
      await pool.end();
    },
  };
}
