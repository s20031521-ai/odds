// Client IP resolution behind trusted reverse proxies.
//
// The API only ever sees a proxy (caddy) as its direct peer. X-Forwarded-For
// is honored only when the socket peer falls inside a trusted CIDR; anything
// else is treated as spoofing and the socket address is used instead.
// IPv4 only: Docker networks are IPv4 by default, and config validation
// rejects anything else up front.

const IPV4_MAPPED_PREFIX = "::ffff:";

export function normalizeIp(value) {
  if (typeof value !== "string") {
    return null;
  }
  let candidate = value.trim();
  if (candidate.startsWith(IPV4_MAPPED_PREFIX)) {
    candidate = candidate.slice(IPV4_MAPPED_PREFIX.length);
  }
  const parts = candidate.split(".");
  if (parts.length !== 4) {
    return null;
  }
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (octet > 255) {
      return null;
    }
  }
  return candidate;
}

export function parseCidr(value) {
  if (typeof value !== "string") {
    return null;
  }
  const match = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const base = normalizeIp(match[1]);
  if (base === null) {
    return null;
  }
  const bits = Number(match[2]);
  if (bits > 32) {
    return null;
  }
  return { base, bits };
}

function ipToInt(ip) {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

export function isIpInCidr(ip, cidr) {
  const normalized = normalizeIp(ip);
  const parsed = parseCidr(cidr);
  if (normalized === null || parsed === null) {
    return false;
  }
  if (parsed.bits === 0) {
    return true;
  }
  const mask = (0xffffffff << (32 - parsed.bits)) >>> 0;
  return (ipToInt(normalized) & mask) === (ipToInt(parsed.base) & mask);
}

export function resolveClientIp(socketAddress, xForwardedFor, trustedCidrs) {
  const socketIp = normalizeIp(socketAddress);
  const cidrs = Array.isArray(trustedCidrs) ? trustedCidrs : [];

  const peerTrusted = socketIp !== null && cidrs.some((cidr) => isIpInCidr(socketIp, cidr));
  if (peerTrusted && typeof xForwardedFor === "string" && xForwardedFor.length > 0) {
    // Leftmost entry is the original client; proxies append to the right.
    const leftmost = normalizeIp(xForwardedFor.split(",")[0]);
    if (leftmost !== null) {
      return leftmost;
    }
  }
  return socketIp ?? "";
}
