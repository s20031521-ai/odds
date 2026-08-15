import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

import { createApp } from "./app.mjs";

const NOW = new Date("2026-07-18T00:00:00.000Z");
const OWNER_ID = "owner-1";

// 登入系統已移除:所有 /api/v1 路由毋需 session/CSRF,直接用固定 ownerId。
test("serves the same-origin api/v1 contract without any auth gate", async (t) => {
  const appSource = await readFile(new URL("./app.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(appSource, /child_process|api-football|the-odds-api|hkjc-import|odds-monitor/i);
  assert.doesNotMatch(appSource, /csrf|session|login|logout/i);

  const fetchCalls = [];
  const originalFetch = globalThis.fetch;
  request.fetch = originalFetch;
  globalThis.fetch = async (...args) => {
    fetchCalls.push(args);
    throw new Error("provider fetch must not be called");
  };
  t.after(() => { globalThis.fetch = originalFetch; delete request.fetch; });

  const repositories = createFakeRepositories();
  const server = await listen(createApp({
    repositories,
    ownerId: OWNER_ID,
    readinessCheck: async () => ({ ok: true, database: "ok" }),
    clock: () => NOW,
    logger: { error() {} },
  }));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  assert.deepEqual((await request(baseUrl, "GET", "/internal/health/ready")).body, { ok: true, database: "ok" });
  assert.equal((await request(baseUrl, "GET", "/api/v1/unknown")).status, 404);
  assert.equal((await request(baseUrl, "GET", "/unknown")).status, 404);
  // Removed auth routes now simply do not exist.
  assert.equal((await request(baseUrl, "POST", "/api/v1/auth/login")).status, 404);
  assert.equal((await request(baseUrl, "GET", "/api/v1/session")).status, 404);
  assert.equal((await request(baseUrl, "POST", "/api/v1/auth/logout")).status, 404);
  assert.equal((await request(baseUrl, "POST", "/api/v1/odds/live")).status, 405);

  // Data feeds are directly reachable — no 401 gate anywhere.
  const live = await request(baseUrl, "GET", "/api/v1/odds/live");
  assert.equal(live.status, 200);
  assert.equal(live.body.entries[0].id, "live-1");
  assert.deepEqual(live.body.quota, { used: 123, remaining: 377 });
  assert.deepEqual((await request(baseUrl, "GET", "/api/v1/results")).body.resultEntries, repositories.results.rows);

  for (const query of ["", "?sampleId=0", "?sampleId=-1", "?sampleId=1.5", "?sampleId=abc"]) {
    const invalidHistory = await request(baseUrl, "GET", `/api/v1/predictions/observations${query}`);
    assert.equal(invalidHistory.status, 400, query);
    assert.deepEqual(invalidHistory.body, { error: "bad_request" });
  }

  const current = await request(baseUrl, "GET", "/api/v1/recommendations/current");
  assert.equal(current.status, 200);
  assert.equal(current.headers.get("cache-control"), "no-store");
  assert.deepEqual(current.body, {
    generatedAt: NOW.toISOString(),
    strategyVersion: "unified-buyable-v1",
    opportunities: [{
      sampleId: 101,
      fixtureId: "fixture-current",
      matchId: "match-current",
      homeTeam: "Alpha",
      awayTeam: "Beta",
      league: "Test League",
      commenceTime: "2026-07-18T10:00:00.000Z",
      market: "totals",
      selection: "over",
      line: 2.5,
      modelVersion: "totals-loo-v1",
      strategyVersion: "unified-buyable-v1",
      quoteRange: { min: 2.02, max: 2.2, count: 2 },
      bestQuote: quote("Pinnacle", 2.2, "2026-07-17T23:30:00.000Z"),
      quotes: [
        quote("Pinnacle", 2.2, "2026-07-17T23:30:00.000Z"),
        quote("HKJC", 2.02, "2026-07-17T23:15:00.000Z", "hkjc"),
      ],
      lastEvaluatedAt: "2026-07-17T23:59:00.000Z",
    }],
  });

  const history = await request(baseUrl, "GET", "/api/v1/predictions/observations?sampleId=101");
  assert.equal(history.status, 200);
  assert.equal(history.headers.get("cache-control"), "no-store");
  assert.deepEqual(history.body, { sampleId: 101, observations: repositories.opportunities.observations });

  const backtest = await request(baseUrl, "GET", "/api/v1/backtest");
  assert.equal(backtest.status, 200);
  assert.equal(Array.isArray(backtest.body.rows), true);
  assert.equal(typeof backtest.body.summary.hitRate, "number");

  // Snapshot intake is open (single-owner box) but still validates shape/limits.
  const oversizedPrediction = await request(baseUrl, "POST", "/api/v1/predictions", {
    body: JSON.stringify({ snapshots: "x".repeat(1024 * 1024) }),
  });
  assert.equal(oversizedPrediction.status, 413);

  const predictions = await request(baseUrl, "POST", "/api/v1/predictions", {
    json: [
      validSnapshot("new"),
      validSnapshot("duplicate"),
      { ...validSnapshot("post-kickoff"), savedAt: "2026-07-18T12:00:00.000Z" },
      { ...validSnapshot("browser-unified"), strategyVersion: "unified-buyable-v1" },
    ],
  });
  assert.equal(predictions.status, 200);
  assert.deepEqual(predictions.body, {
    inserted: 1,
    duplicate: 1,
    rejected: 2,
    rejectedByReason: { "post-kickoff": 1, "server-only-strategy": 1 },
  });

  for (const path of ["/api/import/odds-scores", "/api/odds", "/api/hdc-live", "/api/backtest", "/api/predictions", "/health"]) {
    const legacy = await request(baseUrl, path.startsWith("/api/import") || path === "/api/predictions" ? "POST" : "GET", path);
    assert.equal(legacy.status, 404, path);
    assertSafeError(legacy.body);
  }
  assert.equal(fetchCalls.length, 0);
});

test("maps unexpected handler failures to safe 500 json", async (t) => {
  const repositories = createFakeRepositories();
  repositories.odds.listLive = async () => {
    throw new Error("SELECT * FROM secrets at C:\\private\\server.mjs");
  };
  const server = await listen(createApp({
    repositories,
    ownerId: OWNER_ID,
    clock: () => NOW,
    logger: { error() {} },
  }));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const response = await request(baseUrl, "GET", "/api/v1/odds/live");
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: "server_error" });
  assertSafeError(response.body);
});

test("creates, updates and deletes pending bets without auth", async (t) => {
  const repositories = createFakeRepositories();
  const server = await listen(createApp({
    repositories,
    ownerId: OWNER_ID,
    clock: () => NOW,
    logger: { error() {} },
  }));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  assert.equal((await request(baseUrl, "PUT", "/api/v1/bets/bet-1", { json: validBetBody() })).status, 405);

  const created = await request(baseUrl, "POST", "/api/v1/bets", { json: validBetBody() });
  assert.equal(created.status, 201);
  const betId = created.body.bet.id;
  assert.equal(created.body.bet.settlement, "pending");

  const list = await request(baseUrl, "GET", "/api/v1/bets");
  assert.equal(list.status, 200);
  assert.equal(list.body.summary.total, 1);
  assert.equal(list.body.summary.pending, 1);

  const invalid = await request(baseUrl, "PATCH", `/api/v1/bets/${betId}`, { json: { ...validBetBody(), odds: 1 } });
  assert.equal(invalid.status, 400);

  const updated = await request(baseUrl, "PATCH", `/api/v1/bets/${betId}`, { json: { ...validBetBody(), odds: 2.5, stake: 200 } });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.bet.odds, 2.5);
  assert.equal(updated.body.bet.stake, 200);

  assert.equal((await request(baseUrl, "PATCH", "/api/v1/bets/bet-missing", { json: validBetBody() })).status, 404);

  repositories.bets.rows.get(betId).settlement = "won";
  const settledUpdate = await request(baseUrl, "PATCH", `/api/v1/bets/${betId}`, { json: validBetBody() });
  assert.equal(settledUpdate.status, 409);

  const deleted = await request(baseUrl, "DELETE", `/api/v1/bets/${betId}`);
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.body, { deleted: betId });
  assert.equal((await request(baseUrl, "DELETE", `/api/v1/bets/${betId}`)).status, 404);
});

function createFakeRepositories() {
  const rows = [{ matchId: "match-1", market: "totals", actual: "3" }];
  const observations = [{
    id: 1,
    fingerprint: "fingerprint-1",
    firstEvaluatedAt: "2026-07-17T23:40:00.000Z",
    lastEvaluatedAt: "2026-07-17T23:59:00.000Z",
    inputs: [{ bookmaker: "Pinnacle", odds: 2.2 }],
    buyableQuotes: [quote("Pinnacle", 2.2, "2026-07-17T23:30:00.000Z")],
  }];
  return {
    bets: createFakeBets(),
    collectorState: {
      async get(key) {
        assert.equal(key, "hdc-collector");
        return { quotaUsed: 123, quotaRemaining: 377 };
      },
    },
    odds: {
      async listLive(now) {
        assert.equal(now.toISOString(), NOW.toISOString());
        return [{ id: "live-1", matchId: "match-1", market: "totals", odds: 2.1 }];
      },
    },
    results: {
      rows,
      async listAll() { return rows; },
    },
    opportunities: {
      observations,
      async listCurrent(now) {
        assert.equal(now.toISOString(), NOW.toISOString());
        return [
          currentOpportunity(),
          { ...currentOpportunity(), sampleId: 102, fixtureId: "fixture-empty", quotes: [] },
          { ...currentOpportunity(), sampleId: 103, fixtureId: "fixture-stale", lastEvaluatedAt: "2026-07-17T23:14:59.999Z" },
          { ...currentOpportunity(), sampleId: 104, fixtureId: "fixture-past", commenceTime: "2026-07-17T20:00:00.000Z" },
          { ...currentOpportunity(), sampleId: 105, fixtureId: "fixture-stale-quote", quotes: [quote("Pinnacle", 2.2, "2026-07-17T23:13:59.999Z")] },
          {
            ...currentOpportunity(),
            sampleId: 106,
            fixtureId: "fixture-combined-age-stale",
            lastEvaluatedAt: "2026-07-17T23:16:00.000Z",
            quotes: [quote("Pinnacle", 2.2, "2026-07-17T22:32:00.000Z")],
          },
          { ...currentOpportunity(), sampleId: 107, fixtureId: "fixture-future-evaluation", lastEvaluatedAt: "2026-07-18T00:00:00.001Z" },
          { ...currentOpportunity(), sampleId: 108, fixtureId: "fixture-future-quote", quotes: [quote("Pinnacle", 2.2, "2026-07-18T00:00:00.001Z")] },
        ];
      },
      async listObservations(sampleId) {
        assert.equal(sampleId, 101);
        return observations;
      },
      async listForBacktest() { return [validSnapshot("match-1")]; },
    },
    snapshots: {
      async listCurrent() { return [validSnapshot("match-1")]; },
      async insertBatch(snapshots) {
        const rejectedByReason = {};
        let duplicate = 0;
        let inserted = 0;
        for (const snapshot of snapshots) {
          if (snapshot.strategyVersion === "unified-buyable-v1") {
            rejectedByReason["server-only-strategy"] = (rejectedByReason["server-only-strategy"] ?? 0) + 1;
          } else if (Date.parse(snapshot.savedAt) >= Date.parse(snapshot.commenceTime)) {
            rejectedByReason["post-kickoff"] = (rejectedByReason["post-kickoff"] ?? 0) + 1;
          } else if (snapshot.matchId === "duplicate") {
            duplicate += 1;
          } else {
            inserted += 1;
          }
        }
        const rejected = Object.values(rejectedByReason).reduce((sum, count) => sum + count, 0);
        return { inserted, duplicate, rejected, rejectedByReason };
      },
    },
  };
}

function createFakeBets() {
  const rows = new Map();
  let nextId = 1;
  return {
    rows,
    async listByOwner(ownerId) {
      assert.equal(ownerId, OWNER_ID);
      return [...rows.values()];
    },
    async create(ownerId, input) {
      assert.equal(ownerId, OWNER_ID);
      const bet = { id: `bet-${nextId++}`, ...input, settlement: "pending", profit: null };
      rows.set(bet.id, bet);
      return bet;
    },
    async getById(ownerId, id) { return rows.get(id) ?? null; },
    async update(ownerId, id, input) {
      const bet = rows.get(id);
      if (!bet) return null;
      Object.assign(bet, input);
      return bet;
    },
    async remove(ownerId, id) { return rows.delete(id); },
    async settlePendingWithResults() {},
  };
}

function validBetBody() {
  return {
    fixtureId: "fixture-bet",
    matchId: "match-bet",
    homeTeam: "Alpha",
    awayTeam: "Beta",
    commenceTime: "2026-07-18T10:00:00.000Z",
    market: "hdc",
    selection: "home",
    odds: 2.1,
    stake: 100,
  };
}

function currentOpportunity() {
  return {
    sampleId: "101",
    fixtureId: "fixture-current",
    matchId: "match-current",
    homeTeam: "Alpha",
    awayTeam: "Beta",
    league: "Test League",
    commenceTime: "2026-07-18T10:00:00.000Z",
    market: "totals",
    selection: "over",
    line: 2.5,
    modelVersion: "totals-loo-v1",
    strategyVersion: "unified-buyable-v1",
    firstEvaluatedAt: "2026-07-17T23:40:00.000Z",
    lastEvaluatedAt: "2026-07-17T23:59:00.000Z",
    quotes: [
      quote("HKJC", 2.02, "2026-07-17T23:15:00.000Z", "hkjc"),
      quote("Pinnacle", 2.2, "2026-07-17T23:30:00.000Z"),
    ],
  };
}

function quote(bookmaker, odds, observedAt, provider = "the-odds-api") {
  return { bookmaker, provider, odds, chance: 0.5, edge: odds * 0.5 - 1, minimumBuyOdds: 2.06, observedAt };
}

function validSnapshot(matchId) {
  return {
    matchId,
    market: "totals",
    prediction: "大",
    line: 2.5,
    odds: 2,
    chance: 0.55,
    edge: 0.1,
    savedAt: "2026-07-17T12:00:00.000Z",
    commenceTime: "2026-07-18T10:00:00.000Z",
    modelVersion: "totals-loo-v1",
    source: "test",
  };
}

function listen(app) {
  const server = createServer((req, res) => {
    Promise.resolve(app(req, res)).catch(() => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "server_error" }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function request(baseUrl, method, path, { headers = {}, body, json: jsonBody } = {}) {
  const init = { method, headers: { ...headers } };
  if (jsonBody !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(jsonBody);
  } else if (body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = body;
  }
  const response = await (request.fetch ?? globalThis.fetch)(`${baseUrl}${path}`, init);
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: response.status, headers: response.headers, body: parsed, text };
}

function assertSafeError(body) {
  assert.equal(typeof body?.error, "string");
  assert.ok(Object.keys(body).length <= 2, "error body must not leak internals");
  assert.doesNotMatch(JSON.stringify(body), /SELECT|C:\\|at\s+\w+\s+\(/i);
}
