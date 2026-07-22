import type { PredictionSnapshot } from "./predictionSnapshots";

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
  market: "h2h" | "totals" | "corners" | "handicap";
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

export type BacktestResponse = {
  rows: unknown[];
  summary?: unknown;
  readiness?: unknown[];
  pending?: unknown[];
  snapshotQuality?: unknown;
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
