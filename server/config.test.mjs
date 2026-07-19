import assert from "node:assert/strict";
import test from "node:test";

import { loadServerConfig } from "./config.mjs";

const VALID_ENV = {
  DATABASE_URL: "postgresql://odds_test:odds_test@127.0.0.1:55432/odds_test",
  SESSION_SECRET: "s".repeat(32),
  PUBLIC_ORIGIN: "https://odds.example.test",
};

test("loadServerConfig defaults runMigrations to true", () => {
  assert.equal(loadServerConfig(VALID_ENV).runMigrations, true);
  assert.equal(loadServerConfig({ ...VALID_ENV, RUN_MIGRATIONS: "true" }).runMigrations, true);
  assert.equal(loadServerConfig({ ...VALID_ENV, RUN_MIGRATIONS: "1" }).runMigrations, true);
  assert.equal(loadServerConfig({ ...VALID_ENV, RUN_MIGRATIONS: "FALSE" }).runMigrations, true, "only exact lowercase 'false' disables");
});

test("loadServerConfig disables migrations only on exact 'false'", () => {
  assert.equal(loadServerConfig({ ...VALID_ENV, RUN_MIGRATIONS: "false" }).runMigrations, false);
});

test("loadServerConfig defaults trustedProxyCidrs to empty (trust nothing)", () => {
  assert.deepEqual(loadServerConfig(VALID_ENV).trustedProxyCidrs, []);
  assert.deepEqual(loadServerConfig({ ...VALID_ENV, TRUSTED_PROXY_CIDRS: "" }).trustedProxyCidrs, []);
  assert.deepEqual(loadServerConfig({ ...VALID_ENV, TRUSTED_PROXY_CIDRS: "   " }).trustedProxyCidrs, []);
});

test("loadServerConfig parses comma-separated CIDRs", () => {
  const config = loadServerConfig({ ...VALID_ENV, TRUSTED_PROXY_CIDRS: "172.16.0.0/12, 10.0.0.0/8" });
  assert.deepEqual(config.trustedProxyCidrs, ["172.16.0.0/12", "10.0.0.0/8"]);
});

test("loadServerConfig rejects malformed CIDRs", () => {
  for (const bad of ["not-a-cidr", "172.16.0.0", "172.16.0.0/33", "172.16.0.0/-1", "999.1.1.1/8", "::1/128", "172.16.0.0/abc"]) {
    assert.throws(
      () => loadServerConfig({ ...VALID_ENV, TRUSTED_PROXY_CIDRS: bad }),
      /TRUSTED_PROXY_CIDRS/,
      bad,
    );
  }
});
