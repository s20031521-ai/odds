import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "./app.mjs";
import { loadServerConfig } from "./config.mjs";
import { runMigrations } from "./db/migrate.mjs";
import { createFixtureRepository } from "./db/fixture-repository.mjs";
import { createOddsRepository } from "./db/odds-repository.mjs";
import { createOpportunityRepository } from "./db/opportunity-repository.mjs";
import { createPool } from "./db/pool.mjs";
import { createResultRepository } from "./db/result-repository.mjs";
import { createSnapshotRepository } from "./db/snapshot-repository.mjs";
import { createBetRepository } from "./db/bet-repository.mjs";
import { createCollectorStateRepository } from "./db/collector-state-repository.mjs";
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
  fixtures: createFixtureRepository(pool),
  opportunities: createOpportunityRepository(pool),
  snapshots: createSnapshotRepository(pool),
  results: createResultRepository(pool),
  odds: createOddsRepository(pool),
  bets: createBetRepository(pool),
  collectorState: createCollectorStateRepository(pool),
};
// Single-owner deployment: no login system. Resolve (or lazily create) the
// one owner row that all bets and personal data attach to.
const ownerId = await resolveOwnerId(pool);
const app = createApp({
  repositories,
  ownerId,
  readinessCheck: async () => {
    await pool.query("SELECT 1");
    return { ok: true, database: "ok" };
  },
  logger: console,
});

async function resolveOwnerId(pool) {
  const existing = await pool.query("SELECT id FROM owners ORDER BY created_at ASC LIMIT 1");
  if (existing.rows[0]?.id) return existing.rows[0].id;
  const id = randomUUID();
  await pool.query(
    "INSERT INTO owners (id, username, password_hash, created_at) VALUES ($1, $2, $3, now())",
    [id, "owner", "!no-login"],
  );
  console.log("[server] created default owner row (login system removed)");
  return id;
}

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
