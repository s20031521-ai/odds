import { createHash, randomBytes as nodeRandomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_BYTES = 32;
export const IDLE_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
export const ABSOLUTE_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export function generateOpaqueToken(randomBytes = nodeRandomBytes) {
  const bytes = randomBytes(SESSION_BYTES);
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw new TypeError("random byte source returned an invalid value");
  }
  const copy = Buffer.from(bytes);
  if (copy.length !== SESSION_BYTES) throw new TypeError("random byte source returned an invalid length");
  return copy.toString("base64url");
}

export function sha256Digest(value) {
  return createHash("sha256").update(String(value), "utf8").digest();
}

export function constantTimeDigestMatches(storedDigest, rawValue) {
  const candidate = sha256Digest(rawValue);
  const stored = Buffer.isBuffer(storedDigest) ? storedDigest : Buffer.from(storedDigest ?? []);
  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}

export function sessionTimes(now) {
  const createdAt = new Date(now);
  const absoluteExpiresAt = new Date(createdAt.getTime() + ABSOLUTE_DURATION_MS);
  const idleExpiresAt = new Date(Math.min(createdAt.getTime() + IDLE_DURATION_MS, absoluteExpiresAt.getTime()));
  return { createdAt, idleExpiresAt, absoluteExpiresAt };
}

export function slideIdleExpiry(now, absoluteExpiresAt) {
  return new Date(Math.min(new Date(now).getTime() + IDLE_DURATION_MS, new Date(absoluteExpiresAt).getTime()));
}

export function isSessionValid(row, now) {
  const timestamp = new Date(now).getTime();
  return !row.revoked_at
    && !row.disabled_at
    && timestamp < new Date(row.idle_expires_at).getTime()
    && timestamp < new Date(row.absolute_expires_at).getTime();
}
