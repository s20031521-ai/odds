import { randomUUID } from "node:crypto";

import { withTransaction } from "./pool.mjs";

const MATCH_WINDOW_MS = 10 * 60_000;

export function createFixtureRepository(db) {
  return {
    async resolveBatch(liveRows) {
      return inRepositoryTransaction(db, async (client) => {
        const fixtures = [];
        const unmatched = [];
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('fixture-resolution-v1', 0))",
        );

        for (const row of liveRows) {
          const identity = aliasIdentity(row);
          if (!identity) {
            unmatched.push(row);
            continue;
          }

          await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
            [`fixture-alias:${identity.provider}:${identity.providerMatchId}`],
          );
          const exact = await findAlias(client, identity);
          if (exact) {
            const metadata = fixtureMetadata(row);
            if (metadata && Date.parse(metadata.commenceTime) !== Date.parse(exact.commence_time)) {
              await refreshRecognizedKickoff(client, exact.fixture_id, identity, metadata);
            }
            fixtures.push({ ...row, fixtureId: exact.fixture_id });
            continue;
          }

          const metadata = fixtureMetadata(row);
          if (!metadata) {
            unmatched.push(row);
            continue;
          }
          const candidates = await findCandidates(client, metadata);
          if (candidates.length > 1) {
            await client.query(`
              INSERT INTO fixture_match_audit (
                provider, provider_match_id, reason, candidate_fixture_ids,
                matched_fixture_id, raw
              ) VALUES ($1, $2, 'ambiguous-match', $3, NULL, $4)
            `, [identity.provider, identity.providerMatchId, candidates.map(({ id }) => id), row]);
            unmatched.push(row);
            continue;
          }

          const fixtureId = candidates[0]?.id ?? randomUUID();
          if (candidates.length === 0) {
            await client.query(`
              INSERT INTO fixtures (
                id, home_team, away_team, normalized_home_team,
                normalized_away_team, commence_time, league
              ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
              fixtureId,
              metadata.homeTeam,
              metadata.awayTeam,
              metadata.normalizedHomeTeam,
              metadata.normalizedAwayTeam,
              metadata.commenceTime,
              metadata.league,
            ]);
          }
          await client.query(`
            INSERT INTO fixture_aliases (
              provider, provider_match_id, fixture_id, home_team,
              away_team, commence_time, league
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [
            identity.provider,
            identity.providerMatchId,
            fixtureId,
            metadata.homeTeam,
            metadata.awayTeam,
            metadata.commenceTime,
            metadata.league,
          ]);
          fixtures.push({ ...row, fixtureId });
        }

        return { fixtures, unmatched };
      });
    },
  };
}

async function refreshRecognizedKickoff(client, fixtureId, identity, metadata) {
  await client.query(`
    UPDATE fixtures
    SET commence_time = $2
    WHERE id = $1 AND commence_time < $2
  `, [fixtureId, metadata.commenceTime]);
  await client.query(`
    UPDATE fixture_aliases
    SET home_team = $3, away_team = $4, commence_time = $5, league = $6
    WHERE provider = $1 AND provider_match_id = $2
  `, [
    identity.provider,
    identity.providerMatchId,
    metadata.homeTeam,
    metadata.awayTeam,
    metadata.commenceTime,
    metadata.league,
  ]);
}

async function findAlias(client, { provider, providerMatchId }) {
  const result = await client.query(`
    SELECT fixture_id, commence_time
    FROM fixture_aliases
    WHERE provider = $1 AND provider_match_id = $2
  `, [provider, providerMatchId]);
  return result.rows[0];
}

async function findCandidates(client, metadata) {
  const earliest = new Date(Date.parse(metadata.commenceTime) - MATCH_WINDOW_MS).toISOString();
  const latest = new Date(Date.parse(metadata.commenceTime) + MATCH_WINDOW_MS).toISOString();
  const result = await client.query(`
    SELECT id, league
    FROM fixtures
    WHERE normalized_home_team = $1
      AND normalized_away_team = $2
      AND commence_time BETWEEN $3 AND $4
    ORDER BY id
  `, [metadata.normalizedHomeTeam, metadata.normalizedAwayTeam, earliest, latest]);
  return result.rows.filter(({ league }) => leaguesCompatible(metadata.league, league));
}

function aliasIdentity(row) {
  const provider = nonEmpty(row?.provider);
  const providerMatchId = nonEmpty(row?.matchId);
  return provider && providerMatchId
    ? { provider: provider.trim(), providerMatchId: providerMatchId.trim() }
    : null;
}

function fixtureMetadata(row) {
  const homeTeam = nonEmpty(row?.homeTeam);
  const awayTeam = nonEmpty(row?.awayTeam);
  const commenceMs = Date.parse(row?.commenceTime);
  if (!homeTeam || !awayTeam || !Number.isFinite(commenceMs)) return null;
  return {
    homeTeam: homeTeam.trim(),
    awayTeam: awayTeam.trim(),
    normalizedHomeTeam: normalizeFixtureText(homeTeam),
    normalizedAwayTeam: normalizeFixtureText(awayTeam),
    commenceTime: new Date(commenceMs).toISOString(),
    league: nonEmpty(row.league)?.trim() ?? null,
  };
}

function leaguesCompatible(left, right) {
  return !left || !right || normalizeFixtureText(left) === normalizeFixtureText(right);
}

function normalizeFixtureText(value) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en").replace(/[\p{P}\p{S}\s]+/gu, "");
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function inRepositoryTransaction(db, callback) {
  return typeof db.release === "function" ? callback(db) : withTransaction(db, callback);
}
