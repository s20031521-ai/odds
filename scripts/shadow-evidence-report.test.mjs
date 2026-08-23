import assert from "node:assert/strict";
import test from "node:test";

import {
  TRACKED_STRATEGIES,
  analyzeShadowEvidence,
  formatReport,
} from "./shadow-evidence-report.mjs";

const NOW = "2026-08-24T00:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(days) {
  return new Date(Date.parse(NOW) - days * DAY).toISOString();
}

function snapshot(overrides = {}) {
  return {
    id: overrides.id,
    identityKey: overrides.identityKey ?? `identity-${overrides.id}`,
    strategyVersion: overrides.strategyVersion ?? "unified-buyable-v1",
    fixtureId: overrides.fixtureId ?? `fixture-${overrides.id}`,
    league: overrides.league ?? "English Premier League",
    firstQualifiedAt: overrides.firstQualifiedAt ?? daysAgo(2),
  };
}

function observation(snapshotId, firstEvaluatedAt = daysAgo(1)) {
  return { snapshotId, firstEvaluatedAt, lastEvaluatedAt: firstEvaluatedAt };
}

test("analyzeShadowEvidence counts fresh evidence per strategy and league", () => {
  const snapshots = [
    snapshot({ id: 1, fixtureId: "f-epl-1" }),
    snapshot({ id: 2, fixtureId: "f-epl-2" }),
    snapshot({ id: 3, strategyVersion: "dc-shadow-v1", fixtureId: "f-epl-1" }),
    snapshot({ id: 4, strategyVersion: "dc-shadow-v1", fixtureId: "f-epl-2" }),
    snapshot({ id: 5, strategyVersion: "market-sharp-v1", fixtureId: "f-epl-1" }),
    // old snapshot — outside the window, must not count as new
    snapshot({ id: 6, strategyVersion: "dc-shadow-v1", fixtureId: "f-old", firstQualifiedAt: daysAgo(30) }),
    // untracked strategy — ignored entirely
    snapshot({ id: 7, strategyVersion: "corner-loo-v1", fixtureId: "f-corner" }),
  ];
  const observations = [
    observation(1), observation(2),
    observation(3), observation(4),
    observation(5),
    observation(6, daysAgo(20)),
    observation(7),
  ];
  const report = analyzeShadowEvidence({ snapshots, observations, now: NOW });

  const unified = report.strategies.find((s) => s.strategyVersion === "unified-buyable-v1");
  assert.equal(unified.snapshotsTotal, 2);
  assert.equal(unified.snapshotsNew, 2);
  assert.equal(unified.observationsNew, 2);
  assert.equal(unified.fixturesNew, 2);
  assert.equal(unified.leagues.E0.fixtures, 2);

  const dc = report.strategies.find((s) => s.strategyVersion === "dc-shadow-v1");
  assert.equal(dc.snapshotsTotal, 3);
  assert.equal(dc.snapshotsNew, 2);
  assert.equal(dc.observationsTotal, 3);
  assert.equal(dc.observationsNew, 2);
  assert.equal(dc.fixturesNew, 2);

  assert.equal(report.coverage.supportedFixtures, 2);
  assert.equal(report.coverage.dcCovered, 2);
  assert.equal(report.coverage.dcCoveragePct, 100);
  assert.equal(report.coverage.sharpCoveragePct, 50);
});

test("analyzeShadowEvidence warns when a shadow line stalls and leagues miss the target", () => {
  const snapshots = [
    snapshot({ id: 1, fixtureId: "f-epl-1" }),
    snapshot({ id: 2, fixtureId: "f-epl-2" }),
    snapshot({ id: 3, strategyVersion: "dc-shadow-v1", fixtureId: "f-epl-1" }),
  ];
  const observations = [observation(1), observation(2), observation(3)];
  const report = analyzeShadowEvidence({ snapshots, observations, now: NOW, weeklyTarget: 10 });

  assert.ok(report.warnings.some((w) => w.startsWith("dc-blend-v1: no new observations")));
  assert.ok(report.warnings.some((w) => w.startsWith("dc-xg-shadow-v1: no new observations")));
  assert.ok(report.warnings.some((w) => w.startsWith("market-sharp-v1: no new observations")));
  assert.ok(report.warnings.some((w) => w.includes("dc-shadow-v1: E0 has 1 fixtures")));
  // coverage 1/2 = 50% < 80%
  assert.ok(report.warnings.some((w) => w.includes("dc fit coverage 50%")));
});

test("analyzeShadowEvidence does not flag leagues the unified strategy never saw", () => {
  // Only La Liga activity — E0 must not be flagged as missing target.
  const snapshots = [
    snapshot({ id: 1, fixtureId: "f-sp1-1", league: "La Liga Spain" }),
    snapshot({ id: 2, strategyVersion: "dc-shadow-v1", fixtureId: "f-sp1-1", league: "La Liga Spain" }),
  ];
  const observations = [observation(1), observation(2)];
  const report = analyzeShadowEvidence({ snapshots, observations, now: NOW, weeklyTarget: 10 });

  assert.ok(!report.warnings.some((w) => w.includes("E0")), "no E0 warning when unified never evaluated E0");
  assert.ok(report.warnings.some((w) => w.includes("SP1 has 1 fixtures")), "SP1 is below target");
  assert.equal(report.coverage.dcCoveragePct, 100);
});

test("analyzeShadowEvidence reports quota, blocks, rotation, and stale collector state", () => {
  const report = analyzeShadowEvidence({
    snapshots: [],
    observations: [],
    collectorStates: [
      {
        stateKey: "hdc-collector",
        state: {
          quotaRemaining: 4,
          quotaUsed: 429,
          quotaMinimum: 5,
          paidCollectionBlocked: true,
          paidCollectionBlockedReason: "quota-reserve",
          keyRotation: { week: 34, offset: 1 },
        },
        updatedAt: daysAgo(1),
      },
    ],
    now: NOW,
  });

  const [entry] = report.collector;
  assert.equal(entry.stateKey, "hdc-collector");
  assert.equal(entry.quotaRemaining, 4);
  assert.equal(entry.paidCollectionBlocked, true);
  assert.deepEqual(entry.keyRotation, { week: 34, offset: 1 });
  assert.equal(entry.ageMinutes, 24 * 60);

  assert.ok(report.warnings.some((w) => w.includes("at/below reserve floor 5")));
  assert.ok(report.warnings.some((w) => w.includes("paid collection blocked (quota-reserve)")));
  assert.ok(report.warnings.some((w) => w.includes("collector state stale")));
});

test("analyzeShadowEvidence accepts PostgreSQL-style snake_case rows and Date timestamps", () => {
  // Regression: production pg rows carry strategy_version (snake_case), not
  // strategyVersion — a camelCase-only read silently dropped every row and
  // reported all-zero totals against a healthy database (2026-08-24).
  const snapshots = [{
    id: 1,
    identity_key: "k1",
    strategy_version: "unified-buyable-v1",
    fixture_id: "f1",
    league: "英格蘭超級聯賽",
    first_qualified_at: new Date(Date.parse(NOW) - DAY),
  }];
  const observations = [{
    snapshot_id: 1,
    first_evaluated_at: new Date(Date.parse(NOW) - DAY),
    last_evaluated_at: new Date(Date.parse(NOW) - DAY),
  }];
  const report = analyzeShadowEvidence({ snapshots, observations, now: new Date(Date.parse(NOW)) });
  const unified = report.strategies.find((s) => s.strategyVersion === "unified-buyable-v1");
  assert.equal(unified.observationsNew, 1);
  assert.equal(unified.leagues.E0.fixtures, 1, "Chinese league name maps to E0");
});

test("analyzeShadowEvidence rejects an invalid now", () => {
  assert.throws(() => analyzeShadowEvidence({ snapshots: [], observations: [], now: "not-a-date" }), TypeError);
});

test("formatReport renders tables, coverage, collector, and verdict", () => {
  const clean = analyzeShadowEvidence({
    snapshots: [snapshot({ id: 1 })],
    observations: [observation(1)],
    collectorStates: [{
      stateKey: "hdc-collector",
      state: { quotaRemaining: 433, quotaMinimum: 5 },
      updatedAt: NOW,
    }],
    now: NOW,
  });
  const text = formatReport(clean);
  assert.match(text, /unified-buyable-v1\s+1\(1\)/);
  assert.match(text, /dc fit coverage: 0\/1 fixtures \(0%\)/);
  assert.match(text, /quotaRemaining=433/);
  assert.match(text, /VERDICT: \d+ warning\(s\)/);

  const empty = analyzeShadowEvidence({ snapshots: [], observations: [], now: NOW });
  const emptyText = formatReport(empty);
  assert.match(emptyText, /no supported-league fixtures evaluated in-window/);
  assert.match(emptyText, /VERDICT: OK/);
});

test("TRACKED_STRATEGIES covers unified, dc family, and market-sharp", () => {
  assert.deepEqual(TRACKED_STRATEGIES, [
    "unified-buyable-v1",
    "dc-shadow-v1",
    "dc-blend-v1",
    "dc-xg-shadow-v1",
    "market-sharp-v1",
  ]);
});
