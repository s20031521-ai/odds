import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createOddsRepository } from "../server/db/odds-repository.mjs";
import { createPostgresSink } from "./lib/postgres-sink.mjs";
import { withDatabase } from "./lib/test-db.mjs";
import { createPostgresHistoryStore, snapshotToFlatEntry } from "./odds-monitor.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const HISTORY_FILE = path.join(PROJECT_ROOT, "data", "odds-history.jsonl");
const OBSERVED_AT = "2026-07-18T10:00:00.000Z";
const COMMENCE = "2026-07-18T12:00:00.000Z";
const QUERY_NOW = "2026-07-18T13:00:00.000Z";

test("odds-monitor pg store lands history snapshots as flat live-odds rows", async (t) => {
  await withDatabase(t, async (pool) => {
    const store = createPostgresHistoryStore(createPostgresSink({ pool }));
    const odds = createOddsRepository(pool);

    await store.writeSnapshots([
      snapshot({ side: "Over", point: 2.5, price: 1.91 }),
      snapshot({ side: "Under", point: 2.5, price: 1.95 }),
      snapshot({ market: "h2h", side: "Home", point: Number.NaN, price: 2.1 }),
    ]);

    const live = await odds.listLive(QUERY_NOW);
    assert.equal(live.length, 3);
    const over = live.find((row) => row.selection === "Over");
    assert.equal(over.market, "totals");
    assert.equal(over.line, 2.5);
    assert.equal(over.odds, 1.91);
    assert.equal(over.bookmaker, "Book");
    assert.equal(over.matchId, "monitor-match-1");
    assert.equal(over.expiresAt, "2026-07-18T15:00:00.000Z", "expiresAt = commenceTime + 3h");
    const h2h = live.find((row) => row.market === "h2h");
    assert.equal(h2h.line ?? null, null, "h2h rows carry no line");
    assert.equal(h2h.odds, 2.1);
  });
});

test("odds-monitor pg store replaces its provider snapshot on the next batch", async (t) => {
  await withDatabase(t, async (pool) => {
    const store = createPostgresHistoryStore(createPostgresSink({ pool }));
    const odds = createOddsRepository(pool);

    await store.writeSnapshots([snapshot({ side: "Over", point: 2.5, price: 1.91 })]);
    await store.writeSnapshots([snapshot({ side: "Over", point: 3.5, price: 2.4, matchId: "monitor-match-2" })]);

    const live = await odds.listLive(QUERY_NOW);
    assert.equal(live.length, 1);
    assert.equal(live[0].matchId, "monitor-match-2");
    assert.equal(live[0].line, 3.5);
  });
});

test("odds-monitor pg store skips invalid prices with a warning and keeps the batch valid", async (t) => {
  await withDatabase(t, async (pool) => {
    const warnings = [];
    const store = createPostgresHistoryStore(createPostgresSink({ pool }), { warn: (message) => warnings.push(message) });
    const odds = createOddsRepository(pool);

    await store.writeSnapshots([
      snapshot({ side: "Over", point: 2.5, price: 1.91 }),
      snapshot({ side: "Under", point: 2.5, price: Number.NaN }),
      snapshot({ side: "Under", point: 3.5, price: 0 }),
      snapshot({ side: "Under", point: 4.5, price: -1.5 }),
    ]);

    assert.equal(warnings.length, 3, "one warning per skipped row");
    assert.match(warnings[0], /skipping snapshot with invalid price/);
    const live = await odds.listLive(QUERY_NOW);
    assert.equal(live.length, 1, "only the valid row is persisted");
    assert.equal(live[0].odds, 1.91);
  });
});

test("odds-monitor pg store writes no odds-history JSONL file", async (t) => {
  await withDatabase(t, async (pool) => {
    const before = await readFile(HISTORY_FILE).catch(() => null);
    const store = createPostgresHistoryStore(createPostgresSink({ pool }), { warn: () => {} });

    await store.writeSnapshots([
      snapshot({ side: "Over", point: 2.5, price: 1.91 }),
      snapshot({ side: "Under", point: 2.5, price: Number.NaN }),
    ]);

    const after = await readFile(HISTORY_FILE).catch(() => null);
    assert.equal(after?.toString("base64") ?? null, before?.toString("base64") ?? null);
  });
});

test("snapshotToFlatEntry falls back to observedAt + 24h when commenceTime is unparseable", () => {
  const entry = snapshotToFlatEntry(snapshot({ commenceTime: "not-a-date", price: 1.9 }), 1.9, OBSERVED_AT);
  assert.equal(entry.expiresAt, "2026-07-19T10:00:00.000Z");
  assert.equal(entry.selection, "Over");
  assert.equal(entry.line, 2.5);
  assert.equal(entry.odds, 1.9);

  const noPoint = snapshotToFlatEntry(snapshot({ point: Number.NaN, price: 2.1 }), 2.1, OBSERVED_AT);
  assert.equal(noPoint.line, undefined, "non-finite point is omitted so the repository accepts the row");
  assert.equal(noPoint.expiresAt, "2026-07-18T15:00:00.000Z");
});

function snapshot(overrides = {}) {
  return {
    timestamp: OBSERVED_AT,
    matchId: "monitor-match-1",
    commenceTime: COMMENCE,
    homeTeam: "Home",
    awayTeam: "Away",
    bookmaker: "Book",
    market: "totals",
    side: "Over",
    point: 2.5,
    price: 1.91,
    ...overrides,
  };
}
