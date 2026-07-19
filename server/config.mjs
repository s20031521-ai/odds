import { parseCidr } from "./http/client-ip.mjs";

export function loadServerConfig(env) {
  const databaseUrl = parseDatabaseUrl(env?.DATABASE_URL);
  const sessionSecret = parseSessionSecret(env?.SESSION_SECRET);
  const publicOrigin = parsePublicOrigin(env?.PUBLIC_ORIGIN);
  const runMigrations = env?.RUN_MIGRATIONS !== "false";
  const trustedProxyCidrs = parseTrustedProxyCidrs(env?.TRUSTED_PROXY_CIDRS);

  return { databaseUrl, sessionSecret, publicOrigin, runMigrations, trustedProxyCidrs };
}

function parseTrustedProxyCidrs(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [];
  }
  return value.split(",").map((entry) => {
    const cidr = entry.trim();
    if (parseCidr(cidr) === null) {
      throw new Error(`TRUSTED_PROXY_CIDRS contains malformed CIDR: ${cidr}`);
    }
    return cidr;
  });
}

function parseDatabaseUrl(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("DATABASE_URL is required");
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }

  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname === "/") {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
  return value;
}

function parseSessionSecret(value) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") < 32) {
    throw new Error("SESSION_SECRET must be at least 32 bytes");
  }
  return value;
}

function parsePublicOrigin(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("PUBLIC_ORIGIN is required");
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("PUBLIC_ORIGIN must be a valid HTTPS origin");
  }

  if (
    url.protocol !== "https:"
    || url.pathname !== "/"
    || url.search
    || url.hash
    || url.username
    || url.password
    || value !== url.origin
  ) {
    throw new Error("PUBLIC_ORIGIN must be a valid HTTPS origin");
  }
  return url.origin;
}
