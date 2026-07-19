import assert from "node:assert/strict";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAuthService } from "./auth/auth-service.mjs";
import { createApp } from "./app.mjs";
import { loadServerConfig } from "./config.mjs";
import { runMigrations } from "./db/migrate.mjs";
import { createOddsRepository } from "./db/odds-repository.mjs";
import { createPool } from "./db/pool.mjs";
import { createResultRepository } from "./db/result-repository.mjs";
import { createSnapshotRepository } from "./db/snapshot-repository.mjs";
import { buildBacktest } from "./domain/backtest.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

if (process.argv.includes("--self-test")) {
  const response = buildBacktest([
    {
      matchId: "self-test",
      market: "大細波",
      prediction: "大",
      line: 2.5,
      odds: 2,
      chance: 0.55,
      edge: 0.04,
      savedAt: "2026-07-11T05:00:00.000Z",
      commenceTime: "2026-07-11T06:00:00.000Z",
      modelVersion: "server-self-test-v1",
      source: "self-test",
    },
  ], [
    { matchId: "self-test", market: "大細波", actual: "3 球" },
  ], Date.parse("2026-07-11T12:00:00.000Z"));
  assert.equal(response.rows[0].settlement, "win");
  assert.equal(response.summary.finished, 1);
  console.log("[server] self-test passed");
  process.exit(0);
}

const config = loadServerConfig(process.env);
const pool = createPool(config.databaseUrl);
if (config.runMigrations) {
  await runMigrations(pool, path.join(root, "db", "migrations"));
} else {
  console.log("[server] RUN_MIGRATIONS=false, skipping migrations (run the one-shot migration job instead)");
}

const repositories = {
  snapshots: createSnapshotRepository(pool),
  results: createResultRepository(pool),
  odds: createOddsRepository(pool),
};
const auth = createAuthService({
  pool,
  throttleSecret: config.sessionSecret,
});
const app = createApp({
  repositories,
  auth,
  publicOrigin: config.publicOrigin,
  trustedProxyCidrs: config.trustedProxyCidrs,
  readinessCheck: async () => {
    await pool.query("SELECT 1");
    return { ok: true, database: "ok" };
  },
  logger: console,
});

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 8787);
const server = createServer((req, res) => {
  Promise.resolve(app(req, res)).catch((error) => {
    console.error(error);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "server_error" }));
    } else {
      res.destroy();
    }
  });
});

server.listen(port, host, () => {
  console.log(`[server] listening on ${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  });
}
