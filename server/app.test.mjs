import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

import { createApp } from "./app.mjs";

const PUBLIC_ORIGIN = "https://odds.example.test";
const NOW = new Date("2026-07-18T00:00:00.000Z");

test("serves the secure same-origin api/v1 contract", async (t) => {
  const appSource = await readFile(new URL("./app.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(appSource, /child_process|api-football|the-odds-api|hkjc-import|odds-monitor/i);

  const fetchCalls = [];
  const originalFetch = globalThis.fetch;
  request.fetch = originalFetch;
  globalThis.fetch = async (...args) => {
    fetchCalls.push(args);
    throw new Error("provider fetch must not be called");
  };
  t.after(() => { globalThis.fetch = originalFetch; delete request.fetch; });

  const auth = createFakeAuth();
  const repositories = createFakeRepositories();
  const server = await listen(createApp({
    repositories,
    auth,
    publicOrigin: PUBLIC_ORIGIN,
    readinessCheck: async () => ({ ok: true, database: "ok" }),
    clock: () => NOW,
    logger: { error() {} },
  }));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  assert.deepEqual((await request(baseUrl, "GET", "/internal/health/ready")).body, { ok: true, database: "ok" });
  assert.equal((await request(baseUrl, "GET", "/api/v1/auth/login")).status, 405);
  assert.equal((await request(baseUrl, "POST", "/api/v1/session")).status, 405);
  assert.equal((await request(baseUrl, "GET", "/api/v1/unknown")).status, 404);
  assert.equal((await request(baseUrl, "GET", "/unknown")).status, 404);
  assert.equal((await request(baseUrl, "GET", "/api/v1/session")).body.authenticated, false);
  for (const path of ["/api/v1/odds/live", "/api/v1/results", "/api/v1/backtest", "/api/v1/predictions"]) {
    const response = await request(baseUrl, path.endsWith("predictions") ? "POST" : "GET", path);
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { error: "unauthorized" });
    assertNoWildcardCors(response);
  }

  const malformed = await request(baseUrl, "POST", "/api/v1/auth/login", { body: "{" });
  assert.equal(malformed.status, 400);
  assertSafeError(malformed.body);
  const oversizedAuth = await request(baseUrl, "POST", "/api/v1/auth/login", { body: JSON.stringify({ username: "u", password: "x".repeat(17 * 1024) }) });
  assert.equal(oversizedAuth.status, 413);
  assertSafeError(oversizedAuth.body);

  const login = await request(baseUrl, "POST", "/api/v1/auth/login", {
    json: { username: "owner", password: "correct horse battery staple" },
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.authenticated, true);
  assert.equal(login.body.csrfToken, "csrf-login");
  assert.equal(login.body.session.username, "owner");
  assertNoWildcardCors(login);
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /^__Host-odds_session=session-token;/);
  assert.match(cookie, /;\s*Secure(?:;|$)/);
  assert.match(cookie, /;\s*HttpOnly(?:;|$)/);
  assert.match(cookie, /;\s*SameSite=Strict(?:;|$)/);
  assert.match(cookie, /;\s*Path=\/(?:;|$)/);
  assert.doesNotMatch(cookie, /Domain=/i);

  const session = await request(baseUrl, "GET", "/api/v1/session", { cookie });
  assert.equal(session.status, 200);
  assert.equal(session.body.authenticated, true);
  assert.equal(session.body.csrfToken, "csrf-refresh-1");

  assert.equal((await request(baseUrl, "GET", "/api/v1/odds/live", { cookie })).body.entries[0].id, "live-1");
  assert.deepEqual((await request(baseUrl, "GET", "/api/v1/results", { cookie })).body.resultEntries, repositories.results.rows);
  const backtest = await request(baseUrl, "GET", "/api/v1/backtest", { cookie });
  assert.equal(backtest.status, 200);
  assert.equal(Array.isArray(backtest.body.rows), true);
  assert.equal(typeof backtest.body.summary.hitRate, "number");

  const missingOrigin = await request(baseUrl, "POST", "/api/v1/predictions", {
    cookie,
    headers: { "x-csrf-token": "csrf-refresh-1" },
    json: validSnapshot("missing-origin"),
  });
  assert.equal(missingOrigin.status, 403);
  assertSafeError(missingOrigin.body);

  const badCsrf = await request(baseUrl, "POST", "/api/v1/predictions", {
    cookie,
    headers: { origin: PUBLIC_ORIGIN, "x-csrf-token": "wrong" },
    json: validSnapshot("bad-csrf"),
  });
  assert.equal(badCsrf.status, 403);

  const oversizedPrediction = await request(baseUrl, "POST", "/api/v1/predictions", {
    cookie,
    headers: { origin: PUBLIC_ORIGIN, "x-csrf-token": "csrf-refresh-1" },
    body: JSON.stringify({ snapshots: "x".repeat(1024 * 1024) }),
  });
  assert.equal(oversizedPrediction.status, 413);

  const predictions = await request(baseUrl, "POST", "/api/v1/predictions", {
    cookie,
    headers: { origin: PUBLIC_ORIGIN, "x-csrf-token": "csrf-refresh-1" },
    json: [
      validSnapshot("new"),
      validSnapshot("duplicate"),
      { ...validSnapshot("post-kickoff"), savedAt: "2026-07-18T12:00:00.000Z" },
    ],
  });
  assert.equal(predictions.status, 200);
  assert.deepEqual(predictions.body, {
    inserted: 1,
    duplicate: 1,
    rejected: 1,
    rejectedByReason: { "post-kickoff": 1 },
  });

  const logoutWithoutCsrf = await request(baseUrl, "POST", "/api/v1/auth/logout", {
    cookie,
    headers: { origin: PUBLIC_ORIGIN },
  });
  assert.equal(logoutWithoutCsrf.status, 403);

  const logout = await request(baseUrl, "POST", "/api/v1/auth/logout", {
    cookie,
    headers: { origin: PUBLIC_ORIGIN, "x-csrf-token": "csrf-refresh-1" },
  });
  assert.equal(logout.status, 200);
  assert.equal(logout.body.authenticated, false);
  const cleared = logout.headers.get("set-cookie");
  assert.match(cleared, /^__Host-odds_session=;/);
  assert.match(cleared, /Max-Age=0/);
  assert.match(cleared, /;\s*Secure(?:;|$)/);
  assert.match(cleared, /;\s*HttpOnly(?:;|$)/);
  assert.match(cleared, /;\s*SameSite=Strict(?:;|$)/);
  assert.equal((await request(baseUrl, "GET", "/api/v1/odds/live", { cookie })).status, 401);

  for (const path of ["/api/import/odds-scores", "/api/odds", "/api/hdc-live", "/api/backtest", "/api/predictions", "/health"]) {
    const legacy = await request(baseUrl, path.startsWith("/api/import") || path === "/api/predictions" ? "POST" : "GET", path);
    assert.equal(legacy.status, 404, path);
    assertSafeError(legacy.body);
    assertNoWildcardCors(legacy);
  }
  assert.equal(fetchCalls.length, 0);
});

test("maps unexpected handler failures to safe 500 json", async (t) => {
  const repositories = createFakeRepositories();
  repositories.odds.listLive = async () => {
    throw new Error("SELECT * FROM secrets at C:\\private\\server.mjs");
  };
  const auth = createFakeAuth();
  const server = await listen(createApp({
    repositories,
    auth,
    publicOrigin: PUBLIC_ORIGIN,
    clock: () => NOW,
    logger: { error() {} },
  }));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await request(baseUrl, "POST", "/api/v1/auth/login", { json: { username: "owner", password: "password" } });

  const response = await request(baseUrl, "GET", "/api/v1/odds/live", {
    cookie: login.headers.get("set-cookie"),
  });
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: "server_error" });
  assertSafeError(response.body);
});

test("resolves login client ip from X-Forwarded-For only via trusted proxies", async (t) => {
  const repositories = createFakeRepositories();
  const seenClientIps = [];
  const auth = {
    async login({ username, clientIp }) {
      seenClientIps.push(clientIp);
      return {
        ok: true,
        sessionToken: "session-token",
        csrfToken: "csrf-login",
        session: { id: "session-id", username, idleExpiresAt: "2026-08-01T00:00:00.000Z", absoluteExpiresAt: "2026-08-17T00:00:00.000Z" },
      };
    },
  };

  const trusted = await listen(createApp({
    repositories,
    auth,
    publicOrigin: PUBLIC_ORIGIN,
    trustedProxyCidrs: ["127.0.0.0/8"],
    clock: () => NOW,
    logger: { error() {} },
  }));
  t.after(() => new Promise((resolve) => trusted.close(resolve)));
  const trustedUrl = `http://127.0.0.1:${trusted.address().port}`;
  await request(trustedUrl, "POST", "/api/v1/auth/login", {
    json: { username: "owner", password: "password" },
    headers: { "x-forwarded-for": "203.0.113.9" },
  });
  assert.equal(seenClientIps.at(-1), "203.0.113.9", "trusted loopback proxy: leftmost XFF wins");

  const untrusted = await listen(createApp({
    repositories,
    auth,
    publicOrigin: PUBLIC_ORIGIN,
    clock: () => NOW,
    logger: { error() {} },
  }));
  t.after(() => new Promise((resolve) => untrusted.close(resolve)));
  const untrustedUrl = `http://127.0.0.1:${untrusted.address().port}`;
  await request(untrustedUrl, "POST", "/api/v1/auth/login", {
    json: { username: "owner", password: "password" },
    headers: { "x-forwarded-for": "203.0.113.9" },
  });
  assert.equal(seenClientIps.at(-1), "127.0.0.1", "no trusted proxies: spoofed XFF ignored");
});

function createFakeAuth() {
  const sessions = new Map();
  let refreshes = 0;
  return {
    async login({ username }) {
      sessions.set("session-token", { id: "session-id", username, csrf: "csrf-login", revoked: false });
      return {
        ok: true,
        sessionToken: "session-token",
        csrfToken: "csrf-login",
        session: { id: "session-id", username, idleExpiresAt: "2026-08-01T00:00:00.000Z", absoluteExpiresAt: "2026-08-17T00:00:00.000Z" },
      };
    },
    async authenticate(rawToken) {
      const session = sessions.get(rawToken);
      return session && !session.revoked
        ? { id: session.id, username: session.username, idleExpiresAt: "2026-08-01T00:00:00.000Z", absoluteExpiresAt: "2026-08-17T00:00:00.000Z" }
        : null;
    },
    async issueCsrf(sessionId) {
      const session = [...sessions.values()].find((item) => item.id === sessionId);
      if (!session || session.revoked) return null;
      refreshes += 1;
      session.csrf = `csrf-refresh-${refreshes}`;
      return session.csrf;
    },
    async verifyCsrf(sessionId, csrf) {
      return [...sessions.values()].some((session) => session.id === sessionId && !session.revoked && session.csrf === csrf);
    },
    async logout(sessionId) {
      for (const session of sessions.values()) {
        if (session.id === sessionId) session.revoked = true;
      }
    },
  };
}

function createFakeRepositories() {
  const rows = [{ matchId: "match-1", market: "totals", actual: "3" }];
  return {
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
    snapshots: {
      async listCurrent() { return [validSnapshot("match-1")]; },
      async insertBatch(snapshots) {
        const rejectedByReason = {};
        let duplicate = 0;
        let inserted = 0;
        for (const snapshot of snapshots) {
          if (Date.parse(snapshot.savedAt) >= Date.parse(snapshot.commenceTime)) {
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

function validSnapshot(matchId) {
  return {
    matchId,
    market: "totals",
    prediction: "over",
    odds: 2,
    chance: 0.55,
    edge: 0.04,
    savedAt: "2026-07-18T00:00:00.000Z",
    commenceTime: "2026-07-18T10:00:00.000Z",
    modelVersion: "http-test-v1",
    source: "test",
  };
}

function listen(handler) {
  const server = createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    });
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function request(baseUrl, method, path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.cookie) headers.set("cookie", sessionCookie(options.cookie));
  let body = options.body;
  if ("json" in options) {
    body = JSON.stringify(options.json);
    headers.set("content-type", "application/json");
  }
  const response = await (request.fetch ?? fetch)(`${baseUrl}${path}`, { method, headers, body });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null,
  };
}

function sessionCookie(setCookie) {
  return setCookie.split(";")[0];
}

function assertNoWildcardCors(response) {
  assert.notEqual(response.headers.get("access-control-allow-origin"), "*");
}

function assertSafeError(body) {
  const text = JSON.stringify(body);
  assert.doesNotMatch(text, /SELECT|stack|server\.mjs|C:\\|private|DATABASE_URL|SESSION_SECRET|apiKey/i);
}
