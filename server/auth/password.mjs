import { Algorithm, Version, hash, verify } from "@node-rs/argon2";

export const APPROVED_ARGON2_OPTIONS = Object.freeze({
  algorithm: Algorithm.Argon2id,
  version: Version.V0x13,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
});

export const DUMMY_PASSWORD_HASH = "$argon2id$v=19$m=19456,t=2,p=1$UcyQBq/6iimMXlsln/BMEg$L5qwHbqEALP6aOD1ccTCAMAiCsG2CqgtQ7v27hxK5ow";
const APPROVED_PASSWORD_HASH_PATTERN = /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/u;

export function normalizeUsername(value) {
  if (typeof value !== "string") throw new TypeError("username is invalid");
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 128 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new TypeError("username is invalid");
  }
  return normalized;
}

export function validatePassword(password) {
  if (typeof password !== "string" || [...password].length < 14) {
    throw new TypeError("password must contain at least 14 Unicode characters");
  }
  return password;
}

export async function hashPassword(password) {
  return hash(validatePassword(password), APPROVED_ARGON2_OPTIONS);
}

export async function verifyPassword(encodedHash, password) {
  if (typeof encodedHash !== "string" || typeof password !== "string") return false;
  try {
    return await verify(encodedHash, password);
  } catch {
    return false;
  }
}

export function isApprovedPasswordHash(encodedHash) {
  return typeof encodedHash === "string" && APPROVED_PASSWORD_HASH_PATTERN.test(encodedHash);
}
