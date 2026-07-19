import { createHmac } from "node:crypto";

export const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
export const THROTTLE_COOLDOWN_MS = 30 * 60 * 1000;
export const THROTTLE_FAILURE_LIMIT = 5;

export function validateThrottleSecret(secret) {
  const bytes = typeof secret === "string" ? Buffer.from(secret, "utf8") : Buffer.from(secret ?? []);
  if (bytes.length < 32) throw new TypeError("throttle secret must contain at least 32 bytes");
  return bytes;
}

export function throttleScopeKey(secret, kind, value) {
  const bytes = validateThrottleSecret(secret);
  return createHmac("sha256", bytes).update(`${kind}\0${String(value)}`, "utf8").digest("hex");
}

export function throttleScopeKeys(secret, username, clientIp) {
  return [
    throttleScopeKey(secret, "account", username),
    throttleScopeKey(secret, "ip", clientIp),
  ].sort();
}

export async function lockThrottleScopes(client, scopeKeys, now) {
  for (const scopeKey of scopeKeys) {
    await client.query(`
      INSERT INTO login_attempts (scope_key, failed_count, window_started_at, blocked_until)
      VALUES ($1, 0, $2, NULL)
      ON CONFLICT (scope_key) DO NOTHING
    `, [scopeKey, now]);
  }
  const result = await client.query(`
    SELECT scope_key, failed_count, window_started_at, blocked_until
    FROM login_attempts
    WHERE scope_key = ANY($1::text[])
    ORDER BY scope_key
    FOR UPDATE
  `, [scopeKeys]);
  return result.rows;
}

export function activeCooldown(rows, now) {
  const nowMs = new Date(now).getTime();
  const active = rows
    .map(({ blocked_until }) => blocked_until && new Date(blocked_until))
    .filter((value) => value && value.getTime() > nowMs)
    .sort((left, right) => right - left)[0];
  if (!active) return null;
  return Math.max(1, Math.ceil((active.getTime() - nowMs) / 1000));
}

export async function recordThrottleFailure(client, rows, now) {
  const nowDate = new Date(now);
  let cooldownSeconds = null;
  for (const row of rows) {
    const newWindow = nowDate.getTime() >= new Date(row.window_started_at).getTime() + THROTTLE_WINDOW_MS;
    const failedCount = newWindow ? 1 : row.failed_count + 1;
    const windowStartedAt = newWindow ? nowDate : row.window_started_at;
    const blockedUntil = failedCount >= THROTTLE_FAILURE_LIMIT
      ? new Date(nowDate.getTime() + THROTTLE_COOLDOWN_MS)
      : null;
    await client.query(`
      UPDATE login_attempts
      SET failed_count = $2, window_started_at = $3, blocked_until = $4
      WHERE scope_key = $1
    `, [row.scope_key, failedCount, windowStartedAt, blockedUntil]);
    if (blockedUntil) cooldownSeconds = THROTTLE_COOLDOWN_MS / 1000;
  }
  return cooldownSeconds;
}

export async function clearThrottleScopes(client, scopeKeys) {
  await client.query("DELETE FROM login_attempts WHERE scope_key = ANY($1::text[])", [scopeKeys]);
}
