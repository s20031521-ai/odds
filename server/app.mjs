import { buildBacktest } from "./domain/backtest.mjs";
import { FRESHNESS_MS, UNIFIED_STRATEGY_VERSION } from "../shared/unified-recommendations.mjs";
import { readJsonBody } from "./http/body.mjs";
import { json, safeError } from "./http/responses.mjs";

const PREDICTION_BODY_LIMIT = 1024 * 1024;

// 單機模式:登入系統已移除。所有請求直接用啟動時解析嘅唯一 owner
// (entry.mjs → resolveOwnerId)。
export function createApp({ repositories, ownerId, readinessCheck = async () => ({ ok: true }), clock = () => new Date(), logger = console } = {}) {
  if (!repositories?.snapshots || !repositories?.results || !repositories?.odds || !repositories?.opportunities) throw new TypeError("repositories are required");
  if (!repositories?.bets) throw new TypeError("repositories.bets is required");
  if (typeof ownerId !== "string" || !ownerId) throw new TypeError("ownerId is required");

  return async function app(req, res) {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const route = `${req.method ?? "GET"} ${url.pathname}`;

      if (route === "GET /internal/health/ready") return await handleReady(res, readinessCheck);
      if (isLegacyRoute(url.pathname)) return safeError(res, 404, "not_found");
      const routeStatus = routeInventoryStatus(req.method ?? "GET", url.pathname);
      if (routeStatus === 404) return safeError(res, 404, "not_found");
      if (routeStatus === 405) return safeError(res, 405, "method_not_allowed");

      if (route === "GET /api/v1/odds/live") return await handleLiveOdds(res, repositories, clock);
      if (route === "GET /api/v1/results") return await handleResults(res, repositories);
      if (route === "GET /api/v1/backtest") return await handleBacktest(res, repositories, clock);
      if (route === "GET /api/v1/recommendations/current") return await handleCurrentRecommendations(res, repositories, clock);
      if (route === "GET /api/v1/predictions/observations") return await handlePredictionObservations(res, repositories, url);
      if (route === "POST /api/v1/predictions") return await handlePredictions(req, res, repositories);
      if (route === "GET /api/v1/bets") return await handleBetsList(res, repositories, ownerId);
      if (route === "POST /api/v1/bets") return await handleBetsCreate(req, res, repositories, ownerId);
      const betIdMatch = url.pathname.match(/^\/api\/v1\/bets\/([^/]+)$/);
      if (betIdMatch && req.method === "PATCH") {
        return await handleBetUpdate(req, res, repositories, ownerId, decodeURIComponent(betIdMatch[1]));
      }
      if (betIdMatch && req.method === "DELETE") {
        return await handleBetDelete(res, repositories, ownerId, decodeURIComponent(betIdMatch[1]));
      }

      return safeError(res, 404, "not_found");
    } catch (error) {
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      if (status >= 500) logger?.error?.(error);
      return safeError(res, status, status === 400 ? "bad_request" : status === 413 ? "body_too_large" : "server_error");
    }
  };
}

async function handleReady(res, readinessCheck) {
  const status = await readinessCheck();
  return json(res, 200, status);
}

async function handleLiveOdds(res, repositories, clock) {
  const entries = await repositories.odds.listLive(new Date(clock()));
  let quota = null;
  if (typeof repositories.collectorState?.get === "function") {
    const state = await repositories.collectorState.get("hdc-collector");
    if (state && (state.quotaUsed != null || state.quotaRemaining != null)) {
      quota = {
        used: state.quotaUsed ?? null,
        remaining: state.quotaRemaining ?? null,
      };
    }
  }
  return json(res, 200, { entries, quota });
}

async function handleResults(res, repositories) {
  const resultEntries = await repositories.results.listAll();
  return json(res, 200, { resultEntries });
}

async function handleBacktest(res, repositories, clock) {
  const [snapshots, results] = await Promise.all([
    repositories.opportunities.listForBacktest(),
    repositories.results.listAll(),
  ]);
  return json(res, 200, buildBacktest(snapshots, results, Date.parse(new Date(clock()).toISOString())));
}

async function handleCurrentRecommendations(res, repositories, clock) {
  const now = new Date(clock());
  const rows = await repositories.opportunities.listCurrent(now);
  const opportunities = rows
    .map((row) => currentOpportunity(row, now.getTime()))
    .filter(Boolean);
  return json(res, 200, {
    generatedAt: now.toISOString(),
    strategyVersion: UNIFIED_STRATEGY_VERSION,
    opportunities,
  });
}

async function handlePredictionObservations(res, repositories, url) {
  const sampleId = positiveInteger(url.searchParams.get("sampleId"));
  if (sampleId === null) return safeError(res, 400, "bad_request");
  const observations = await repositories.opportunities.listObservations(sampleId);
  return json(res, 200, { sampleId, observations });
}

async function handlePredictions(req, res, repositories) {
  const body = await readJsonBody(req, { limitBytes: PREDICTION_BODY_LIMIT });
  const snapshots = Array.isArray(body) ? body : [body];
  const legacySnapshots = snapshots.filter((snapshot) => snapshot?.strategyVersion !== UNIFIED_STRATEGY_VERSION);
  const rejected = snapshots.length - legacySnapshots.length;
  const result = legacySnapshots.length > 0
    ? await repositories.snapshots.insertBatch(legacySnapshots)
    : { inserted: 0, duplicate: 0, rejected: 0, rejectedByReason: {} };
  if (rejected > 0) {
    result.rejected += rejected;
    result.rejectedByReason = { ...result.rejectedByReason, "server-only-strategy": rejected };
  }
  return json(res, 200, result);
}

function currentOpportunity(row, now) {
  const sampleId = positiveInteger(String(row?.sampleId ?? ""));
  const kickoff = Date.parse(row?.commenceTime ?? "");
  const evaluatedAt = Date.parse(row?.lastEvaluatedAt ?? "");
  if (sampleId === null || !Number.isFinite(kickoff) || kickoff <= now || !freshAt(evaluatedAt, now)) return null;
  const quotes = (Array.isArray(row?.quotes) ? row.quotes : [])
    .filter((quote) => freshQuote(quote, evaluatedAt, now))
    .map((quote) => ({ ...quote }))
    .sort(compareQuotes);
  if (quotes.length === 0) return null;
  const odds = quotes.map((quote) => quote.odds);
  return {
    sampleId,
    fixtureId: row.fixtureId,
    matchId: row.matchId,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    homeTeamZh: row.homeTeamZh,
    awayTeamZh: row.awayTeamZh,
    league: row.league,
    leagueZh: row.leagueZh,
    commenceTime: row.commenceTime,
    market: row.market,
    selection: row.selection,
    ...(Number.isFinite(row.line) ? { line: row.line } : {}),
    modelVersion: row.modelVersion,
    strategyVersion: row.strategyVersion,
    quoteRange: { min: Math.min(...odds), max: Math.max(...odds), count: quotes.length },
    bestQuote: quotes[0],
    quotes,
    lastEvaluatedAt: row.lastEvaluatedAt,
  };
}

function freshAt(timestamp, now) {
  const age = now - timestamp;
  return Number.isFinite(timestamp) && age >= 0 && age <= FRESHNESS_MS;
}

function freshQuote(quote, evaluatedAt, now) {
  const observedAt = Date.parse(quote?.observedAt ?? "");
  const evaluationAge = evaluatedAt - observedAt;
  const currentAge = now - observedAt;
  return Number.isFinite(quote?.odds) && quote.odds > 1
    && Number.isFinite(observedAt)
    && evaluationAge >= 0 && evaluationAge <= FRESHNESS_MS
    && currentAge >= 0 && currentAge <= FRESHNESS_MS;
}

function compareQuotes(left, right) {
  return right.odds - left.odds
    || String(left.bookmaker ?? "").localeCompare(String(right.bookmaker ?? ""))
    || String(left.provider ?? "").localeCompare(String(right.provider ?? ""));
}

function positiveInteger(value) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function routeInventoryStatus(method, pathname) {
  if (/^\/api\/v1\/bets\/[^/]+$/.test(pathname)) {
    return method === "PATCH" || method === "DELETE" ? null : 405;
  }
  const allowed = ROUTES.get(pathname);
  if (!allowed) return 404;
  return allowed.has(method) ? null : 405;
}

function isLegacyRoute(pathname) {
  return pathname.startsWith("/api/import/")
    || pathname === "/api/odds"
    || pathname === "/api/hdc-live"
    || pathname === "/api/backtest"
    || pathname === "/api/predictions"
    || pathname === "/health";
}

const ROUTES = new Map([
  ["/api/v1/odds/live", new Set(["GET"])],
  ["/api/v1/results", new Set(["GET"])],
  ["/api/v1/backtest", new Set(["GET"])],
  ["/api/v1/recommendations/current", new Set(["GET"])],
  ["/api/v1/predictions/observations", new Set(["GET"])],
  ["/api/v1/predictions", new Set(["POST"])],
  ["/api/v1/bets", new Set(["GET", "POST"])],
  ["/internal/health/ready", new Set(["GET"])],
]);

async function handleBetsList(res, repositories, ownerId) {
  // Backfill: every real bet is a sample; promote any slips missing sample_id.
  await ensurePersonalBetSamples(repositories, ownerId);
  // Lazy settle pending slips that already have results.
  if (typeof repositories.results?.listByMatchId === "function") {
    await repositories.bets.settlePendingWithResults(
      ownerId,
      (matchId) => repositories.results.listByMatchId(matchId),
    );
  }
  const bets = await repositories.bets.listByOwner(ownerId);
  const summary = summarizeBets(bets);
  return json(res, 200, { bets, summary });
}

async function handleBetsCreate(req, res, repositories, ownerId) {
  const body = await readJsonBody(req, { limitBytes: 16 * 1024 });
  if (!body || typeof body.market !== "string" || typeof body.selection !== "string"
    || typeof body.odds !== "number" || typeof body.stake !== "number"
    || body.stake <= 0 || !Number.isFinite(body.odds) || body.odds <= 1) {
    return safeError(res, 400, "bad_request");
  }
  let bet = await repositories.bets.create(ownerId, {
    fixtureId: body.fixtureId,
    matchId: body.matchId,
    sampleId: body.sampleId,
    homeTeam: body.homeTeam,
    homeTeamZh: body.homeTeamZh,
    awayTeam: body.awayTeam,
    awayTeamZh: body.awayTeamZh,
    commenceTime: body.commenceTime,
    market: body.market,
    selection: body.selection,
    line: body.line,
    odds: body.odds,
    stake: body.stake,
    source: body.source ?? "manual",
  });
  // Real money bet → always promote into prediction_snapshots sample pool.
  if (typeof repositories.bets.ensureSample === "function") {
    bet = await repositories.bets.ensureSample(bet) ?? bet;
  }
  // If result already exists (e.g. finished match), settle immediately.
  if (bet?.match_id && typeof repositories.results?.listByMatchId === "function"
    && typeof repositories.bets.settlePendingWithResults === "function") {
    await repositories.bets.settlePendingWithResults(
      ownerId,
      (matchId) => repositories.results.listByMatchId(matchId),
    );
    const refreshed = await repositories.bets.listByOwner(ownerId);
    bet = refreshed.find((row) => row.id === bet.id) ?? bet;
  }
  return json(res, 201, { bet });
}

function validateBetBody(body) {
  return body && typeof body.market === "string" && typeof body.selection === "string"
    && typeof body.odds === "number" && typeof body.stake === "number"
    && body.stake > 0 && Number.isFinite(body.odds) && body.odds > 1;
}

async function handleBetUpdate(req, res, repositories, ownerId, betId) {
  const body = await readJsonBody(req, { limitBytes: 16 * 1024 });
  if (!validateBetBody(body)) return safeError(res, 400, "bad_request");
  const existing = await repositories.bets.getById(ownerId, betId);
  if (!existing) return safeError(res, 404, "not_found");
  if (existing.settlement !== "pending") return safeError(res, 409, "conflict");
  const bet = await repositories.bets.update(ownerId, betId, {
    fixtureId: body.fixtureId,
    matchId: body.matchId,
    homeTeam: body.homeTeam,
    homeTeamZh: body.homeTeamZh,
    awayTeam: body.awayTeam,
    awayTeamZh: body.awayTeamZh,
    commenceTime: body.commenceTime,
    market: body.market,
    selection: body.selection,
    line: body.line,
    odds: body.odds,
    stake: body.stake,
  });
  return json(res, 200, { bet });
}

async function handleBetDelete(res, repositories, ownerId, betId) {
  const removed = await repositories.bets.remove(ownerId, betId);
  if (!removed) return safeError(res, 404, "not_found");
  return json(res, 200, { deleted: betId });
}

async function ensurePersonalBetSamples(repositories, ownerId) {
  if (typeof repositories.bets.listWithoutSample !== "function") return;
  if (typeof repositories.bets.ensureSample !== "function") return;
  const missing = await repositories.bets.listWithoutSample(ownerId);
  for (const bet of missing) {
    try {
      await repositories.bets.ensureSample(bet);
    } catch {
      // don't block list on sample promote failure
    }
  }
}

function summarizeBets(bets) {
  const settled = bets.filter((b) => b.settlement !== "pending");
  const win = settled.filter((b) => b.settlement === "win" || b.settlement === "half-win").length;
  const loss = settled.filter((b) => b.settlement === "loss" || b.settlement === "half-loss").length;
  const push = settled.filter((b) => b.settlement === "push").length;
  const decided = win + loss + push;
  const byMarket = groupBetSummary(settled);
  return {
    total: bets.length,
    settled: settled.length,
    pending: bets.length - settled.length,
    win,
    loss,
    push,
    hitRate: decided > 0 ? Math.round((win / decided) * 1000) / 10 : null,
    byMarket,
  };
}

function groupBetSummary(settled) {
  const groups = new Map();
  for (const b of settled) {
    const g = groups.get(b.market) ?? { total: 0, win: 0, loss: 0, push: 0 };
    g.total++;
    if (b.settlement === "win" || b.settlement === "half-win") g.win++;
    else if (b.settlement === "loss" || b.settlement === "half-loss") g.loss++;
    else if (b.settlement === "push") g.push++;
    groups.set(b.market, g);
  }
  return Array.from(groups.entries())
    .map(([market, g]) => {
      const decided = g.win + g.loss + g.push;
      return {
        market,
        total: g.total,
        win: g.win,
        loss: g.loss,
        push: g.push,
        hitRate: decided > 0 ? Math.round((g.win / decided) * 1000) / 10 : null,
      };
    })
    .sort((a, b) => (b.hitRate ?? -1) - (a.hitRate ?? -1));
}
