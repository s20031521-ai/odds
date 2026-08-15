/** Body for POST /api/v1/predictions (client no longer builds local snapshots). */
import type { MarketKey } from "./market";

export type PredictionSnapshot = {
  matchId: string;
  market: MarketKey;
  prediction: string;
  side?: "主" | "客";
  savedAt: string;
  commenceTime: string;
  chance?: number;
  edge?: number;
  odds?: number;
  line?: number;
  modelVersion?: string;
  source?: string;
  bookmaker?: string;
};

export type SessionState = {
  authenticated: boolean;
  csrfToken?: string;
  session?: {
    username: string;
    idleExpiresAt?: string;
    absoluteExpiresAt?: string;
  };
};

export type LiveOddsResponse = {
  entries?: unknown[];
  h2hEntries?: unknown[];
  totalEntries?: unknown[];
  cornerEntries?: unknown[];
  handicapEntries?: unknown[];
  /** The Odds API monthly quota, surfaced by the collector (backend Phase-7). */
  quota?: { used?: number | null; remaining?: number | null } | null;
};

export type ResultsResponse = {
  resultEntries: unknown[];
};

export type BuyableQuote = {
  bookmaker: string;
  provider: string;
  odds: number;
  chance: number;
  edge: number;
  minimumBuyOdds: number;
  observedAt: string;
};

export type BuyableOpportunity = {
  sampleId: number;
  fixtureId: string;
  matchId?: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamZh?: string;
  awayTeamZh?: string;
  league?: string;
  leagueZh?: string;
  commenceTime: string;
  market: MarketKey;
  selection: "home" | "draw" | "away" | "over" | "under";
  line?: number;
  modelVersion: string;
  strategyVersion: "unified-buyable-v1";
  quoteRange: { min: number; max: number; count: number };
  bestQuote: BuyableQuote;
  quotes: BuyableQuote[];
  lastEvaluatedAt: string;
};

export type CurrentRecommendationsResponse = {
  generatedAt: string;
  strategyVersion: "unified-buyable-v1";
  opportunities: BuyableOpportunity[];
};

export type RecommendationObservation = {
  id: number | string;
  fingerprint: string;
  firstEvaluatedAt: string;
  lastEvaluatedAt: string;
  inputs: unknown[];
  buyableQuotes: BuyableQuote[];
};

export type PredictionObservationsResponse = {
  sampleId: number;
  observations: RecommendationObservation[];
};

export type BacktestSettlement = "win" | "half-win" | "push" | "half-loss" | "loss" | "void" | "unsettleable";

export type BacktestRange = {
  lower: number;
  upper: number;
};

export type BacktestQuoteRange = {
  min: number;
  max: number;
  count: number;
};

export type BacktestObservationSummary = {
  count: number;
  firstEvaluatedAt: string | null;
  lastEvaluatedAt: string | null;
  buyableQuoteCount: number;
};

export type BacktestClosingBenchmark = "N/A" | {
  evaluatedAt: string;
  quoteRange: BacktestQuoteRange;
};

export type BacktestRow = {
  id?: string;
  sampleId?: number | string;
  fixtureId?: string;
  matchId?: string;
  homeTeam?: string;
  awayTeam?: string;
  commenceTime?: string | null;
  score?: string;
  market?: string;
  selection?: string;
  prediction: string;
  actual?: string;
  line?: number | null;
  odds?: number;
  chance?: number;
  edge?: number;
  savedAt?: string;
  firstQualifiedAt: string | null;
  lastQualifiedAt: string | null;
  observationSummary: BacktestObservationSummary;
  snapshotStatus?: string;
  modelVersion?: string;
  strategyVersion?: string;
  source?: string;
  quoteRange?: BacktestQuoteRange | null;
  unitProfitRange?: BacktestRange | null;
  closingBenchmark?: BacktestClosingBenchmark;
  settlement: BacktestSettlement | null;
  hit: boolean | null;
};

export type BacktestSummary = {
  finished: number;
  hit: number;
  miss: number;
  push: number;
  hitRate: number;
  priced: number;
  profit: number;
  roi: number | null;
  yield: number | null;
  profitRange?: BacktestRange;
  roiRange?: BacktestRange;
  yieldRange?: BacktestRange;
};

export type BacktestReadiness = {
  market: string;
  modelVersion: string;
  strategyVersion: "unified-buyable-v1";
  snapshots: number;
  settled: number;
  pending: number;
  matches: number;
  settledMatches: number;
  pendingMatches: number;
  upcoming: number;
  settling: number;
  overdue: number;
  unknownPending: number;
  upcomingMatches: number;
  settlingMatches: number;
  overdueMatches: number;
  unknownPendingMatches: number;
  priced: number;
  chanceCount: number;
  chanceAverage: number | null;
  chanceMin: number | null;
  chanceMax: number | null;
  bookmakerCount: number;
  sources: string[];
  directions: Record<string, number>;
  dominantDirection: string;
  dominantShare: number;
};

export type BacktestPendingRow = {
  id: string;
  sampleId?: number | string;
  fixtureId?: string;
  matchId: string;
  market: string;
  selection?: string;
  prediction: string;
  line: number | null;
  odds: number | null;
  chance: number | null;
  edge: number | null;
  commenceTime: string | null;
  savedAt: string;
  firstQualifiedAt: string | null;
  lastQualifiedAt: string | null;
  observationSummary: BacktestObservationSummary;
  modelVersion: string;
  strategyVersion?: string;
  source: string | null;
  status: "unknown" | "upcoming" | "settling" | "overdue";
};

export type BacktestSnapshotQuality = {
  raw: number;
  validCurrent: number;
  legacy: number;
  invalid: number;
  invalidReasons: Record<string, number>;
};

export type BacktestResponse = {
  rows: BacktestRow[];
  summary?: BacktestSummary;
  byMarket?: Record<string, BacktestSummary>;
  buckets?: Record<string, BacktestSummary>;
  readiness?: BacktestReadiness[];
  pending?: BacktestPendingRow[];
  snapshotQuality?: BacktestSnapshotQuality;
};

export type BetResponse = {
  id: string;
  fixture_id: string | null;
  match_id: string | null;
  home_team: string | null;
  away_team: string | null;
  commence_time: string | null;
  market: string;
  selection: string;
  line: string | null;
  odds: string;
  stake: string;
  settlement: string;
  source: string;
  created_at: string;
};

export type BetsListResponse = {
  bets: BetResponse[];
  summary: {
    total: number;
    settled: number;
    pending: number;
    win: number;
    loss: number;
    push: number;
    hitRate: number | null;
    byMarket: {
      market: string;
      total: number;
      win: number;
      loss: number;
      push: number;
      hitRate: number | null;
    }[];
  };
};

export type BetCreateRequest = {
  fixtureId?: string;
  matchId?: string;
  sampleId?: number;
  homeTeam?: string;
  homeTeamZh?: string;
  awayTeam?: string;
  awayTeamZh?: string;
  commenceTime?: string;
  market: string;
  selection: string;
  line?: number;
  odds: number;
  stake: number;
  source?: string;
};

export type PredictionSaveResponse = {
  inserted: number;
  duplicate: number;
  rejected: number;
  rejectedByReason: Record<string, number>;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export function createApiClient(fetchImpl: FetchLike = fetch) {
  return Object.freeze({
    session: () => request<SessionState>(fetchImpl, "/api/v1/session"),
    login: (username: string, password: string) => request<SessionState>(fetchImpl, "/api/v1/auth/login", {
      method: "POST",
      body: { username, password },
    }),
    logout: (csrfToken: string) => request<void>(fetchImpl, "/api/v1/auth/logout", {
      method: "POST",
      csrfToken,
    }),
    liveOdds: () => request<LiveOddsResponse>(fetchImpl, "/api/v1/odds/live"),
    results: () => request<ResultsResponse>(fetchImpl, "/api/v1/results"),
    currentRecommendations: () => request<CurrentRecommendationsResponse>(fetchImpl, "/api/v1/recommendations/current"),
    predictionObservations: (sampleId: number) => request<PredictionObservationsResponse>(fetchImpl, `/api/v1/predictions/observations?sampleId=${encodeURIComponent(String(sampleId))}`),
    backtest: () => request<BacktestResponse>(fetchImpl, "/api/v1/backtest"),
    savePredictions: (csrfToken: string, snapshots: PredictionSnapshot[]) => request<PredictionSaveResponse>(fetchImpl, "/api/v1/predictions", {
      method: "POST",
      csrfToken,
      body: snapshots,
    }),
    bets: () => request<BetsListResponse>(fetchImpl, "/api/v1/bets"),
    createBet: (csrfToken: string, bet: BetCreateRequest) => request<{ bet: BetResponse }>(fetchImpl, "/api/v1/bets", {
      method: "POST",
      csrfToken,
      body: bet,
    }),
    updateBet: (csrfToken: string, id: string, bet: BetCreateRequest) => request<{ bet: BetResponse }>(fetchImpl, `/api/v1/bets/${encodeURIComponent(id)}`, {
      method: "PATCH",
      csrfToken,
      body: bet,
    }),
    deleteBet: (csrfToken: string, id: string) => request<void>(fetchImpl, `/api/v1/bets/${encodeURIComponent(id)}`, {
      method: "DELETE",
      csrfToken,
    }),
  });
}

async function request<T>(
  fetchImpl: FetchLike,
  path: string,
  options: { method?: string; csrfToken?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if ("body" in options) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  if (options.csrfToken) headers["x-csrf-token"] = options.csrfToken;

  const response = await fetchImpl(path, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    headers,
    body,
  });
  const payload = await parseJson(response, { tolerateInvalid: !response.ok });
  if (!response.ok) throw new ApiError(errorMessage(payload), response.status);
  return payload as T;
}

async function parseJson(response: Response, { tolerateInvalid = false } = {}): Promise<unknown> {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  } catch {
    if (tolerateInvalid) return undefined;
    throw new ApiError("invalid_response", 0);
  }
}

function errorMessage(payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  return "request_failed";
}
