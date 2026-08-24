import assert from "node:assert/strict";
import test from "node:test";

import {
  TRUST_ACTIVE,
  TRUST_SHADOW,
  TRUST_SUSPENDED,
  isBuyableTrust,
  listSuspensions,
  modelTrust,
} from "./model-trust.mjs";

test("reproduces the suspended corner model trust verdict", () => {
  const trust = modelTrust({
    strategyVersion: "unified-buyable-v1",
    market: "corners",
    modelVersion: "corner-loo-v1",
  });
  assert.equal(trust.status, TRUST_SUSPENDED);
  assert.equal(trust.reason, "negative-realized-roi");
  assert.match(trust.message, /已暫停/);
});

test("the other unified models stay active", () => {
  for (const [market, modelVersion] of [
    ["h2h", "consensus-v1"],
    ["handicap", "hdc-loo-v2"],
    ["totals", "totals-loo-v1"],
  ]) {
    const trust = modelTrust({ strategyVersion: "unified-buyable-v1", market, modelVersion });
    assert.equal(trust.status, TRUST_ACTIVE, `${market}/${modelVersion}`);
    assert.equal(trust.reason, null);
  }
});

test("shadow experiment strategies never surface as buyable", () => {
  for (const strategyVersion of [
    "dc-shadow-v2",
    "dc-blend-v2",
    "market-sharp-v1",
    "dc-xg-shadow-v2",
    "dc-shadow-v1",
    "dc-blend-v1",
    "dc-xg-shadow-v1",
  ]) {
    const trust = modelTrust({ strategyVersion, market: "h2h", modelVersion: "dc-goals-v2" });
    assert.equal(trust.status, TRUST_SHADOW, strategyVersion);
    assert.equal(isBuyableTrust({ strategyVersion, market: "h2h", modelVersion: "dc-goals-v2" }), false);
  }
});

test("unknown strategy versions fail closed", () => {
  const trust = modelTrust({ strategyVersion: "legacy-v0", market: "totals", modelVersion: "legacy-v0" });
  assert.equal(trust.status, TRUST_SHADOW);
  assert.equal(trust.reason, "unknown-strategy");
  assert.equal(isBuyableTrust({ strategyVersion: "legacy-v0", market: "totals" }), false);
});

test("listSuspensions exposes the suspended corner model for the unified strategy", () => {
  const suspensions = listSuspensions("unified-buyable-v1");
  assert.equal(suspensions.length, 1);
  assert.deepEqual(suspensions[0], {
    strategyVersion: "unified-buyable-v1",
    market: "corners",
    modelVersion: "corner-loo-v1",
    status: TRUST_SUSPENDED,
    reason: "negative-realized-roi",
    message: suspensions[0].message,
  });
  assert.equal(listSuspensions("dc-shadow-v2").length, 0);
});

test("isBuyableTrust gates the suspended corner row only", () => {
  assert.equal(isBuyableTrust({
    strategyVersion: "unified-buyable-v1",
    market: "corners",
    modelVersion: "corner-loo-v1",
  }), false);
  assert.equal(isBuyableTrust({
    strategyVersion: "unified-buyable-v1",
    market: "totals",
    modelVersion: "totals-loo-v1",
  }), true);
});
