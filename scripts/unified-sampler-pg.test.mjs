import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createOpportunityRepository } from "../server/db/opportunity-repository.mjs";
import { createPostgresSink } from "./lib/postgres-sink.mjs";
import { withDatabase } from "./lib/test-db.mjs";
import { createUnifiedEvaluation, runUnifiedSampler } from "./unified-sampler.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOW = "2026-07-18T10:05:00.000Z";
const COMMENCE = "2026-07-18T12:00:00.000Z";

test("unified sampler exits cleanly when its exact advisory lock is held", async (t) => {
  await withDatabase(t, async (pool) => {
    const lockClient = await pool.connect();
    try {
      const lock = await lockClient.query(
        "SELECT pg_try_advisory_lock(hashtextextended($1::text, 0)) AS locked",
        ["unified-buyable-sampler"],
      );
      assert.equal(lock.rows[0].locked, true);

      assert.equal(await runUnifiedSampler({ sink: createPostgresSink({ pool }), now: NOW }), "busy");
      assert.equal((await pool.query("SELECT 1 FROM fixtures")).rowCount, 0);
      assert.equal((await pool.query("SELECT 1 FROM prediction_snapshots")).rowCount, 0);
    } finally {
      await lockClient.query("SELECT pg_advisory_unlock(hashtextextended($1::text, 0))", ["unified-buyable-sampler"]);
      lockClient.release();
    }
  });
});

test("evaluation excludes stale providers, canonically dedupes books, and groups buyable quotes", () => {
  const freshRows = [
    quote("book-a-old-over", "provider-old", "Book A", "over", 9, { observedAt: "2026-07-18T09:55:00.000Z" }),
    quote("book-a-over", "provider-a", " book-a ", "over", 2.3),
    quote("book-a-under", "provider-a", " book-a ", "under", 1.65),
    quote("book-b-over", "provider-b", "Book B", "over", 2.3),
    quote("book-b-under", "provider-b", "Book B", "under", 1.65),
    quote("book-c-over", "provider-c", "Book C", "over", 1.5),
    quote("book-c-under", "provider-c", "Book C", "under", 2),
  ];
  const staleRows = [
    quote("stale-over", "stale-provider", "Stale Book", "over", 20, { observedAt: "2026-07-18T09:00:00.000Z" }),
    quote("stale-under", "stale-provider", "Stale Book", "under", 20, { observedAt: "2026-07-18T09:00:00.000Z" }),
  ];

  const evaluation = createUnifiedEvaluation(
    [...freshRows, ...staleRows],
    { fixtures: [...freshRows, ...staleRows], unmatched: [] },
    NOW,
  );

  assert.equal(evaluation.evaluatedAt, NOW);
  assert.equal(evaluation.inputs.some(({ provider }) => provider === "stale-provider"), false);
  assert.equal(evaluation.inputs.filter(({ selection, bookmaker }) => (
    selection === "over" && bookmaker.toLowerCase().replaceAll(/[^a-z]/g, "") === "booka"
  )).length, 1);
  assert.equal(evaluation.inputs.find(({ id }) => id === "book-a-over")?.odds, 2.3);
  const over = evaluation.opportunities.find(({ market, selection }) => market === "totals" && selection === "over");
  assert.ok(over, "fresh providers still produce an opportunity when another provider is stale");
  assert.deepEqual(over.quotes.map(({ bookmaker }) => bookmaker), ["book-a", "Book B"]);
});

test("PostgreSQL sampler fingerprints changed inputs, extends recurrences, and records later empty quotes", async (t) => {
  await withDatabase(t, async (pool) => {
    const sink = createPostgresSink({ pool });
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error("the unified sampler must never fetch providers");
    };
    t.after(() => { globalThis.fetch = originalFetch; });

    await saveBook(sink, "provider-a", "Book A", 2.3, 1.65, "2026-07-18T10:00:00.000Z");
    await saveBook(sink, "provider-b", "Book B", 2.3, 1.65, "2026-07-18T10:00:00.000Z");
    await saveBook(sink, "provider-c", "Book C", 1.5, 2, "2026-07-18T10:00:00.000Z");

    assert.equal(await runUnifiedSampler({ sink, now: NOW }), "ran");
    assert.equal(await runUnifiedSampler({ sink, now: "2026-07-18T10:10:00.000Z" }), "ran");
    assert.equal(fetchCalls, 0);

    const repository = createOpportunityRepository(pool);
    let [over] = (await repository.listCurrent("2026-07-18T10:10:00.000Z"))
      .filter(({ market, selection }) => market === "totals" && selection === "over");
    assert.ok(over);
    assert.equal(over.quotes.length, 2, "all qualifying bookmaker quotes share one opportunity");
    let observations = await repository.listObservations(over.sampleId);
    assert.equal(observations.length, 1);
    assert.equal(observations[0].firstEvaluatedAt, NOW);
    assert.equal(observations[0].lastEvaluatedAt, "2026-07-18T10:10:00.000Z");

    await saveBook(sink, "provider-c", "Book C", 1.6, 1.9, "2026-07-18T10:12:00.000Z");
    assert.equal(await runUnifiedSampler({ sink, now: "2026-07-18T10:15:00.000Z" }), "ran");
    observations = await repository.listObservations(over.sampleId);
    assert.equal(observations.length, 2, "changed peer odds create a new observation fingerprint");
    assert.notEqual(observations[0].fingerprint, observations[1].fingerprint);

    for (const [provider, bookmaker] of [["provider-a", "Book A"], ["provider-b", "Book B"], ["provider-c", "Book C"]]) {
      await saveBook(sink, provider, bookmaker, 1.9, 1.9, "2026-07-18T10:20:00.000Z");
    }
    assert.equal(await runUnifiedSampler({ sink, now: "2026-07-18T10:25:00.000Z" }), "ran");

    [over] = (await repository.listCurrent("2026-07-18T10:25:00.000Z"))
      .filter(({ market, selection }) => market === "totals" && selection === "over");
    observations = await repository.listObservations(over.sampleId);
    assert.equal(observations.length, 3);
    assert.deepEqual(observations.at(-1).buyableQuotes, []);
    assert.equal(over.lastQualifiedAt, "2026-07-18T10:15:00.000Z");
    assert.equal(over.lastEvaluatedAt, "2026-07-18T10:25:00.000Z");
    assert.deepEqual(over.quotes, []);
  });
});

test("clearing every provider after qualification records and extends one empty observation", async (t) => {
  await withDatabase(t, async (pool) => {
    const sink = createPostgresSink({ pool });
    await saveBook(sink, "provider-a", "Book A", 2.3, 1.65, "2026-07-18T10:00:00.000Z");
    await saveBook(sink, "provider-b", "Book B", 2.3, 1.65, "2026-07-18T10:00:00.000Z");
    await saveBook(sink, "provider-c", "Book C", 1.5, 2, "2026-07-18T10:00:00.000Z");
    await runUnifiedSampler({ sink, now: NOW });

    for (const provider of ["provider-a", "provider-b", "provider-c"]) {
      await sink.saveLiveOdds(provider, "2026-07-18T10:20:00.000Z", []);
    }
    await runUnifiedSampler({ sink, now: "2026-07-18T10:25:00.000Z" });
    await runUnifiedSampler({ sink, now: "2026-07-18T10:30:00.000Z" });

    const repository = createOpportunityRepository(pool);
    const over = (await repository.listCurrent("2026-07-18T10:30:00.000Z"))
      .find(({ market, selection }) => market === "totals" && selection === "over");
    assert.ok(over);
    assert.deepEqual(over.quotes, []);
    assert.equal(over.lastEvaluatedAt, "2026-07-18T10:30:00.000Z");
    const observations = await repository.listObservations(over.sampleId);
    assert.equal(observations.length, 2, "repeated empty cycles reuse one deterministic fingerprint");
    assert.deepEqual(observations.at(-1).buyableQuotes, []);
    assert.equal(observations.at(-1).firstEvaluatedAt, "2026-07-18T10:25:00.000Z");
    assert.equal(observations.at(-1).lastEvaluatedAt, "2026-07-18T10:30:00.000Z");
  });
});

test("all rows becoming stale before kickoff records an empty observation", async (t) => {
  await withDatabase(t, async (pool) => {
    const sink = createPostgresSink({ pool });
    await saveBook(sink, "provider-a", "Book A", 2.3, 1.65, "2026-07-18T10:00:00.000Z");
    await saveBook(sink, "provider-b", "Book B", 2.3, 1.65, "2026-07-18T10:00:00.000Z");
    await saveBook(sink, "provider-c", "Book C", 1.5, 2, "2026-07-18T10:00:00.000Z");
    await runUnifiedSampler({ sink, now: NOW });
    await runUnifiedSampler({ sink, now: "2026-07-18T10:46:00.000Z" });

    const repository = createOpportunityRepository(pool);
    const over = (await repository.listCurrent("2026-07-18T10:46:00.000Z"))
      .find(({ market, selection }) => market === "totals" && selection === "over");
    assert.ok(over);
    assert.deepEqual(over.inputs, []);
    assert.deepEqual(over.quotes, []);
    assert.equal(over.lastEvaluatedAt, "2026-07-18T10:46:00.000Z");
    assert.equal((await repository.listObservations(over.sampleId)).length, 2);
  });
});

test("sampler source contains no provider API path", async () => {
  const source = await readFile(path.join(PROJECT_ROOT, "scripts", "unified-sampler.mjs"), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(|hkjc-import|hdc-collector|api-sports\.io|api\.the-odds-api\.com/i);
});

async function saveBook(sink, provider, bookmaker, over, under, observedAt) {
  await sink.saveLiveOdds(provider, observedAt, [
    quote(`${provider}-over`, provider, bookmaker, "over", over),
    quote(`${provider}-under`, provider, bookmaker, "under", under),
  ]);
}

function quote(id, provider, bookmaker, selection, odds, overrides = {}) {
  return {
    id,
    fixtureId: "11111111-1111-4111-8111-111111111111",
    matchId: `${provider}-match`,
    homeTeam: "Alpha FC",
    awayTeam: "Beta United",
    commenceTime: COMMENCE,
    league: "Test League",
    provider,
    bookmaker,
    market: "totals",
    selection,
    line: 2.5,
    odds,
    observedAt: "2026-07-18T10:00:00.000Z",
    expiresAt: "2026-07-18T15:00:00.000Z",
    ...overrides,
  };
}
