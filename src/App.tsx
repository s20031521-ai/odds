import { useEffect, useMemo, useRef, useState } from "react";
import {
  filterLegacySampleEntries,
  upcomingFixtures,
  type ManualEntry,
} from "./odds";
import { dataLoadStateAfter, dataLoadWarning, type DataLoadState } from "./dataHealth";


import { pageFromHash } from "./route";
import type { Page } from "./route";
import { AppShell } from "./components/AppShell";
import { TeamLogo, type TeamLogoMap } from "./components/TeamLogo";
import { canShowActiveOpportunities, useConnectivityState } from "./pwa";
import { ApiError, createApiClient, type BacktestPendingRow, type BuyableOpportunity, type PredictionObservationsResponse, type SessionState } from "./apiClient";
import { LoginPage } from "./pages/LoginPage";
import { LandingPage } from "./pages/TodayPage";
import { FixturesPage } from "./pages/FixturesPage";
import { PerformancePage } from "./pages/PerformancePage";
import { BetsPage } from "./pages/BetsPage";
import { BetForm } from "./components/BetForm";
import {
  buildFinishedFixturePicks,
  normalizeCatalogResultRow,
  type FixturePick,
} from "./fixtureSearch";
import type { BetCreateRequest } from "./apiClient";
import { startCurrentRecommendationsRefresh } from "./currentRecommendations";
import { normalizeLiveOddsPayload } from "./liveOddsMapping";
import { READINESS_MODELS } from "./readinessModels";
export { READINESS_MODELS };

type ModelReadiness = {
  market: string;
  modelVersion: string;
  settledMatches: number;
  pendingMatches: number;
};

type ResultEntry = {
  id: string;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  score: string;
  market: string;
  line?: number;
  prediction: string;
  actual: string;
  hit: boolean | null;
  settlement?: "win" | "half-win" | "push" | "half-loss" | "loss";
  modelVersion?: string;
  source?: string;
  odds?: number;
  chance?: number;
  edge?: number;
  savedAt?: string;
  snapshotStatus?: string;
  sampleId?: number | string;
};

type HistoryStats = {
  win: number;
  loss: number;
  push: number;
  winPercent: number;
  lossPercent: number;
};

const HDC_REFRESH_MS = 3 * 60 * 1000;
const initialEntries: ManualEntry[] = [];

function summarizeHistoryRows(rows: ResultEntry[]): HistoryStats {
  const win = rows.filter((r) => r.settlement === "win" || r.settlement === "half-win").length;
  const loss = rows.filter((r) => r.settlement === "loss" || r.settlement === "half-loss").length;
  const push = rows.filter((r) => r.settlement === "push").length;
  const decided = win + loss;
  return {
    win,
    loss,
    push,
    winPercent: decided ? Math.round(win / decided * 1000) / 10 : 0,
    lossPercent: decided ? Math.round(loss / decided * 1000) / 10 : 0,
  };
}

function isModelReadiness(item: unknown): item is ModelReadiness {
  return (
    typeof item === "object" && item !== null &&
    typeof (item as Record<string, unknown>).market === "string" &&
    typeof (item as Record<string, unknown>).modelVersion === "string" &&
    typeof (item as Record<string, unknown>).settledMatches === "number" &&
    typeof (item as Record<string, unknown>).pendingMatches === "number"
  );
}

function isResultEntry(item: unknown): item is ResultEntry {
  return (
    typeof item === "object" && item !== null &&
    typeof (item as Record<string, unknown>).id === "string" &&
    typeof (item as Record<string, unknown>).matchId === "string" &&
    typeof (item as Record<string, unknown>).market === "string"
  );
}

function App() {
  const [lastSuccessfulSync, setLastSuccessfulSync] = useState<string | null>(null);
  const connectivity = useConnectivityState(lastSuccessfulSync);
  const apiClient = useMemo(() => createApiClient(), []);
  const [auth, setAuth] = useState<SessionState>({ authenticated: false });
  const [csrfToken, setCsrfToken] = useState("");
  const [authLoading, setAuthLoading] = useState(true);
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState<"invalid" | "rate_limited" | "offline" | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | undefined>(undefined);

  const [entries, setEntries] = useState<ManualEntry[]>(initialEntries);
  const [resultEntries, setResultEntries] = useState<ResultEntry[]>([]);
  /** Raw completed matches from GET /api/v1/results (picker catalog). */
  const [catalogResultRows, setCatalogResultRows] = useState<Array<{
    matchId: string;
    homeTeam?: string;
    awayTeam?: string;
    homeTeamZh?: string;
    awayTeamZh?: string;
    commenceTime?: string | null;
    score?: string;
    fixtureId?: string;
  }>>([]);
  const [pendingEntries, setPendingEntries] = useState<BacktestPendingRow[]>([]);
  const [readiness, setReadiness] = useState<ModelReadiness[]>([]);
  const [dataLoads, setDataLoads] = useState<DataLoadState>({ hkjc: null, hdc: null });
  const [recordedOpportunities, setRecordedOpportunities] = useState<BuyableOpportunity[]>([]);
  const [recommendationsGeneratedAt, setRecommendationsGeneratedAt] = useState<string | null>(null);
  const [recommendationsLoaded, setRecommendationsLoaded] = useState(false);
  const [backtestLoaded, setBacktestLoaded] = useState(false);
  const [betPrefill, setBetPrefill] = useState<Partial<BetCreateRequest> | null>(null);
  const [betSaving, setBetSaving] = useState(false);
  const [betError, setBetError] = useState<string | null>(null);
  const [apiLatencyMs, setApiLatencyMs] = useState<number | null>(null);
  const [apiQuota, setApiQuota] = useState<{ used?: number | null; remaining?: number | null } | null>(null);

  const hdcRefreshRunning = useRef(false);
  const backtestAutoLoadStarted = useRef(false);

  const [page, setPage] = useState<Page>(() => pageFromHash(window.location.hash));
  const [teamLogos, setTeamLogos] = useState<TeamLogoMap>({});

  useEffect(() => {
    let cancelled = false;
    fetch("/team-logos.json")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!cancelled && payload?.teams && typeof payload.teams === "object") setTeamLogos(payload.teams);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiClient.session().then((state) => {
      if (cancelled) return;
      setAuth(state);
      setCsrfToken(state.csrfToken ?? "");
    }).catch(() => {
      if (!cancelled) setAuth({ authenticated: false });
    }).finally(() => {
      if (!cancelled) setAuthLoading(false);
    });
    return () => { cancelled = true; };
  }, [apiClient]);

  async function handleLogin(username: string, password: string) {
    setLoginPending(true);
    setLoginError(null);
    setRetryAfterSeconds(undefined);
    try {
      const state = await apiClient.login(username, password);
      setAuth(state);
      setCsrfToken(state.csrfToken ?? "");
    } catch (error) {
      setAuth({ authenticated: false });
      if (error instanceof ApiError && error.status === 429) {
        setLoginError("rate_limited");
      } else if (error instanceof ApiError && error.status === 401) {
        setLoginError("invalid");
      } else {
        setLoginError("offline");
      }
    } finally {
      setLoginPending(false);
    }
  }

  function clearAuthenticatedState() {
    setAuth({ authenticated: false });
    setCsrfToken("");
    setEntries(initialEntries);
    setResultEntries([]);
    setCatalogResultRows([]);
    setPendingEntries([]);
    setRecordedOpportunities([]);
    setRecommendationsGeneratedAt(null);
    setRecommendationsLoaded(false);
    setBacktestLoaded(false);
    backtestAutoLoadStarted.current = false;
  }

  function handleProtectedError(error: unknown, fallback: string): string {
    if (error instanceof ApiError && error.status === 401) {
      clearAuthenticatedState();
      return "登入已過期，請重新登入";
    }
    return error instanceof Error ? error.message : fallback;
  }

  async function handleLogout() {
    try {
      if (csrfToken) await apiClient.logout(csrfToken);
    } finally {
      clearAuthenticatedState();
    }
  }

  // Kickoff order only — FixturesPage re-sorts by commenceTime; 即將開賽 is a strip, not edge ranking.
  const dashboardFixtures = useMemo(() => upcomingFixtures(entries), [entries]);

  /** 1X2 odds per match for FixtureCard buttons — prefer HKJC bookmaker rows. */
  const fixtureOddsByMatch = useMemo(() => {
    const map = new Map<string, { current: ManualEntry["odds"]; previous?: Partial<ManualEntry["odds"]> | null; bookmaker?: string }>();
    for (const entry of entries) {
      if (!entry?.matchId || !entry.odds) continue;
      const existing = map.get(entry.matchId);
      const isHkjc = /hkjc/i.test(entry.bookmaker ?? "");
      const existingIsHkjc = /hkjc/i.test(existing?.bookmaker ?? "");
      if (!existing || (isHkjc && !existingIsHkjc)) {
        map.set(entry.matchId, { current: entry.odds, previous: entry.previousOdds ?? null, bookmaker: entry.bookmaker });
      }
    }
    return map;
  }, [entries]);

  /**
   * Bet form search pools (grill UX 2026-07-26):
   * - 未完 = live upcoming only
   * - 已完場 = results catalog; hasModel from backtest matchIds
   *   empty search = last 3d + hasModel; typed search = full catalog + aliases
   */
  const betFixtures = useMemo((): FixturePick[] => {
    const upcoming: FixturePick[] = dashboardFixtures.map((f) => ({
      matchId: f.matchId,
      homeTeam: f.homeTeam,
      awayTeam: f.awayTeam,
      homeTeamZh: f.homeTeamZh,
      awayTeamZh: f.awayTeamZh,
      commenceTime: f.commenceTime,
      league: f.league,
      status: "upcoming" as const,
    }));
    const modelMatchIds = resultEntries.map((r) => r.matchId).filter(Boolean);
    const finished = buildFinishedFixturePicks(catalogResultRows, modelMatchIds);
    return [...upcoming, ...finished];
  }, [dashboardFixtures, catalogResultRows, resultEntries]);

  const recommendationsTrusted = canShowActiveOpportunities(connectivity, recommendationsLoaded);
  const activeRecordedOpportunities = recommendationsTrusted ? recordedOpportunities : [];
  const dataWarning = [dataLoadWarning(dataLoads)].filter(Boolean).join(" ");

  const historyStatsByMarket = useMemo(() => {
    const map = new Map<string, HistoryStats>();
    for (const model of READINESS_MODELS) {
      const rows = resultEntries.filter((r) =>
        r.market === model.market &&
        r.modelVersion === model.modelVersion &&
        r.modelVersion !== "legacy-v0"
      );
      map.set(model.market, summarizeHistoryRows(rows));
    }
    return map;
  }, [resultEntries]);

  useEffect(() => {
    const syncPage = () => setPage(pageFromHash(window.location.hash));
    window.addEventListener("hashchange", syncPage);
    return () => window.removeEventListener("hashchange", syncPage);
  }, []);

  useEffect(() => {
    setEntries(filterLegacySampleEntries);
  }, []);

  useEffect(() => {
    if (!auth.authenticated) {
      setRecordedOpportunities([]);
      setRecommendationsGeneratedAt(null);
      setRecommendationsLoaded(false);
      return;
    }
    setRecommendationsLoaded(false);
    return startCurrentRecommendationsRefresh({
      load: apiClient.currentRecommendations,
      onSuccess: (response) => {
        if (response.strategyVersion !== "unified-buyable-v1" || !Array.isArray(response.opportunities)) {
          setRecordedOpportunities([]);
          setRecommendationsGeneratedAt(null);
          setRecommendationsLoaded(false);
          return;
        }
        setRecordedOpportunities(response.opportunities);
        setRecommendationsGeneratedAt(response.generatedAt);
        setRecommendationsLoaded(true);
      },
      onError: (error) => {
        setRecordedOpportunities([]);
        setRecommendationsGeneratedAt(null);
        setRecommendationsLoaded(false);
        if (error instanceof ApiError && error.status === 401) clearAuthenticatedState();
      },
    });
  }, [apiClient, auth.authenticated]);

  useEffect(() => {
    if (!auth.authenticated) return;
    if (!backtestAutoLoadStarted.current) {
      backtestAutoLoadStarted.current = true;
      void loadBacktest();
      void loadCatalogResults();
    }
  }, [auth.authenticated]);

  useEffect(() => {
    if (!auth.authenticated) return;
    void refreshHdcOdds();
    const timer = window.setInterval(() => {
      void refreshHdcOdds();
    }, HDC_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [auth.authenticated]);

  async function loadCatalogResults() {
    try {
      const body = await apiClient.results();
      const raw = Array.isArray(body?.resultEntries) ? body.resultEntries : [];
      const rows = raw.map(normalizeCatalogResultRow).filter((row): row is NonNullable<typeof row> => row !== null);
      setCatalogResultRows(rows);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) clearAuthenticatedState();
    }
  }

  async function loadBacktest() {
    if (backtestLoaded) return;
    try {
      const body = await apiClient.backtest();
      if (!Array.isArray(body?.rows)) return;
      setResultEntries((body.rows as unknown[]).filter(isResultEntry));
      setPendingEntries(Array.isArray(body.pending) ? body.pending : []);
      setReadiness(Array.isArray(body.readiness) ? body.readiness.filter(isModelReadiness) : []);
      setBacktestLoaded(true);
    } catch (error) {
      // A protected feed answering 401 means the session is gone; fail back to login.
      if (error instanceof ApiError && error.status === 401) clearAuthenticatedState();
      // otherwise silently ignore backtest failures
    }
  }

  async function loadRecommendationObservations(sampleId: number): Promise<PredictionObservationsResponse> {
    return apiClient.predictionObservations(sampleId);
  }

  async function refreshHdcOdds() {
    if (hdcRefreshRunning.current) return;
    hdcRefreshRunning.current = true;
    const startedAt = performance.now();
    try {
      const payload = await apiClient.liveOdds();
      setApiLatencyMs(Math.round(performance.now() - startedAt));
      if (payload?.quota) setApiQuota(payload.quota);
      // Flat feed → complete h2h ManualEntry rows only (for fixture lists).
      const normalized = normalizeLiveOddsPayload(payload);
      setEntries((current) => mergeById(current, normalized.entries));
      // The unified live feed carries both HKJC and external provider rows,
      // so one successful fetch freshens both tracked sources.
      setDataLoads((current) => dataLoadStateAfter(dataLoadStateAfter(current, "hkjc", true), "hdc", true));
      setLastSuccessfulSync(new Date().toISOString());
    } catch (error) {
      // A protected feed answering 401 means the session is gone; fail back to login.
      if (error instanceof ApiError && error.status === 401) clearAuthenticatedState();
      setDataLoads((current) => dataLoadStateAfter(dataLoadStateAfter(current, "hkjc", false), "hdc", false));
    } finally {
      hdcRefreshRunning.current = false;
    }
  }

  async function handleUpdateBet(id: string, bet: BetCreateRequest) {
    try {
      await apiClient.updateBet(csrfToken, id, bet);
      setBetPrefill(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearAuthenticatedState();
        return;
      }
      throw error;
    }
  }

  async function handleDeleteBet(id: string) {
    try {
      await apiClient.deleteBet(csrfToken, id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearAuthenticatedState();
        return;
      }
      throw error;
    }
  }

  async function handleCreateBet(bet: BetCreateRequest) {
    setBetSaving(true);
    setBetError(null);
    try {
      await apiClient.createBet(csrfToken, bet);
      setBetPrefill(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearAuthenticatedState();
        return;
      }
      setBetError(error instanceof Error ? error.message : "儲存失敗");
    } finally {
      setBetSaving(false);
    }
  }

  if (authLoading) {
    return (
      <div className="app-loading" role="status">
        <p>載入中…</p>
      </div>
    );
  }

  if (!auth.authenticated) {
    return (
      <LoginPage
        pending={loginPending}
        error={loginError}
        retryAfterSeconds={retryAfterSeconds}
        onLogin={handleLogin}
      />
    );
  }

  return (
    <AppShell
      route={page}
      dataWarning={dataWarning}
      username={auth.session?.username}
      fixtures={betFixtures}
      onLogout={handleLogout}
    >
      {page === "performance" ? (
        <PerformancePage readiness={readiness} historyStats={historyStatsByMarket} results={resultEntries} pending={pendingEntries} dataFreshness={recommendationsGeneratedAt} />
      ) : page === "bets" ? (
        <BetsPage
          loadBets={() => apiClient.bets()}
          onCreateBet={handleCreateBet}
          onUpdateBet={handleUpdateBet}
          onDeleteBet={handleDeleteBet}
          fixtures={betFixtures}
        />
      ) : page === "fixtures" ? (
        <FixturesPage fixtures={dashboardFixtures} logos={teamLogos} oddsByMatch={fixtureOddsByMatch} onBet={setBetPrefill} />
      ) : (
        <LandingPage
          opportunities={activeRecordedOpportunities}
          fixtures={dashboardFixtures}
          generatedAt={recommendationsGeneratedAt}
          dataFresh={recommendationsTrusted}
          logos={teamLogos}
          latencyMs={apiLatencyMs}
          quota={apiQuota}
          loadObservations={loadRecommendationObservations}
          onBet={setBetPrefill}
        />
      )}

      {betPrefill ? (
        <div className="bet-modal-overlay" onClick={() => { if (!betSaving) setBetPrefill(null); }}>
          <div className="bet-modal" onClick={(e) => e.stopPropagation()}>
            <BetForm
              prefill={betPrefill}
              fixtures={betFixtures}
              onSave={handleCreateBet}
              onCancel={() => setBetPrefill(null)}
              saving={betSaving}
            />
            {betError ? <p className="notice error">{betError}</p> : null}
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

export default App;
