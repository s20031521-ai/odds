import { createCollectorStateRepository } from "../../server/db/collector-state-repository.mjs";
import { createFixtureRepository } from "../../server/db/fixture-repository.mjs";
import { createOddsRepository } from "../../server/db/odds-repository.mjs";
import { createOpportunityRepository } from "../../server/db/opportunity-repository.mjs";
import { createResultRepository } from "../../server/db/result-repository.mjs";
import { createSnapshotRepository } from "../../server/db/snapshot-repository.mjs";

export function createPostgresSink({ pool, clock = () => new Date() }) {
  if (!pool || typeof pool.connect !== "function" || typeof pool.query !== "function") {
    throw new TypeError("createPostgresSink requires a pg Pool");
  }

  const liveOdds = createOddsRepository(pool);
  const fixtures = createFixtureRepository(pool);
  const opportunities = createOpportunityRepository(pool);
  const snapshots = createSnapshotRepository(pool);
  const results = createResultRepository(pool);
  const collectorState = createCollectorStateRepository(pool);

  return {
    async acquireCollectorLock(name, callback) {
      assertLockName(name);
      if (typeof callback !== "function") throw new TypeError("collector lock callback must be a function");

      const client = await pool.connect();
      let locked = false;
      try {
        const acquired = await client.query(
          "SELECT pg_try_advisory_lock(hashtextextended($1::text, 0)) AS locked",
          [name],
        );
        locked = acquired.rows[0]?.locked === true;
        if (!locked) return "busy";

        await callback();
        return "ran";
      } finally {
        if (locked) {
          try {
            await client.query("SELECT pg_advisory_unlock(hashtextextended($1::text, 0))", [name]);
          } catch (error) {
            // A failed unlock likely means a broken connection that may still
            // hold the session-level lock; destroy it instead of pooling it.
            client.release(error);
            throw error;
          }
          client.release();
        } else {
          client.release();
        }
      }
    },

    async saveLiveOdds(provider, observedAt, entries) {
      assertNonEmptyString(provider, "provider");
      assertValidDate(observedAt, "observedAt");
      return liveOdds.replaceProviderSnapshot(provider, new Date(Date.parse(observedAt)).toISOString(), entries);
    },

    async listLiveOdds(now) {
      assertValidDate(now, "live odds query time");
      return liveOdds.listLive(new Date(Date.parse(now)).toISOString());
    },

    async resolveFixtures(rows) {
      if (!Array.isArray(rows)) throw new TypeError("fixture rows must be an array");
      return fixtures.resolveBatch(rows);
    },

    async recordRecommendationEvaluation(value) {
      return opportunities.recordEvaluation(value);
    },

    async saveSnapshots(rows) {
      return snapshots.insertBatch(rows);
    },

    async saveResults(rows) {
      return results.upsertBatch(rows);
    },

    async loadCollectorState(key) {
      assertNonEmptyString(key, "collector state key");
      return await collectorState.get(key) ?? null;
    },

    async saveCollectorState(key, state) {
      assertNonEmptyString(key, "collector state key");
      await collectorState.set(key, state, clock().toISOString());
    },
  };
}

function assertLockName(name) {
  assertNonEmptyString(name, "collector lock name");
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function assertValidDate(value, label) {
  if (!Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be a valid timestamp`);
  }
}
