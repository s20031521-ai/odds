import { observationFingerprint } from "../../shared/unified-recommendations.mjs";
import { opportunityIdentity } from "../domain/identity.mjs";
import { withTransaction } from "./pool.mjs";

export function createOpportunityRepository(db) {
  return {
    async recordEvaluation(evaluation) {
      const evaluatedAt = timestamp(evaluation?.evaluatedAt, "evaluation evaluatedAt");
      const inputs = Array.isArray(evaluation?.inputs) ? evaluation.inputs : [];
      const opportunities = Array.isArray(evaluation?.opportunities) ? evaluation.opportunities : [];

      return inRepositoryTransaction(db, async (client) => {
        const outcome = {
          samplesInserted: 0,
          samplesUpdated: 0,
          observationsInserted: 0,
          observationsExtended: 0,
          skipped: 0,
        };

        for (const opportunity of opportunities) {
          const identity = opportunityIdentity(opportunity);
          const buyableQuotes = Array.isArray(opportunity.quotes) ? opportunity.quotes : [];
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
            [`opportunity:${identity}`],
          );
          let sample = await findSample(client, identity);
          if (!sample && buyableQuotes.length === 0) {
            outcome.skipped += 1;
            continue;
          }

          if (!sample) {
            const bestQuote = [...buyableQuotes].sort(compareQuotes)[0];
            const inserted = await client.query(`
              INSERT INTO prediction_snapshots (
                identity_key, match_id, market, prediction, line, odds, chance,
                edge, saved_at, commence_time, model_version, source,
                snapshot_status, rejection_reason, raw, strategy_version,
                fixture_id, first_qualified_at, last_qualified_at
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11, 'unified-sampler',
                'valid-current', NULL, $12, $13,
                $14, $15, $15
              ) RETURNING id
            `, [
              identity,
              opportunity.matchId ?? null,
              opportunity.market ?? null,
              opportunity.selection ?? null,
              finiteOrNull(opportunity.line),
              positiveFiniteOrNull(bestQuote.odds),
              probabilityOrNull(bestQuote.chance),
              finiteOrNull(bestQuote.edge),
              evaluatedAt,
              timestampOrNull(opportunity.commenceTime),
              opportunity.modelVersion ?? null,
              opportunity,
              opportunity.strategyVersion ?? "legacy-v0",
              opportunity.fixtureId,
              evaluatedAt,
            ]);
            sample = inserted.rows[0];
            outcome.samplesInserted += 1;
          } else if (buyableQuotes.length > 0) {
            await client.query(`
              UPDATE prediction_snapshots
              SET last_qualified_at = $2
              WHERE id = $1
            `, [sample.id, evaluatedAt]);
            outcome.samplesUpdated += 1;
          }

          const observationInputs = Array.isArray(opportunity.inputs)
            ? opportunity.inputs
            : inputsForOpportunity(inputs, opportunity);
          const fingerprint = observationFingerprint({
            inputs: observationInputs,
            buyableQuotes,
          });
          const existing = await client.query(`
            SELECT id FROM recommendation_observations
            WHERE snapshot_id = $1 AND fingerprint = $2
          `, [sample.id, fingerprint]);
          if (existing.rowCount > 0) {
            await client.query(`
              UPDATE recommendation_observations
              SET last_evaluated_at = $2
              WHERE id = $1
            `, [existing.rows[0].id, evaluatedAt]);
            outcome.observationsExtended += 1;
          } else {
            await client.query(`
              INSERT INTO recommendation_observations (
                snapshot_id, fingerprint, first_evaluated_at,
                last_evaluated_at, inputs, buyable_quotes
              ) VALUES ($1, $2, $3, $3, $4, $5)
            `, [sample.id, fingerprint, evaluatedAt, observationInputs, buyableQuotes]);
            outcome.observationsInserted += 1;
          }
        }

        return outcome;
      });
    },

    async listCurrent(now) {
      const result = await db.query(`
        SELECT snapshot.id AS sample_id, snapshot.raw, snapshot.fixture_id,
               snapshot.market, snapshot.prediction, snapshot.line,
               snapshot.model_version, snapshot.strategy_version,
               snapshot.commence_time, snapshot.first_qualified_at,
               snapshot.last_qualified_at, observation.first_evaluated_at,
               observation.last_evaluated_at, observation.inputs,
               observation.buyable_quotes
        FROM prediction_snapshots AS snapshot
        JOIN LATERAL (
          SELECT first_evaluated_at, last_evaluated_at, inputs, buyable_quotes
          FROM recommendation_observations
          WHERE snapshot_id = snapshot.id
          ORDER BY first_evaluated_at DESC, id DESC
          LIMIT 1
        ) AS observation ON true
        WHERE snapshot.strategy_version = 'unified-buyable-v1'
          AND snapshot.commence_time > $1
        ORDER BY snapshot.commence_time, snapshot.id
      `, [now]);
      return result.rows.map(currentRow);
    },

    async listObservations(sampleId) {
      const result = await db.query(`
        SELECT id, fingerprint, first_evaluated_at, last_evaluated_at,
               inputs, buyable_quotes
        FROM recommendation_observations
        WHERE snapshot_id = $1
        ORDER BY first_evaluated_at, id
      `, [sampleId]);
      return result.rows.map(observationRow);
    },

    async listForBacktest() {
      const result = await db.query(`
        SELECT snapshot.id, snapshot.raw, snapshot.fixture_id,
               snapshot.strategy_version, snapshot.first_qualified_at,
               snapshot.last_qualified_at,
               COALESCE(
                 jsonb_agg(
                   jsonb_build_object(
                     'fingerprint', observation.fingerprint,
                     'firstEvaluatedAt', observation.first_evaluated_at,
                     'lastEvaluatedAt', observation.last_evaluated_at,
                     'inputs', observation.inputs,
                     'buyableQuotes', observation.buyable_quotes
                   ) ORDER BY observation.first_evaluated_at, observation.id
                 ) FILTER (WHERE observation.id IS NOT NULL),
                 '[]'::jsonb
               ) AS observations
        FROM prediction_snapshots AS snapshot
        LEFT JOIN recommendation_observations AS observation
          ON observation.snapshot_id = snapshot.id
        WHERE snapshot.snapshot_status IN ('valid-current', 'legacy')
        GROUP BY snapshot.id
        ORDER BY snapshot.id
      `);
      return result.rows.map((row) => ({
        ...row.raw,
        sampleId: row.id,
        fixtureId: row.fixture_id ?? row.raw.fixtureId,
        strategyVersion: row.strategy_version ?? "legacy-v0",
        firstQualifiedAt: isoOrNull(row.first_qualified_at),
        lastQualifiedAt: isoOrNull(row.last_qualified_at),
        observations: row.observations,
      }));
    },
  };
}

async function findSample(client, identity) {
  const result = await client.query(
    "SELECT id FROM prediction_snapshots WHERE identity_key = $1",
    [identity],
  );
  return result.rows[0];
}

function inputsForOpportunity(inputs, opportunity) {
  return inputs.filter((input) => (
    input.fixtureId === opportunity.fixtureId
    && input.market === opportunity.market
    && (opportunity.market === "h2h" || input.line === opportunity.line)
  ));
}

function currentRow(row) {
  return {
    ...row.raw,
    sampleId: row.sample_id,
    fixtureId: row.fixture_id,
    market: row.market,
    selection: row.prediction,
    ...(row.line === null ? {} : { line: row.line }),
    modelVersion: row.model_version,
    strategyVersion: row.strategy_version,
    commenceTime: isoOrNull(row.commence_time),
    firstQualifiedAt: isoOrNull(row.first_qualified_at),
    lastQualifiedAt: isoOrNull(row.last_qualified_at),
    firstEvaluatedAt: isoOrNull(row.first_evaluated_at),
    lastEvaluatedAt: isoOrNull(row.last_evaluated_at),
    inputs: row.inputs,
    quotes: row.buyable_quotes,
  };
}

function observationRow(row) {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    firstEvaluatedAt: isoOrNull(row.first_evaluated_at),
    lastEvaluatedAt: isoOrNull(row.last_evaluated_at),
    inputs: row.inputs,
    buyableQuotes: row.buyable_quotes,
  };
}

function compareQuotes(left, right) {
  return right.odds - left.odds
    || String(left.bookmaker ?? "").localeCompare(String(right.bookmaker ?? ""))
    || String(left.provider ?? "").localeCompare(String(right.provider ?? ""));
}

function timestamp(value, name) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${name} must be a valid timestamp`);
  return new Date(parsed).toISOString();
}

function timestampOrNull(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function isoOrNull(value) {
  return value instanceof Date ? value.toISOString() : value ?? null;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function positiveFiniteOrNull(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function probabilityOrNull(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function inRepositoryTransaction(db, callback) {
  return typeof db.release === "function" ? callback(db) : withTransaction(db, callback);
}
