import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  APPROVED_ARGON2_OPTIONS,
  DUMMY_PASSWORD_HASH,
  hashPassword,
  isApprovedPasswordHash,
  normalizeUsername,
  verifyPassword,
} from "./password.mjs";
import { createAuthService } from "./auth-service.mjs";
import { throttleScopeKeys } from "./login-throttle.mjs";
import { sha256Digest } from "./session.mjs";
import { runBenchmark } from "../../scripts/benchmark-password.mjs";
import { runCreateOwner } from "../../scripts/create-owner.mjs";
import { createPool } from "../db/pool.mjs";
import { runMigrations } from "../db/migrate.mjs";

const DATABASE_URL = process.env.DATABASE_URL;
const EXPECTED_DATABASE_URL = "postgresql://odds_test:odds_test@127.0.0.1:55432/odds_test";
const MIGRATIONS_DIR = path.resolve("db/migrations");
const HMAC_SECRET = Buffer.alloc(32, 0x5a);
const VALID_PASSWORD = "correct horse battery staple";

test("password policy counts Unicode characters and hashes with the exact approved Argon2id parameters", async () => {
  assert.equal(Object.isFrozen(APPROVED_ARGON2_OPTIONS), true);
  assert.deepEqual(APPROVED_ARGON2_OPTIONS, {
    algorithm: 2,
    version: 1,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
  });
  await assert.rejects(hashPassword("😀".repeat(13)), /14 Unicode characters/);
  const encoded = await hashPassword("😀".repeat(14));
  assert.match(encoded, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  assert.equal(await verifyPassword(encoded, "😀".repeat(14)), true);
  assert.equal(await verifyPassword(encoded, "wrong password value"), false);
  assert.equal(await verifyPassword("not-an-argon-hash", "wrong password value"), false);
  assert.equal(isApprovedPasswordHash(encoded), true);
  assert.equal(isApprovedPasswordHash("not-an-argon-hash"), false);
  assert.match(DUMMY_PASSWORD_HASH, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  assert.equal(normalizeUsername("  OwNeR  "), "owner");
  assert.throws(() => normalizeUsername("   "), /username/i);
});

test("password benchmark accepts no password and discloses only approved configuration and elapsed time", async () => {
  const lines = [];
  let received;
  const code = await runBenchmark({
    argv: [],
    randomBytes: () => Buffer.from("throwaway-benchmark-secret-material"),
    hash: async (value) => { received = value; return "encoded"; },
    now: (() => { const values = [100, 142]; return () => values.shift(); })(),
    stdout: (line) => lines.push(line),
    stderr: (line) => lines.push(line),
  });
  assert.equal(code, 0);
  assert.equal(typeof received, "string");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^algorithm=argon2id version=19 memoryKiB=19456 timeCost=2 parallelism=1 outputBytes=32 elapsedMs=42$/);
  assert.equal(lines[0].includes(received), false);
  assert.equal(await runBenchmark({ argv: ["plaintext"], stdout: (line) => lines.push(line), stderr: (line) => lines.push(line) }), 1);
  assert.equal(lines.at(-1), "status=failed");
});

test("missing, wrong-password, and disabled-owner login use one generic result and one real verification path", async (t) => {
  await withIsolatedDatabase(t, async (pool) => {
    const clock = mutableClock("2026-07-18T00:00:00.000Z");
    const calls = [];
    const service = createAuthService({
      pool, clock, throttleSecret: HMAC_SECRET,
      passwordVerifier: async (hash, password) => { calls.push({ hash, password }); return verifyPassword(hash, password); },
    });

    assert.deepEqual(await service.login({ username: "missing", password: VALID_PASSWORD, clientIp: "203.0.113.10" }), invalidLogin());
    assert.equal(calls.length, 1);
    assert.equal(calls[0].hash, DUMMY_PASSWORD_HASH);

    const owner = await insertOwner(pool, "owner", VALID_PASSWORD);
    calls.length = 0;
    assert.deepEqual(await service.login({ username: " OWNER ", password: "definitely wrong password", clientIp: "203.0.113.11" }), invalidLogin());
    assert.equal(calls.length, 1);
    assert.notEqual(calls[0].hash, DUMMY_PASSWORD_HASH);

    await pool.query("UPDATE owners SET disabled_at = $1 WHERE id = $2", [clock(), owner.id]);
    calls.length = 0;
    assert.deepEqual(await service.login({ username: "owner", password: VALID_PASSWORD, clientIp: "203.0.113.12" }), invalidLogin());
    assert.equal(calls.length, 1);
    assert.equal(calls[0].hash, DUMMY_PASSWORD_HASH);

    await pool.query("DELETE FROM sessions; DELETE FROM owners; DELETE FROM login_attempts");
    await pool.query("ALTER TABLE owners DROP CONSTRAINT owners_password_hash_approved");
    await pool.query(
      "INSERT INTO owners (id, username, password_hash, created_at) VALUES ($1, $2, $3, $4)",
      [randomUUID(), "corrupt", "not-an-argon-hash", clock()],
    );
    calls.length = 0;
    assert.deepEqual(await service.login({ username: "corrupt", password: VALID_PASSWORD, clientIp: "203.0.113.13" }), invalidLogin());
    assert.equal(calls.length, 1);
    assert.equal(calls[0].hash, DUMMY_PASSWORD_HASH);
  });
});

test("account and IP throttles use HMAC-only keys with exact window and cooldown boundaries", async (t) => {
  await withIsolatedDatabase(t, async (pool) => {
    const clock = mutableClock("2026-07-18T00:00:00.000Z");
    const service = createAuthService({ pool, clock, throttleSecret: HMAC_SECRET });
    await insertOwner(pool, "owner", VALID_PASSWORD);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      assert.deepEqual(await service.login({ username: "owner", password: "wrong password value", clientIp: `203.0.113.${attempt}` }), invalidLogin());
    }
    assert.deepEqual(await service.login({ username: "owner", password: "wrong password value", clientIp: "203.0.113.5" }), throttled(1800));
    const stored = await pool.query("SELECT scope_key, failed_count, blocked_until FROM login_attempts ORDER BY scope_key");
    assert.equal(stored.rows.some(({ scope_key }) => scope_key.includes("owner") || scope_key.includes("203.0.113")), false);
    assert.equal(stored.rows.every(({ scope_key }) => /^[a-f0-9]{64}$/.test(scope_key)), true);

    clock.set("2026-07-18T00:30:00.000Z");
    const success = await service.login({ username: "owner", password: VALID_PASSWORD, clientIp: "203.0.113.5" });
    assert.equal(success.ok, true);
    assert.deepEqual(Object.keys(success).sort(), ["csrfToken", "ok", "session", "sessionToken"]);
    const accountAndIpCleared = await pool.query("SELECT count(*)::integer AS count FROM login_attempts");
    assert.deepEqual(accountAndIpCleared.rows, [{ count: 4 }]);
    const clearedKeys = throttleScopeKeys(HMAC_SECRET, "owner", "203.0.113.5");
    const currentScopes = await pool.query("SELECT scope_key FROM login_attempts WHERE scope_key = ANY($1::text[])", [clearedKeys]);
    assert.equal(currentScopes.rowCount, 0);

    clock.set("2026-07-18T01:00:00.000Z");
    assert.deepEqual(await service.login({ username: "nobody", password: "wrong password value", clientIp: "198.51.100.7" }), invalidLogin());
    clock.set("2026-07-18T01:15:00.000Z");
    assert.deepEqual(await service.login({ username: "nobody", password: "wrong password value", clientIp: "198.51.100.7" }), invalidLogin());
    const resetRows = await pool.query("SELECT failed_count FROM login_attempts WHERE failed_count > 0 ORDER BY failed_count DESC");
    assert.equal(resetRows.rows.every(({ failed_count }) => failed_count <= 1), true);
  });
});

test("concurrent failures serialize and the fifth request establishes cooldown", async (t) => {
  await withIsolatedDatabase(t, async (pool) => {
    const clock = mutableClock("2026-07-18T00:00:00.000Z");
    const service = createAuthService({ pool, clock, throttleSecret: HMAC_SECRET });
    await insertOwner(pool, "owner", VALID_PASSWORD);
    const results = await Promise.all(Array.from({ length: 5 }, () => (
      service.login({ username: "owner", password: "wrong password value", clientIp: "192.0.2.8" })
    )));
    assert.equal(results.filter(({ reason }) => reason === "rate_limited").length, 1);
    const attempts = await pool.query("SELECT failed_count, blocked_until FROM login_attempts ORDER BY scope_key");
    assert.equal(attempts.rowCount, 2);
    assert.equal(attempts.rows.every(({ failed_count, blocked_until }) => failed_count === 5 && blocked_until?.toISOString() === "2026-07-18T00:30:00.000Z"), true);
  });
});

test("sessions return independent opaque tokens while storing only digests", async (t) => {
  await withIsolatedDatabase(t, async (pool) => {
    const clock = mutableClock("2026-07-18T00:00:00.000Z");
    const service = createAuthService({ pool, clock, throttleSecret: HMAC_SECRET });
    await insertOwner(pool, "owner", VALID_PASSWORD);
    const login = await service.login({ username: "owner", password: VALID_PASSWORD, clientIp: "203.0.113.20" });
    assert.equal(login.ok, true);
    assert.match(login.sessionToken, /^[A-Za-z0-9_-]{43}$/);
    assert.match(login.csrfToken, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(login.sessionToken, login.csrfToken);
    assert.deepEqual(Object.keys(login.session).sort(), ["absoluteExpiresAt", "id", "idleExpiresAt", "username"]);

    const stored = await pool.query("SELECT token_hash, csrf_hash FROM sessions WHERE id = $1", [login.session.id]);
    assert.equal(stored.rowCount, 1);
    assert.deepEqual(stored.rows[0].token_hash, sha256Digest(login.sessionToken));
    assert.deepEqual(stored.rows[0].csrf_hash, sha256Digest(login.csrfToken));
    assert.equal(JSON.stringify(stored.rows).includes(login.sessionToken), false);
    assert.equal(JSON.stringify(stored.rows).includes(login.csrfToken), false);
  });
});

test("authentication slides idle expiry to the absolute cap and rejects exact boundaries or disabled owners", async (t) => {
  await withIsolatedDatabase(t, async (pool) => {
    const clock = mutableClock("2026-07-01T00:00:00.000Z");
    const service = createAuthService({ pool, clock, throttleSecret: HMAC_SECRET });
    const owner = await insertOwner(pool, "owner", VALID_PASSWORD);
    const login = await service.login({ username: "owner", password: VALID_PASSWORD, clientIp: "203.0.113.21" });

    clock.set("2026-07-14T00:00:00.000Z");
    const session = await service.authenticate(login.sessionToken);
    assert.equal(session.id, login.session.id);
    assert.equal(session.idleExpiresAt, "2026-07-28T00:00:00.000Z");
    let stored = await pool.query("SELECT last_seen_at, idle_expires_at FROM sessions WHERE id = $1", [session.id]);
    assert.equal(stored.rows[0].last_seen_at.toISOString(), "2026-07-14T00:00:00.000Z");

    clock.set("2026-07-25T00:00:00.000Z");
    const capped = await service.authenticate(login.sessionToken);
    assert.equal(capped.idleExpiresAt, "2026-07-31T00:00:00.000Z");
    assert.equal(capped.absoluteExpiresAt, "2026-07-31T00:00:00.000Z");
    clock.set("2026-07-31T00:00:00.000Z");
    assert.equal(await service.authenticate(login.sessionToken), null);

    const second = await service.login({ username: "owner", password: VALID_PASSWORD, clientIp: "203.0.113.22" });
    await pool.query("UPDATE owners SET disabled_at = $1 WHERE id = $2", [clock(), owner.id]);
    assert.equal(await service.authenticate(second.sessionToken), null);
  });
});

test("authentication rejects the exact idle-expiry boundary", async (t) => {
  await withIsolatedDatabase(t, async (pool) => {
    const clock = mutableClock("2026-07-01T00:00:00.000Z");
    const service = createAuthService({ pool, clock, throttleSecret: HMAC_SECRET });
    await insertOwner(pool, "owner", VALID_PASSWORD);
    const login = await service.login({ username: "owner", password: VALID_PASSWORD, clientIp: "203.0.113.23" });
    clock.set("2026-07-15T00:00:00.000Z");
    assert.equal(await service.authenticate(login.sessionToken), null);
  });
});

test("CSRF rotation is session-bound and logout revokes idempotently", async (t) => {
  await withIsolatedDatabase(t, async (pool) => {
    const clock = mutableClock("2026-07-18T00:00:00.000Z");
    const service = createAuthService({ pool, clock, throttleSecret: HMAC_SECRET });
    await insertOwner(pool, "owner", VALID_PASSWORD);
    const login = await service.login({ username: "owner", password: VALID_PASSWORD, clientIp: "203.0.113.30" });
    assert.equal(await service.verifyCsrf(login.session.id, login.csrfToken), true);
    assert.equal(await service.verifyCsrf(login.session.id, "A".repeat(43)), false);
    const rotated = await service.issueCsrf(login.session.id);
    assert.match(rotated, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(rotated, login.csrfToken);
    assert.equal(await service.verifyCsrf(login.session.id, login.csrfToken), false);
    assert.equal(await service.verifyCsrf(login.session.id, rotated), true);
    await service.logout(login.session.id);
    await service.logout(login.session.id);
    assert.equal(await service.authenticate(login.sessionToken), null);
    assert.equal(await service.issueCsrf(login.session.id), null);
    assert.equal(await service.verifyCsrf(login.session.id, rotated), false);
  });
});

test("owner bootstrap supports password files and injected hidden prompts, refuses argv/existing owners, and is concurrency-safe", async (t) => {
  await withIsolatedDatabase(t, async (pool, scopedDatabaseUrl) => {
    const directory = await mkdtemp(path.join(tmpdir(), "odds-owner-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const passwordFile = path.join(directory, "owner-password");
    await writeFile(passwordFile, `${VALID_PASSWORD}\r\n`, { mode: 0o600 });
    const output = [];
    const base = {
      argv: [], poolFactory: () => pool, closePool: false,
      stdout: (line) => output.push(line), stderr: (line) => output.push(line),
    };
    assert.equal(await runCreateOwner({ ...base, env: { DATABASE_URL: scopedDatabaseUrl, OWNER_USERNAME: " Owner ", OWNER_PASSWORD_FILE: passwordFile } }), 0);
    assert.equal(output.at(-1), "status=created");
    assert.equal(output.join("\n").includes(VALID_PASSWORD), false);
    assert.equal(await runCreateOwner({ ...base, env: { DATABASE_URL: scopedDatabaseUrl, OWNER_USERNAME: "other", OWNER_PASSWORD_FILE: passwordFile } }), 1);
    assert.equal(output.at(-1), "status=failed");
    assert.equal(await runCreateOwner({ ...base, argv: [VALID_PASSWORD], env: { DATABASE_URL: scopedDatabaseUrl, OWNER_USERNAME: "other", OWNER_PASSWORD_FILE: passwordFile } }), 1);

    await pool.query("DELETE FROM sessions; DELETE FROM owners");
    let promptCount = 0;
    assert.equal(await runCreateOwner({
      ...base,
      env: { DATABASE_URL: scopedDatabaseUrl, OWNER_USERNAME: "prompted" },
      promptPassword: async () => { promptCount += 1; return VALID_PASSWORD; },
    }), 0);
    assert.equal(promptCount, 1);

    await pool.query("DELETE FROM sessions; DELETE FROM owners");
    const attempts = await Promise.all([
      runCreateOwner({ ...base, env: { DATABASE_URL: scopedDatabaseUrl, OWNER_USERNAME: "first", OWNER_PASSWORD_FILE: passwordFile } }),
      runCreateOwner({ ...base, env: { DATABASE_URL: scopedDatabaseUrl, OWNER_USERNAME: "second", OWNER_PASSWORD_FILE: passwordFile } }),
    ]);
    assert.deepEqual(attempts.sort(), [0, 1]);
    assert.deepEqual((await pool.query("SELECT count(*)::integer AS count FROM owners")).rows, [{ count: 1 }]);
  });
});

test("owner bootstrap sanitizes construction and cleanup failures without leaking secrets or paths", async () => {
  const secretUrl = "postgresql://private_user:private_password@hidden/private_db";
  const secretPath = "C:\\private\\owner-password";
  for (const { poolFactory, expectedCode, expectedLine } of [
    {
      expectedCode: 1,
      expectedLine: "status=failed",
      poolFactory: () => { throw new Error(`construction leaked ${secretUrl}`); },
    },
    {
      expectedCode: 0,
      expectedLine: "status=created",
      poolFactory: () => ({
      async connect() {
        return {
          async query(sql) {
            if (sql === "SELECT id FROM owners LIMIT 1") return { rowCount: 0 };
            return { rowCount: 1 };
          },
          release() {},
        };
      },
      async end() { throw new Error(`cleanup leaked ${secretPath}`); },
      }),
    },
  ]) {
    const lines = [];
    const code = await runCreateOwner({
      argv: [],
      env: { DATABASE_URL: secretUrl, OWNER_USERNAME: "owner", OWNER_PASSWORD_FILE: secretPath },
      readPasswordFile: async () => VALID_PASSWORD,
      poolFactory,
      stdout: (line) => lines.push(line),
      stderr: (line) => lines.push(line),
    });
    assert.equal(code, expectedCode);
    assert.deepEqual(lines, [expectedLine]);
    const output = lines.join("\n");
    for (const forbidden of [secretUrl, "private_user", "private_password", secretPath, VALID_PASSWORD, "Error:", "at "]) {
      assert.equal(output.includes(forbidden), false);
    }
  }
});

test("owner bootstrap keeps failures sanitized when rollback and client release also fail", async () => {
  const lines = [];
  const code = await runCreateOwner({
    argv: [],
    env: { DATABASE_URL: "postgresql://hidden/hidden", OWNER_USERNAME: "owner", OWNER_PASSWORD_FILE: "hidden-file" },
    readPasswordFile: async () => VALID_PASSWORD,
    poolFactory: () => ({
      async connect() {
        return {
          async query(sql) {
            if (sql === "SELECT pg_advisory_xact_lock($1)") throw new Error("primary secret");
            if (sql === "ROLLBACK") throw new Error("rollback secret");
            return { rowCount: 0 };
          },
          release() { throw new Error("release secret"); },
        };
      },
      async end() { throw new Error("end secret"); },
    }),
    stdout: (line) => lines.push(line),
    stderr: (line) => lines.push(line),
  });
  assert.equal(code, 1);
  assert.deepEqual(lines, ["status=failed"]);
});

test("owner bootstrap reports success once the owner commit is durable", async () => {
  const lines = [];
  const queries = [];
  const code = await runCreateOwner({
    argv: [],
    env: { DATABASE_URL: "postgresql://hidden/hidden", OWNER_USERNAME: "owner", OWNER_PASSWORD_FILE: "hidden-file" },
    readPasswordFile: async () => VALID_PASSWORD,
    poolFactory: () => ({
      async connect() {
        return {
          async query(sql) {
            queries.push(sql);
            if (sql === "SELECT id FROM owners LIMIT 1") return { rowCount: 0 };
            return { rowCount: 1 };
          },
          release() { throw new Error("release secret"); },
        };
      },
      async end() { throw new Error("end secret"); },
    }),
    stdout: (line) => lines.push(line),
    stderr: (line) => lines.push(line),
  });
  assert.equal(code, 0);
  assert.equal(queries.includes("COMMIT"), true);
  assert.deepEqual(lines, ["status=created"]);

  const outputFailureLines = [];
  const outputFailureCode = await runCreateOwner({
    argv: [],
    env: { DATABASE_URL: "postgresql://hidden/hidden", OWNER_USERNAME: "owner", OWNER_PASSWORD_FILE: "hidden-file" },
    readPasswordFile: async () => VALID_PASSWORD,
    poolFactory: () => ({
      async connect() {
        return {
          async query(sql) {
            if (sql === "SELECT id FROM owners LIMIT 1") return { rowCount: 0 };
            return { rowCount: 1 };
          },
          release() {},
        };
      },
      async end() {},
    }),
    stdout: () => { throw new Error("stdout secret"); },
    stderr: (line) => outputFailureLines.push(line),
  });
  assert.equal(outputFailureCode, 0);
  assert.deepEqual(outputFailureLines, []);
});

function invalidLogin() { return { ok: false, reason: "invalid_credentials" }; }
function throttled(retryAfterSeconds) { return { ok: false, reason: "rate_limited", retryAfterSeconds }; }

function mutableClock(initial) {
  let value = new Date(initial);
  const clock = () => new Date(value);
  clock.set = (next) => { value = new Date(next); };
  return clock;
}

async function insertOwner(pool, username, password) {
  const owner = { id: randomUUID(), username: normalizeUsername(username) };
  await pool.query(
    "INSERT INTO owners (id, username, password_hash, created_at) VALUES ($1, $2, $3, $4)",
    [owner.id, owner.username, await hashPassword(password), new Date("2026-01-01T00:00:00.000Z")],
  );
  return owner;
}

async function withIsolatedDatabase(t, callback) {
  assert.equal(DATABASE_URL, EXPECTED_DATABASE_URL, "DATABASE_URL must be the approved disposable database");
  const adminPool = createPool(DATABASE_URL);
  const schema = `task5_${randomUUID().replaceAll("-", "")}`;
  const quoted = `"${schema}"`;
  let pool;
  t.after(async () => {
    let primary;
    try { if (pool) await pool.end(); } catch (error) { primary = error; }
    try { await adminPool.query(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`); } catch (error) { primary ??= error; }
    try { await adminPool.end(); } catch (error) { primary ??= error; }
    if (primary) throw primary;
  });
  await adminPool.query(`CREATE SCHEMA ${quoted}`);
  const scopedUrl = new URL(DATABASE_URL);
  scopedUrl.searchParams.set("options", `-c search_path=${schema}`);
  pool = createPool(scopedUrl.toString());
  await runMigrations(pool, MIGRATIONS_DIR);
  await callback(pool, scopedUrl.toString());
}
