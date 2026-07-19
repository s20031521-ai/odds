import { randomBytes as nodeRandomBytes, randomUUID } from "node:crypto";

import { withTransaction } from "../db/pool.mjs";
import { DUMMY_PASSWORD_HASH, isApprovedPasswordHash, normalizeUsername, verifyPassword } from "./password.mjs";
import {
  activeCooldown,
  clearThrottleScopes,
  lockThrottleScopes,
  recordThrottleFailure,
  throttleScopeKeys,
  validateThrottleSecret,
} from "./login-throttle.mjs";
import {
  constantTimeDigestMatches,
  generateOpaqueToken,
  isSessionValid,
  sessionTimes,
  sha256Digest,
  slideIdleExpiry,
} from "./session.mjs";

const INVALID_LOGIN = Object.freeze({ ok: false, reason: "invalid_credentials" });

export function createAuthService({
  pool,
  clock = () => new Date(),
  randomBytes = nodeRandomBytes,
  throttleSecret,
  passwordVerifier = verifyPassword,
} = {}) {
  if (!pool?.connect || !pool?.query) throw new TypeError("pool is required");
  const approvedThrottleSecret = validateThrottleSecret(throttleSecret);

  async function login({ username, password, clientIp } = {}) {
    let normalizedUsername;
    try { normalizedUsername = normalizeUsername(username); } catch { normalizedUsername = "<invalid>"; }
    const normalizedIp = typeof clientIp === "string" && clientIp.trim() ? clientIp.trim() : "<invalid>";
    const scopes = throttleScopeKeys(approvedThrottleSecret, normalizedUsername, normalizedIp);
    const now = new Date(clock());

    return withTransaction(pool, async (client) => {
      const throttleRows = await lockThrottleScopes(client, scopes, now);
      const retryAfterSeconds = activeCooldown(throttleRows, now);
      if (retryAfterSeconds !== null) return rateLimited(retryAfterSeconds);

      const ownerResult = normalizedUsername === "<invalid>"
        ? { rows: [] }
        : await client.query(
          "SELECT id, username, password_hash, disabled_at FROM owners WHERE username = $1",
          [normalizedUsername],
        );
      const owner = ownerResult.rows[0] ?? null;
      const usableOwner = owner && !owner.disabled_at && isApprovedPasswordHash(owner.password_hash);
      const hashToVerify = usableOwner ? owner.password_hash : DUMMY_PASSWORD_HASH;
      const passwordValid = await passwordVerifier(hashToVerify, typeof password === "string" ? password : "");

      if (!usableOwner || !passwordValid) {
        const cooldown = await recordThrottleFailure(client, throttleRows, now);
        return cooldown === null ? { ...INVALID_LOGIN } : rateLimited(cooldown);
      }

      await clearThrottleScopes(client, scopes);
      const sessionToken = generateOpaqueToken(randomBytes);
      const csrfToken = generateOpaqueToken(randomBytes);
      const id = randomUUID();
      const { createdAt, idleExpiresAt, absoluteExpiresAt } = sessionTimes(now);
      await client.query(`
        INSERT INTO sessions (
          id, owner_id, token_hash, csrf_hash, created_at, last_seen_at,
          idle_expires_at, absolute_expires_at, revoked_at
        ) VALUES ($1, $2, $3, $4, $5, $5, $6, $7, NULL)
      `, [id, owner.id, sha256Digest(sessionToken), sha256Digest(csrfToken), createdAt, idleExpiresAt, absoluteExpiresAt]);

      return {
        ok: true,
        sessionToken,
        csrfToken,
        session: {
          id,
          username: owner.username,
          idleExpiresAt: idleExpiresAt.toISOString(),
          absoluteExpiresAt: absoluteExpiresAt.toISOString(),
        },
      };
    });
  }

  async function authenticate(rawToken) {
    if (typeof rawToken !== "string" || !rawToken) return null;
    const tokenHash = sha256Digest(rawToken);
    const now = new Date(clock());
    return withTransaction(pool, async (client) => {
      const result = await client.query(`
        SELECT sessions.*, owners.username, owners.disabled_at
        FROM sessions JOIN owners ON owners.id = sessions.owner_id
        WHERE sessions.token_hash = $1
        FOR UPDATE OF sessions
      `, [tokenHash]);
      const row = result.rows[0];
      if (!row || !isSessionValid(row, now)) return null;
      const idleExpiresAt = slideIdleExpiry(now, row.absolute_expires_at);
      await client.query(
        "UPDATE sessions SET last_seen_at = $2, idle_expires_at = $3 WHERE id = $1",
        [row.id, now, idleExpiresAt],
      );
      return sessionContext(row, idleExpiresAt);
    });
  }

  async function issueCsrf(sessionId) {
    if (typeof sessionId !== "string") return null;
    const now = new Date(clock());
    return withTransaction(pool, async (client) => {
      const result = await client.query(`
        SELECT sessions.*, owners.username, owners.disabled_at
        FROM sessions JOIN owners ON owners.id = sessions.owner_id
        WHERE sessions.id = $1
        FOR UPDATE OF sessions
      `, [sessionId]);
      const row = result.rows[0];
      if (!row || !isSessionValid(row, now)) return null;
      const token = generateOpaqueToken(randomBytes);
      await client.query("UPDATE sessions SET csrf_hash = $2 WHERE id = $1", [sessionId, sha256Digest(token)]);
      return token;
    });
  }

  async function verifyCsrf(sessionId, rawCsrfToken) {
    if (typeof sessionId !== "string" || typeof rawCsrfToken !== "string") return false;
    const now = new Date(clock());
    const result = await pool.query(`
      SELECT sessions.*, owners.disabled_at
      FROM sessions JOIN owners ON owners.id = sessions.owner_id
      WHERE sessions.id = $1
    `, [sessionId]);
    const row = result.rows[0];
    return Boolean(row && isSessionValid(row, now) && constantTimeDigestMatches(row.csrf_hash, rawCsrfToken));
  }

  async function logout(sessionId) {
    if (typeof sessionId !== "string") return;
    const now = new Date(clock());
    await pool.query("UPDATE sessions SET revoked_at = COALESCE(revoked_at, $2) WHERE id = $1", [sessionId, now]);
  }

  return Object.freeze({ login, authenticate, issueCsrf, verifyCsrf, logout });
}

function rateLimited(retryAfterSeconds) {
  return { ok: false, reason: "rate_limited", retryAfterSeconds };
}

function sessionContext(row, idleExpiresAt) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    username: row.username,
    idleExpiresAt: idleExpiresAt.toISOString(),
    absoluteExpiresAt: row.absolute_expires_at.toISOString(),
  };
}
