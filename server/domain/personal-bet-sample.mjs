/**
 * Personal bet slips are real money outcomes.
 * On create we promote them into prediction_snapshots so they become samples
 * for later model review / backtest (strategy_version = personal-bet-v1).
 */

import { settleAgainstActual } from "./backtest.mjs";

export const PERSONAL_BET_STRATEGY = "personal-bet-v1";

const MODEL_VERSION_BY_MARKET = {
  totals: "totals-loo-v1",
  corners: "corner-loo-v1",
  handicap: "hdc-loo-v2",
  h2h: "consensus-v1",
};

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isoOrNull(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function canonicalMarketKey(value) {
  if (value === "h2h" || value === "主客和" || value === "moneyline") return "h2h";
  if (value === "handicap" || value === "亞洲讓球" || value === "spreads") return "handicap";
  if (value === "totals" || value === "大細波") return "totals";
  if (value === "corners" || value === "角球" || value === "alternate_totals_corners") return "corners";
  return value;
}

/** Insert prediction_snapshots row from a bet_slips row; returns sample id (bigint). */
export async function insertPersonalBetSample(db, bet) {
  const market = canonicalMarketKey(bet.market) || bet.market;
  const modelVersion = MODEL_VERSION_BY_MARKET[market] ?? "personal-bet-v1";
  const identity = `personal-bet:${bet.id}`;
  const now = new Date();
  const line = finiteOrNull(bet.line);
  const odds = finiteOrNull(bet.odds);
  const commence = isoOrNull(bet.commence_time);
  const raw = {
    matchId: bet.match_id ?? null,
    fixtureId: bet.fixture_id ?? null,
    market,
    selection: bet.selection,
    prediction: bet.selection,
    ...(line !== null ? { line } : {}),
    ...(odds !== null ? { odds } : {}),
    homeTeam: bet.home_team ?? null,
    awayTeam: bet.away_team ?? null,
    homeTeamZh: bet.home_team_zh ?? null,
    awayTeamZh: bet.away_team_zh ?? null,
    commenceTime: commence,
    modelVersion,
    strategyVersion: PERSONAL_BET_STRATEGY,
    source: "personal-bet",
    personalBetId: bet.id,
    stake: finiteOrNull(bet.stake),
    savedAt: now.toISOString(),
  };

  const inserted = await db.query(
    `
    INSERT INTO prediction_snapshots (
      identity_key, match_id, market, prediction, line, odds, chance,
      edge, saved_at, commence_time, model_version, source,
      snapshot_status, rejection_reason, raw, strategy_version,
      fixture_id, first_qualified_at, last_qualified_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, NULL,
      NULL, $7, $8, $9, 'personal-bet',
      'valid-current', NULL, $10, $11,
      $12, $7, $7
    )
    ON CONFLICT (identity_key) DO UPDATE SET
      raw = EXCLUDED.raw,
      prediction = EXCLUDED.prediction,
      line = EXCLUDED.line,
      odds = EXCLUDED.odds,
      last_qualified_at = EXCLUDED.last_qualified_at
    RETURNING id
    `,
    [
      identity,
      bet.match_id ?? null,
      market,
      bet.selection,
      line,
      odds,
      now.toISOString(),
      commence,
      modelVersion,
      JSON.stringify(raw),
      PERSONAL_BET_STRATEGY,
      bet.fixture_id ?? null,
    ],
  );
  return inserted.rows[0].id;
}

/**
 * Settle a personal bet against result rows (raw from results table).
 * Handicap without line falls back to score-based home/away (like h2h).
 */
export function settlePersonalBet(bet, resultRows) {
  if (!bet || bet.settlement !== "pending") return null;
  const matchId = bet.match_id;
  if (!matchId || !Array.isArray(resultRows) || resultRows.length === 0) return null;

  const candidates = resultRows.filter((r) =>
    r && (r.matchId === matchId || r.match_id === matchId),
  );
  if (candidates.length === 0) return null;

  // Prefer a row with score for asian markets
  const withScore = candidates.find((r) => typeof r.score === "string" && /\d+\s*-\s*\d+/.test(r.score));
  const result = withScore ?? candidates[0];
  const actual = typeof result.score === "string" ? result.score : result.actual;

  const market = canonicalMarketKey(bet.market) || bet.market;
  const line = finiteOrNull(bet.line);
  let settlement = settleAgainstActual(
    {
      market,
      selection: bet.selection,
      prediction: bet.selection,
      ...(line !== null ? { line } : {}),
    },
    actual,
  );

  // Handicap / h2h without usable line: treat selection as moneyline on score
  if (!settlement && (market === "handicap" || market === "h2h") && line === null) {
    settlement = settleAgainstActual(
      { market: "h2h", selection: bet.selection, prediction: bet.selection },
      actual,
    );
  }

  if (!settlement || settlement === "void" || settlement === "unsettleable") return null;
  return settlement;
}
