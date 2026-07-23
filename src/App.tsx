import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeEntries,
  filterLegacySampleEntries,
  sortFixturesByBestEdge,
  upcomingFixtures,
  type AnalysisRow,
  type AnalyzerSettings,
  type ManualEntry,
} from "./odds";
import { dataFreshFromHealth, dataHealthWarning, dataLoadsReady, dataLoadStateAfter, dataLoadWarning, type DataHealth, type DataLoadState } from "./dataHealth";

import { buildTotalsCards, type TotalsMarketEntry } from "./oddsApi";
import { buildHandicapCards, type HandicapEntry } from "./handicap";
import { cornerPickLabel } from "./marketDisplay";

import { pageFromHash } from "./route";
import type { Page } from "./route";
import { AppShell } from "./components/AppShell";
import { TeamLogo, type TeamLogoMap } from "./components/TeamLogo";
import { canShowActiveOpportunities, useConnectivityState } from "./pwa";
import { ApiError, createApiClient, type BuyableOpportunity, type PredictionObservationsResponse, type SessionState } from "./apiClient";
import { LoginPage } from "./pages/LoginPage";
import { LandingPage } from "./pages/TodayPage";
import { FixturesPage } from "./pages/FixturesPage";
import { PerformancePage } from "./pages/PerformancePage";
import { Mascot } from "./components/Kawaii";
import { startCurrentRecommendationsRefresh } from "./currentRecommendations";

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

const READINESS_MODELS: Array<{ market: string; modelVersion: string }> = [
  { market: "totals", modelVersion: "totals-loo-v1" },
  { market: "corners", modelVersion: "corner-loo-v1" },
  { market: "handicap", modelVersion: "hdc-loo-v2" },
  { market: "h2h", modelVersion: "consensus-v1" },
];

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
  const [totalEntries, setTotalEntries] = useState<TotalsMarketEntry[]>([]);
  const [cornerEntries, setCornerEntries] = useState<TotalsMarketEntry[]>([]);
  const [handicapEntries, setHandicapEntries] = useState<HandicapEntry[]>([]);
  const [resultEntries, setResultEntries] = useState<ResultEntry[]>([]);
  const [readiness, setReadiness] = useState<ModelReadiness[]>([]);
  const [dataFresh, setDataFresh] = useState(false);
  const [dataLoads, setDataLoads] = useState<DataLoadState>({ hkjc: null, hdc: null });
  const [recordedOpportunities, setRecordedOpportunities] = useState<BuyableOpportunity[]>([]);
  const [recommendationsGeneratedAt, setRecommendationsGeneratedAt] = useState<string | null>(null);
  const [recommendationsLoaded, setRecommendationsLoaded] = useState(false);
  const [backtestLoaded, setBacktestLoaded] = useState(false);

  const [settings] = useState<AnalyzerSettings>({
    bankroll: 1000,
    fractionalKelly: 0.25,
    stakeCapPercent: 0.02,
    edgeThreshold: 0.03,
  });

  const hkjcAutoLoadStarted = useRef(false);
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
    setTotalEntries([]);
    setCornerEntries([]);
    setHandicapEntries([]);
    setResultEntries([]);
    setRecordedOpportunities([]);
    setRecommendationsGeneratedAt(null);
    setRecommendationsLoaded(false);
    setBacktestLoaded(false);
    setDataFresh(false);
    hkjcAutoLoadStarted.current = false;
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

  const rows = useMemo(() => analyzeEntries(entries, settings), [entries, settings]);
  const fixtures = useMemo(() => upcomingFixtures(entries), [entries]);
  const dashboardFixtures = useMemo(() => sortFixturesByBestEdge(fixtures, rows), [fixtures, rows]);

  const totalCards = useMemo(() => buildTotalsCards(totalEntries, settings.edgeThreshold), [totalEntries, settings.edgeThreshold]);
  const cornerCards = useMemo(() => buildTotalsCards(cornerEntries, settings.edgeThreshold).map((card) => ({
    ...card,
    pickLabel: cornerPickLabel(card.pickLabel, card.bookmakerCount),
  })), [cornerEntries, settings.edgeThreshold]);
  const handicapCards = useMemo(() => buildHandicapCards(handicapEntries, settings.edgeThreshold), [handicapEntries, settings.edgeThreshold]);

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
    setDataFresh(dataLoadsReady(dataLoads));
  }, [dataLoads]);

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
    if (!hkjcAutoLoadStarted.current) {
      hkjcAutoLoadStarted.current = true;
      void loadHkjcOdds();
    }
    if (!backtestAutoLoadStarted.current) {
      backtestAutoLoadStarted.current = true;
      void loadBacktest();
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

  async function loadBacktest() {
    if (backtestLoaded) return;
    try {
      const body = await apiClient.backtest();
      if (!Array.isArray(body?.rows)) return;
      setResultEntries((body.rows as unknown[]).filter(isResultEntry));
      setReadiness(Array.isArray(body.readiness) ? body.readiness.filter(isModelReadiness) : []);
      setBacktestLoaded(true);
    } catch {
      // silently ignore backtest failures
    }
  }

  async function loadRecommendationObservations(sampleId: number): Promise<PredictionObservationsResponse> {
    return apiClient.predictionObservations(sampleId);
  }

  async function refreshHdcOdds() {
    if (hdcRefreshRunning.current) return;
    hdcRefreshRunning.current = true;
    try {
      const payload = await apiClient.liveOdds();
      setEntries((current) => mergeById(current, Array.isArray((payload as Record<string, unknown>).entries) ? (payload as Record<string, unknown>).entries as ManualEntry[] : []));
      setHandicapEntries((current) => mergeById(current, Array.isArray((payload as Record<string, unknown>).handicapEntries) ? (payload as Record<string, unknown>).handicapEntries as HandicapEntry[] : []));
      setTotalEntries((current) => mergeById(current, Array.isArray((payload as Record<string, unknown>).totalEntries) ? (payload as Record<string, unknown>).totalEntries as TotalsMarketEntry[] : []));
      setCornerEntries((current) => mergeById(current, Array.isArray((payload as Record<string, unknown>).cornerEntries) ? (payload as Record<string, unknown>).cornerEntries as TotalsMarketEntry[] : []));
      setDataLoads((current) => dataLoadStateAfter(current, "hdc", true));
      setLastSuccessfulSync(new Date().toISOString());
    } catch {
      setDataLoads((current) => dataLoadStateAfter(current, "hdc", false));
    } finally {
      hdcRefreshRunning.current = false;
    }
  }

  async function loadHkjcOdds() {
    try {
      const response = await fetch("/hkjc-odds.json");
      if (!response.ok) throw new Error("HKJC fetch failed");
      const body = await response.json();
      setEntries((current) => mergeById(current, Array.isArray(body?.entries) ? body.entries : []));
      setDataLoads((current) => dataLoadStateAfter(current, "hkjc", true));
    } catch {
      setDataLoads((current) => dataLoadStateAfter(current, "hkjc", false));
    }
  }

  if (authLoading) {
    return (
      <div className="app-loading" role="status">
        <Mascot pose="momonga-loading" />
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
    <AppShell route={page} dataWarning={dataWarning} onLogout={handleLogout}>
      {page === "performance" ? (
        <PerformancePage readiness={readiness} historyStats={historyStatsByMarket} />
      ) : page === "fixtures" ? (
        <FixturesPage fixtures={dashboardFixtures} logos={teamLogos} />
      ) : (
        <LandingPage
          opportunities={activeRecordedOpportunities}
          fixtures={dashboardFixtures}
          generatedAt={recommendationsGeneratedAt}
          dataFresh={dataFresh && recommendationsTrusted}
          logos={teamLogos}
          loadObservations={loadRecommendationObservations}
        />
      )}
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