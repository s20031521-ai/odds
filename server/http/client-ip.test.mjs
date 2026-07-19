import assert from "node:assert/strict";
import test from "node:test";

import { isIpInCidr, normalizeIp, parseCidr, resolveClientIp } from "./client-ip.mjs";

test("parseCidr accepts valid IPv4 CIDRs and rejects malformed input", () => {
  assert.ok(parseCidr("172.16.0.0/12"));
  assert.ok(parseCidr("0.0.0.0/0"));
  assert.ok(parseCidr("255.255.255.255/32"));
  for (const bad of ["172.16.0.0", "172.16.0.0/33", "172.16.0.0/-1", "999.1.1.1/8", "::1/128", "x", "1.2.3/8", "1.2.3.4/8/extra"]) {
    assert.equal(parseCidr(bad), null, bad);
  }
});

test("isIpInCidr matches IPv4 ranges", () => {
  assert.equal(isIpInCidr("172.18.0.3", "172.16.0.0/12"), true);
  assert.equal(isIpInCidr("172.15.255.255", "172.16.0.0/12"), false);
  assert.equal(isIpInCidr("172.32.0.1", "172.16.0.0/12"), false);
  assert.equal(isIpInCidr("10.1.2.3", "10.0.0.0/8"), true);
  assert.equal(isIpInCidr("192.168.1.1", "10.0.0.0/8"), false);
  assert.equal(isIpInCidr("not-an-ip", "10.0.0.0/8"), false);
});

test("normalizeIp handles IPv4-mapped IPv6 socket forms", () => {
  assert.equal(normalizeIp("127.0.0.1"), "127.0.0.1");
  assert.equal(normalizeIp("::ffff:127.0.0.1"), "127.0.0.1");
  assert.equal(normalizeIp("::ffff:172.18.0.3"), "172.18.0.3");
  assert.equal(normalizeIp("  10.0.0.1 "), "10.0.0.1");
  assert.equal(normalizeIp("not-an-ip"), null);
  assert.equal(normalizeIp("999.1.1.1"), null);
  assert.equal(normalizeIp(""), null);
  assert.equal(normalizeIp(undefined), null);
});

test("resolveClientIp ignores X-Forwarded-For when nothing is trusted", () => {
  assert.equal(resolveClientIp("172.18.0.3", "203.0.113.9", []), "172.18.0.3");
});

test("resolveClientIp ignores spoofed X-Forwarded-For from an untrusted peer", () => {
  assert.equal(resolveClientIp("203.0.113.9", "10.1.1.1", ["172.16.0.0/12"]), "203.0.113.9");
});

test("resolveClientIp uses the leftmost valid X-Forwarded-For entry from a trusted peer", () => {
  // cloudflared -> caddy appends, caddy -> api appends: leftmost is the real client.
  assert.equal(resolveClientIp("172.18.0.3", "203.0.113.9, 172.19.0.2", ["172.16.0.0/12"]), "203.0.113.9");
  assert.equal(resolveClientIp("::ffff:172.18.0.3", "198.51.100.7", ["172.16.0.0/12"]), "198.51.100.7");
});

test("resolveClientIp falls back to the socket address on missing or malformed headers", () => {
  assert.equal(resolveClientIp("172.18.0.3", undefined, ["172.16.0.0/12"]), "172.18.0.3");
  assert.equal(resolveClientIp("172.18.0.3", "", ["172.16.0.0/12"]), "172.18.0.3");
  assert.equal(resolveClientIp("172.18.0.3", "garbage-value", ["172.16.0.0/12"]), "172.18.0.3");
  assert.equal(resolveClientIp("172.18.0.3", "999.1.1.1", ["172.16.0.0/12"]), "172.18.0.3");
});
