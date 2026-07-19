import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Calculator, CalendarDays, Loader2 } from "lucide-react";
import {
  analyzeEntries,
  filterLegacySampleEntries,
  hasCompleteOdds,
  sortFixturesByBestEdge,
  upcomingFixtures,
  type AnalysisRow,
  type AnalyzerSettings,
  type ManualEntry,
} from "./odds";
import { formatFixtureDateHeading, groupFixturesByDate } from "./dashboard";
import { dataHealthWarning, type DataHealth } from "./dataHealth";

import { buildTotalsCards, type TotalsMarketEntry } from "./oddsApi";
import { buildHandicapCards, type HandicapEntry } from "./handicap";
import { calibrationBuckets, clearBacktestResponseState, cornerPickLabel, currentModelRows, excludeLegacyRows, filterHistoryRows, groupMarketCards, hasPredictionSnapshot, isSnapshotQuality, predictionDistribution, snapshotQualityMessage, summarizeHistoryRows, summarizePerformanceRows, type SnapshotQuality } from "./marketDisplay";

import { fixtureIdFromHash, pageFromHash } from "./route";
import { postPredictionSnapshots, savePredictionSnapshots, type PredictionSnapshot } from "./predictionSnapshots";
import { bestH2hPick } from "./picks";


type ApiStatus =
  | { type: "idle"; message: string }
  | { type: "loading"; message: string }
  | { type: "success"; message: string }
  | { type: "warning"; message: string }
  | { type: "error"; message: string };


type AnalysisTab = "h2h" | "totals" | "corners" | "handicap";
type HistoryMarket = "主客和" | "角球" | "大細波" | "亞洲讓球";

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
  snapshotStatus?: string;
};

type ModelReadiness = {
  market: HistoryMarket;
  modelVersion: string;
  snapshots: number;
  matches: number;
  settled: number;
  settledMatches: number;
  pending: number;
  pendingMatches: number;
  upcoming: number;
  upcomingMatches: number;
  settling: number;
  settlingMatches: number;
  overdue: number;
  overdueMatches: number;
  unknownPending: number;
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

const HDC_REFRESH_MS = 3 * 60 * 1000;
const UI_BUILD = "ui-2026.07.12.10";

const initialEntries: ManualEntry[] = [];


function App() {
  const [entries, setEntries] = useState<ManualEntry[]>(initialEntries);
  const [totalEntries, setTotalEntries] = useState<TotalsMarketEntry[]>([]);
  const [cornerEntries, setCornerEntries] = useState<TotalsMarketEntry[]>([]);
  const [handicapEntries, setHandicapEntries] = useState<HandicapEntry[]>([]);
  const [resultEntries, setResultEntries] = useState<ResultEntry[]>([]);
  const [readiness, setReadiness] = useState<ModelReadiness[]>([]);
  const [snapshotQuality, setSnapshotQuality] = useState<SnapshotQuality | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [dataWarning, setDataWarning] = useState("");
  const [historyLoading, setHistoryLoading] = useState(() => pageFromHash(window.location.hash) === "history");
  const [historyView, setHistoryView] = useState<"comparable" | "all">("comparable");
  const [historyMarket, setHistoryMarket] = useState<HistoryMarket>("主客和");
  const [analysisMarket, setAnalysisMarket] = useState<HistoryMarket>("大細波");

  const [settings, setSettings] = useState<AnalyzerSettings>({
    bankroll: 1000,
    fractionalKelly: 0.25,
    stakeCapPercent: 0.02,
    edgeThreshold: 0.03,
  });
  const hkjcAutoLoadStarted = useRef(false);
  const resultAutoLoadStarted = useRef(false);
  const hdcRefreshRunning = useRef(false);

  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>("h2h");


  const [page, setPage] = useState(() => pageFromHash(window.location.hash));
  const [fixtureId, setFixtureId] = useState(() => fixtureIdFromHash(window.location.hash));
  const [apiStatus, setApiStatus] = useState<ApiStatus>({
    type: "idle",
    message: "API key 留空都可以用手動輸入。",
  });

  const rows = useMemo(() => analyzeEntries(entries, settings), [entries, settings]);
  const fixtures = useMemo(() => upcomingFixtures(entries), [entries]);
  const dashboardFixtures = useMemo(() => sortFixturesByBestEdge(fixtures, rows), [fixtures, rows]);
  const fixtureDateGroups = useMemo(() => groupFixturesByDate(dashboardFixtures), [dashboardFixtures]);

  const totalCards = useMemo(() => buildTotalsCards(totalEntries, settings.edgeThreshold), [totalEntries, settings.edgeThreshold]);
  const cornerCards = useMemo(() => buildTotalsCards(cornerEntries, settings.edgeThreshold).map((card) => ({
    ...card,
    pickLabel: cornerPickLabel(card.pickLabel, card.bookmakerCount),
  })), [cornerEntries, settings.edgeThreshold]);
  const handicapCards = useMemo(() => buildHandicapCards(handicapEntries, settings.edgeThreshold), [handicapEntries, settings.edgeThreshold]);
  const totalCardGroups = useMemo(() => groupMarketCards(totalCards), [totalCards]);
  const cornerCardGroups = useMemo(() => groupMarketCards(cornerCards), [cornerCards]);
  const visibleResultEntries = useMemo(() => excludeLegacyRows(resultEntries), [resultEntries]);
  const marketResultRows = useMemo(() => filterHistoryRows(visibleResultEntries, historyMarket), [visibleResultEntries, historyMarket]);
  const comparableResultRows = useMemo(() => marketResultRows.filter(hasPredictionSnapshot), [marketResultRows]);
  const comparableMatchCount = useMemo(() => new Set(comparableResultRows.map((row) => row.matchId)).size, [comparableResultRows]);
  const historyStats = useMemo(() => summarizeHistoryRows(marketResultRows), [marketResultRows]);
  const resultRows = historyView === "comparable" ? comparableResultRows : marketResultRows;
  const analysisRows = useMemo(() => filterHistoryRows(visibleResultEntries, analysisMarket).filter((row) => Boolean(row.settlement)), [visibleResultEntries, analysisMarket]);
  const currentAnalysisRows = useMemo(() => currentModelRows(analysisRows), [analysisRows]);
  const marketSummaries = useMemo(() => (["主客和", "角球", "大細波", "亞洲讓球"] as HistoryMarket[]).map((market) => ({
    market,
    summary: summarizePerformanceRows(currentModelRows(filterHistoryRows(visibleResultEntries, market)), () => market)[0] ?? null,
  })), [visibleResultEntries]);
  const modelSummaries = useMemo(() => summarizePerformanceRows(currentAnalysisRows, (row) => row.modelVersion!), [currentAnalysisRows]);
  const directionSummaries = useMemo(() => predictionDistribution(currentAnalysisRows), [currentAnalysisRows]);
  const calibrationSummaries = useMemo(() => calibrationBuckets(currentAnalysisRows), [currentAnalysisRows]);
  const qualityWarning = snapshotQuality ? snapshotQualityMessage(snapshotQuality) : null;
  const selectedPerformance = marketSummaries.find((item) => item.market === analysisMarket)?.summary ?? null;
  const selectedReadiness = excludeLegacyRows(readiness.filter((item) => item.market === analysisMarket));
  const completeEntries = entries.filter((entry) => hasCompleteOdds(entry.odds)).length;
  const valueCount = rows.filter((row) => row.riskLabel === "可能有 value").length;
  const selectedFixture = fixtures.find((fixture) => fixture.matchId === fixtureId) ?? null;
  const selectedRows = selectedFixture ? rows.filter((row) => row.matchId === selectedFixture.matchId) : [];

  useEffect(() => {
    const syncPage = () => {
      const nextPage = pageFromHash(window.location.hash);
      setPage(nextPage);
      if ((nextPage === "history" || nextPage === "analysis") && !resultAutoLoadStarted.current) setHistoryLoading(true);
      setFixtureId(fixtureIdFromHash(window.location.hash));
    };
    window.addEventListener("hashchange", syncPage);
    return () => window.removeEventListener("hashchange", syncPage);
  }, []);

  useEffect(() => {
    setEntries(filterLegacySampleEntries);
  }, []);


  useEffect(() => {
    if (page === "dashboard" && !hkjcAutoLoadStarted.current) {
      hkjcAutoLoadStarted.current = true;
      void loadHkjcOdds();
    }
    if ((page === "history" || page === "analysis") && !resultAutoLoadStarted.current) {
      resultAutoLoadStarted.current = true;
      void loadBacktest();
    }
  }, [page]);

  useEffect(() => {
    if (page !== "dashboard" || !["h2h", "handicap", "totals", "corners"].includes(analysisTab)) return;
    void refreshHdcOdds();
    void refreshDataHealth();
    const timer = window.setInterval(() => {
      void refreshHdcOdds();
      void refreshDataHealth();
    }, HDC_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [page, analysisTab]);

  async function loadBacktest() {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const response = await fetch("http://127.0.0.1:8787/api/backtest", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(body?.rows)) throw new Error("Backend backtest 暫時不可用。");
      setResultEntries(body.rows);
      setReadiness(Array.isArray(body.readiness) ? body.readiness : []);
      setSnapshotQuality(isSnapshotQuality(body.snapshotQuality) ? body.snapshotQuality : null);
    } catch (error) {
      const cleared = clearBacktestResponseState({ resultEntries, readiness, snapshotQuality });
      setResultEntries(cleared.resultEntries);
      setReadiness(cleared.readiness);
      setSnapshotQuality(cleared.snapshotQuality);
      setHistoryError(error instanceof Error ? error.message : "Backend backtest 暫時不可用。");
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    const snapshots = collectPredictionSnapshots(dashboardFixtures, rows, totalCards, cornerCards, handicapCards, settings.edgeThreshold);
    if (snapshots.length > 0) {
      savePredictionSnapshots(snapshots);
      void postPredictionSnapshots(snapshots).catch(() => undefined);
    }
  }, [dashboardFixtures, rows, totalCards, cornerCards, handicapCards, settings.edgeThreshold]);


  async function refreshHdcOdds() {
    if (hdcRefreshRunning.current) return;
    hdcRefreshRunning.current = true;
    try {
      const live = await fetch("http://127.0.0.1:8787/api/hdc-live", { cache: "no-store" });
      if (!live.ok) throw new Error("Background market cache 載入失敗。");
      const payload = await live.json() as { entries?: ManualEntry[]; handicapEntries?: HandicapEntry[]; totalEntries?: TotalsMarketEntry[]; cornerEntries?: TotalsMarketEntry[] };
      setEntries((current) => mergeById(current, Array.isArray(payload.entries) ? payload.entries : []));
      setHandicapEntries((current) => mergeById(current, Array.isArray(payload.handicapEntries) ? payload.handicapEntries : []));
      setTotalEntries((current) => mergeById(current, Array.isArray(payload.totalEntries) ? payload.totalEntries : []));
      setCornerEntries((current) => mergeById(current, Array.isArray(payload.cornerEntries) ? payload.cornerEntries : []));
    } catch (error) {
      setApiStatus({ type: "error", message: error instanceof Error ? error.message : "HDC 即時更新失敗。" });
    } finally {
      hdcRefreshRunning.current = false;
    }
  }

  async function refreshDataHealth() {
    try {
      const response = await fetch("http://127.0.0.1:8787/health", { cache: "no-store" });
      const body = await response.json().catch(() => null) as DataHealth | null;
      if (!response.ok || !body || typeof body.dataFresh !== "boolean" || !Array.isArray(body.staleSources)) {
        throw new Error("invalid health response");
      }
      setDataWarning(dataHealthWarning(body) ?? "");
    } catch {
      setDataWarning("無法檢查資料新鮮度；畫面資料可能唔係最新。");
    }
  }

  async function loadHkjcOdds() {
    setApiStatus({ type: "loading", message: "正在載入馬會賽事。" });
    try {
      const response = await fetch("/hkjc-odds.json", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(body?.entries)) {
        setApiStatus({ type: "warning", message: "未有馬會資料。請先跑 npm run import:hkjc。" });
        return;
      }
      const totalEntries = Array.isArray(body.totalEntries) ? body.totalEntries : [];
      const cornerEntries = Array.isArray(body.cornerEntries) ? body.cornerEntries : [];
      const hkjcHandicapEntries = Array.isArray(body.handicapEntries) ? body.handicapEntries : [];
      const resultEntries = Array.isArray(body.resultEntries) ? body.resultEntries : [];
      setEntries((current) => mergeById(current, body.entries));
      setTotalEntries((current) => mergeById(current, totalEntries));
      setCornerEntries((current) => mergeById(current, cornerEntries));
      setHandicapEntries((current) => mergeById(current.filter((entry) => entry.bookmaker !== "HKJC"), hkjcHandicapEntries));
      setResultEntries((current) => mergeById(current, resultEntries));
      setApiStatus({ type: "success", message: `已載入 ${body.entries.length} 組馬會主客和、${totalEntries.length} 組大細波、${cornerEntries.length} 組角球、${hkjcHandicapEntries.length} 組亞洲讓球、${resultEntries.length} 條完場對比。` });
    } catch (error) {
      setApiStatus({ type: "error", message: error instanceof Error ? error.message : "載入馬會資料時出錯。" });
    }
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Football odds <span className="build-marker">{UI_BUILD}</span></p>
          <h1>{page === "dashboard" ? selectedFixture ? `${selectedFixture.homeTeam} vs ${selectedFixture.awayTeam}` : "賽事 Dashboard" : page === "history" ? "完場對比" : "模型表現分析"}</h1>
          <nav className="page-tabs" aria-label="主要分頁">
            <a aria-current={page === "dashboard" ? "page" : undefined} className={page === "dashboard" ? "active" : ""} href="#/dashboard">Dashboard</a>
            <a aria-current={page === "history" ? "page" : undefined} className={page === "history" ? "active" : ""} href="#/history">完場對比</a>
            <a aria-current={page === "analysis" ? "page" : undefined} className={page === "analysis" ? "active" : ""} href="#/analysis">模型分析</a>
          </nav>
        </div>
        {page === "dashboard" ? <div className="status-strip">
          <Stat label="即將賽事" value={fixtures.length.toString()} />
          <Stat label="有效賠率" value={completeEntries.toString()} />
          <Stat label="可能 value" value={valueCount.toString()} />
        </div> : null}
      </section>

      {page === "dashboard" && dataWarning ? (
        <div className="sample-warning" role="alert"><AlertTriangle size={17} />{dataWarning}</div>
      ) : null}

      {page === "dashboard" ? (
        <nav className="market-tabs" aria-label="Dashboard 分析類型">
          <button aria-pressed={analysisTab === "h2h"} className={analysisTab === "h2h" ? "active" : ""} onClick={() => setAnalysisTab("h2h")} type="button">主客和</button>
          <button aria-pressed={analysisTab === "totals"} className={analysisTab === "totals" ? "active" : ""} onClick={() => setAnalysisTab("totals")} type="button">大細波</button>
          <button aria-pressed={analysisTab === "corners"} className={analysisTab === "corners" ? "active" : ""} onClick={() => setAnalysisTab("corners")} type="button">角球</button>
          <button aria-pressed={analysisTab === "handicap"} className={analysisTab === "handicap" ? "active" : ""} onClick={() => setAnalysisTab("handicap")} type="button">亞洲讓球</button>
        </nav>
      ) : null}

      {page === "dashboard" && analysisTab === "h2h" ? (
      <section className="dashboard-section">
        <Panel title="即將賽事" icon={<CalendarDays size={18} />}>
          {dashboardFixtures.length === 0 ? (
            <div className="empty-state compact">未有賽事。輸入或拉取賠率後會出現喺呢度。</div>
          ) : (
            <div className="fixture-grid">
              {fixtureDateGroups.map((group) => (
                <div className="fixture-day" key={group.date}>
                  <h3>{formatFixtureDateHeading(group.date)}</h3>
                  <div className="fixture-grid">
                    {group.fixtures.map((fixture) => {
                      const fixtureRows = rows.filter((row) => row.matchId === fixture.matchId);
                      const bestPick = bestH2hPick(fixtureRows, settings.edgeThreshold);
                      const isSelected = selectedFixture?.matchId === fixture.matchId;
                      return (
                        <div className={isSelected ? "fixture-card-wrap expanded" : "fixture-card-wrap"} key={fixture.matchId}>
                          <a className={fixture.matchId.startsWith("hkjc-") ? "fixture-card hkjc-card" : "fixture-card"} href={`#/dashboard/${encodeURIComponent(fixture.matchId)}`}>
                            <span className="fixture-time">{formatDate(fixture.commenceTime)}</span>
                            <strong>{fixture.homeTeam} vs {fixture.awayTeam}</strong>
                            <div className="fixture-meta">
                              <span>{fixture.bookmakerCount} bookmakers</span>
                              <span className="positive">市場 {formatPercent(bestPick.chance)}</span>
                            </div>
                            <div className="simple-pick">{bestPick.label}</div>
                          </a>
                          {isSelected ? <FixtureDetail fixture={fixture} rows={selectedRows} /> : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

        </Panel>
      </section>
      ) : null}

      {page === "analysis" ? (
      <section className="analysis-performance">
        {historyLoading ? (
          <div aria-live="polite" className="empty-state" role="status"><Loader2 aria-hidden="true" className="spin" size={20} /> 正在載入模型表現。</div>
        ) : historyError ? (
          <div className="empty-state" role="alert"><span>{historyError}</span><button className="secondary-button compact" onClick={loadBacktest}>重新載入</button></div>
        ) : (
          <>
            {qualityWarning ? <div className="sample-warning" role="status"><AlertTriangle size={17} />{qualityWarning}</div> : null}
            <div className="performance-market-grid" aria-label="市場模型表現">
              {marketSummaries.map(({ market, summary }) => (
                <button aria-pressed={analysisMarket === market} className={analysisMarket === market ? "performance-market-card active" : "performance-market-card"} key={market} onClick={() => setAnalysisMarket(market)} type="button">
                  <span>{market}</span>
                  {summary ? (
                    <>
                      <strong>{summary.hitRate === null ? "—" : formatPercent(summary.hitRate)}</strong>
                      <small>現行 · {summary.matches} 場 · {summary.finished} 盤口</small>
                      <small>ROI {summary.roi === null ? "未有" : formatPercent(summary.roi)} · {summary.priced} 個有效賠率</small>
                    </>
                  ) : <strong className="muted-score">未有可評估樣本</strong>}
                </button>
              ))}
            </div>

            <Panel title={`${analysisMarket} · 資料準備度`} icon={<Calculator size={18} />}>
              {selectedReadiness.length ? <div className="model-summary-grid">
                {selectedReadiness.map((item) => (
                  <article className="model-summary-card readiness-card" key={item.modelVersion}>
                    <div className="readiness-head"><span>{item.modelVersion}</span><b>現行</b></div>
                    <strong>{item.matches} 場 · {item.snapshots} snapshots</strong>
                    <small>已結算 {item.settledMatches} 場 · 未開賽 {item.upcomingMatches} 場 · 正常等待 {item.settlingMatches} 場</small>
                    <small>逾期欠結果 {item.overdueMatches} 場 · 舊資料未分類 {item.unknownPendingMatches} 場</small>
                    <small>賠率 {item.priced}/{item.snapshots} · 機率 {item.chanceCount}/{item.snapshots} · Bookmaker {item.bookmakerCount}/{item.snapshots}</small>
                    {item.chanceAverage !== null ? <small>機率平均 {formatPercent(item.chanceAverage)} · 範圍 {formatPercent(item.chanceMin ?? 0)}–{formatPercent(item.chanceMax ?? 0)}</small> : null}
                    <small>方向 {Object.entries(item.directions).map(([direction, count]) => `${direction} ${count}`).join(" · ") || "未有"}</small>
                    <small>來源 {item.sources.join(" · ") || "未標示"}</small>
                    <div className="health-tags">
                      {item.settledMatches < 30 ? <span>未夠 30 場</span> : null}
                      {item.overdueMatches > 0 ? <span className="danger">逾期欠結果 {item.overdueMatches} 場</span> : null}
                      {item.priced < item.snapshots ? <span>欠賠率 {item.snapshots - item.priced}</span> : null}
                      {item.chanceCount < item.snapshots ? <span>欠機率 {item.snapshots - item.chanceCount}</span> : null}
                      {item.snapshots >= 5 && item.dominantShare >= 0.85 ? <span>方向偏 {item.dominantDirection} {formatPercent(item.dominantShare)}</span> : null}
                    </div>
                  </article>
                ))}
              </div> : <div className="empty-state compact">未有{analysisMarket}賽前 snapshots。</div>}
            </Panel>

            {!selectedPerformance ? (
              <div className="empty-state">暫時未有{analysisMarket}可評估樣本。</div>
            ) : (
              <>
                {selectedPerformance.matches < 30 ? <div className="sample-warning"><AlertTriangle size={17} />只得 {selectedPerformance.matches} 場獨立賽事，暫未適合調整策略。</div> : null}
                <Panel title={`${analysisMarket} · 模型版本`} icon={<Calculator size={18} />}>
                  <div className="model-summary-grid">
                    {modelSummaries.map((summary) => (
                      <article className="model-summary-card" key={summary.key}>
                        <span>{summary.key}</span>
                        <strong>{summary.hitRate === null ? "—" : formatPercent(summary.hitRate)}</strong>
                        <small>{summary.matches} 場 · {summary.finished} 盤口 · {summary.win} 中 / {summary.loss} 錯</small>
                        <small>ROI {summary.roi === null ? "未有足夠有效賠率" : formatPercent(summary.roi)} · 有價 {summary.priced}</small>
                      </article>
                    ))}
                  </div>
                </Panel>

                <div className="performance-detail-grid">
                  <Panel title="現行模型 · 預測方向" icon={<Calculator size={18} />}>
                    {directionSummaries.length ? <div className="performance-bars">
                      {directionSummaries.map((item) => <PerformanceBar key={item.key} label={item.key} value={item.percent} meta={`${item.count} 次`} />)}
                    </div> : <div className="empty-state compact">未有方向資料。</div>}
                  </Panel>
                  <Panel title="現行模型 · 機率校準" icon={<Calculator size={18} />}>
                    {calibrationSummaries.length ? <div className="performance-bars">
                      {calibrationSummaries.map((item) => <PerformanceBar key={item.key} label={item.key} value={item.hitRate} meta={`${item.finished} 個樣本`} />)}
                    </div> : <div className="empty-state compact">未有有效預測機率資料。</div>}
                  </Panel>
                </div>
              </>
            )}
          </>
        )}
      </section>
      ) : null}

      {page === "dashboard" && analysisTab === "totals" ? (
      <section className="totals-section">
        <Panel title="大細波賠率" icon={<Calculator size={18} />}>
          {totalCardGroups.length === 0 ? (
            <div className="empty-state compact"><span>暫時未有已收集嘅大細波盤。</span><button className="secondary-button compact" onClick={refreshHdcOdds}>重新載入</button></div>
          ) : (
            <div className="fixture-grid">
              {totalCardGroups.map((group) => <MarketCardGroup group={group} key={group.matchId} market="totals" />)}
            </div>
          )}
        </Panel>
      </section>
      ) : null}

      {page === "dashboard" && analysisTab === "corners" ? (
      <section className="corners-section">
        <Panel title="角球賠率" icon={<Calculator size={18} />}>
          {cornerCardGroups.length === 0 ? (
            <div className="empty-state compact"><span>暫時未有開賽前 30 分鐘內嘅角球盤。</span><button className="secondary-button compact" onClick={loadHkjcOdds}>重新載入</button></div>
          ) : (
            <div className="fixture-grid">
              {cornerCardGroups.map((group) => <MarketCardGroup group={group} key={group.matchId} market="corners" />)}
            </div>
          )}
        </Panel>
      </section>
      ) : null}

      {page === "dashboard" && analysisTab === "handicap" ? (
      <section className="totals-section">
        <Panel title="HDC 亞洲讓球" icon={<Calculator size={18} />}>
          {handicapCards.length === 0 ? (
            <div className="empty-state compact"><span>暫時未有已收集嘅亞洲讓球盤。</span><button className="secondary-button compact" onClick={refreshHdcOdds}>重新載入</button></div>
          ) : (
            <div className="fixture-grid">
              {handicapCards.map((card) => (
                <div className={`fixture-card market-card${card.hasHkjc ? " hkjc-card" : ""}`} key={`${card.matchId}-${card.line}`}>
                  <span className="fixture-time">{formatDate(card.commenceTime)}</span>
                  <strong>{card.homeTeam} vs {card.awayTeam}</strong>
                  <div className="fixture-meta">
                    <span>{card.bookmakerCount} bookmakers</span>
                    <span>主隊 {formatHandicapLine(card.line)}</span>
                    <span className={card.bookmakerCount > 1 ? "positive" : ""}>{card.bookmakerCount > 1 ? `市場 ${formatPercent(card.bestChance)}` : "未有跨莊同盤"}</span>
                    {card.hasHkjc ? <span className="positive">HKJC 同盤</span> : null}
                  </div>
                  <div className={card.pickLabel.startsWith("買") ? "simple-pick" : "simple-pick neutral"}>{card.pickLabel}{card.pickLabel.startsWith("買") ? ` @ ${card.bestBookmaker} ${card.bestOdds.toFixed(2)}` : ""}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </section>
      ) : null}

      {page === "history" ? (
      <section className="dashboard-section">
        <Panel title="完場紀錄 vs 預測" icon={<CalendarDays size={18} />}>
          {qualityWarning ? <div className="sample-warning" role="status"><AlertTriangle size={17} />{qualityWarning}</div> : null}
          <div className="history-toolbar">
            <div className="history-market-tabs" aria-label="完場市場">
              {(["主客和", "角球", "大細波", "亞洲讓球"] as HistoryMarket[]).map((market) => (
                <button aria-pressed={historyMarket === market} className={historyMarket === market ? "active" : ""} key={market} onClick={() => setHistoryMarket(market)} type="button">{market}</button>
              ))}
            </div>
            <div className="history-score" aria-label={`${historyMarket} 對錯百分比`}>
              <span className="positive">中 {historyStats.winPercent.toFixed(1)}%</span>
              <span className="negative">錯 {historyStats.lossPercent.toFixed(1)}%</span>
              {historyStats.push > 0 ? <small>走盤 {historyStats.push}</small> : null}
            </div>
          </div>
          <div className="history-filters" aria-label="完場記錄篩選">
            <button aria-pressed={historyView === "comparable"} className={historyView === "comparable" ? "active" : ""} onClick={() => setHistoryView("comparable")} type="button">現行模型 {comparableMatchCount} 場 · {comparableResultRows.length} 盤口</button>
            <button aria-pressed={historyView === "all"} className={historyView === "all" ? "active" : ""} onClick={() => setHistoryView("all")} type="button">全部完場資料 {marketResultRows.length}</button>
          </div>
          {historyLoading ? (
            <div aria-live="polite" className="empty-state compact" role="status"><Loader2 aria-hidden="true" className="spin" size={20} /><span>正在載入完場對比。</span></div>
          ) : historyError ? (
            <div className="empty-state compact" role="alert"><span>{historyError}</span><button className="secondary-button compact" onClick={loadBacktest}>重新載入</button></div>
          ) : resultRows.length === 0 ? (
            <div className="empty-state compact">
              <span>{marketResultRows.length > 0 ? `未有附帶賽前 snapshot 嘅${historyMarket}記錄。` : `暫時未有${historyMarket}完場記錄。`}</span>
              {marketResultRows.length > 0 ? <button className="secondary-button compact" onClick={() => setHistoryView("all")}>顯示全部記錄</button> : null}
            </div>
          ) : (
            <div className="fixture-grid">
              {resultRows.map((row) => (
                <div className="fixture-card market-card" key={row.id}>
                  <span className="fixture-time">{formatDate(row.commenceTime)}</span>
                  <strong>{row.homeTeam} vs {row.awayTeam}</strong>
                  <div className="fixture-meta">
                    <span>{row.market}{row.line ? ` ${row.line}` : ""}</span>
                    <span>完場 {row.score}</span>
                    <span className={row.hit === null ? "" : row.hit ? "positive" : "negative"}>{settlementLabel(row.settlement, row.hit)}</span>
                  </div>
                  <div className="simple-pick">估 {row.prediction} → 實際 {row.actual}</div>
                  {row.modelVersion ? <span className="subtext">{row.modelVersion}{row.source ? ` · ${row.source}` : ""}</span> : null}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </section>
      ) : null}
    </main>
  );
}

function PerformanceBar({ label, value, meta }: { label: string; value: number; meta: string }) {
  const percent = Math.max(0, Math.min(100, value * 100));
  return (
    <div className="performance-bar-row">
      <div><strong>{label}</strong><span>{meta} · {percent.toFixed(1)}%</span></div>
      <div aria-label={`${label} ${percent.toFixed(1)}%`} className="performance-bar" role="img"><span style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

type TotalsCard = ReturnType<typeof buildTotalsCards>[number];

function MarketCardGroup({ group, market }: { group: { matchId: string; primary: TotalsCard; lines: TotalsCard[] }; market: "totals" | "corners" }) {
  const card = group.primary;
  const otherLines = group.lines.filter((line) => line.id !== card.id);
  const lineLabel = market === "corners" ? "角球 Line" : "Line";
  return (
    <article className={card.hasHkjc ? "fixture-card market-card hkjc-card" : "fixture-card market-card"}>
      <span className="fixture-time">{formatDate(card.commenceTime)}</span>
      <strong>{card.homeTeam} vs {card.awayTeam}</strong>
      <div className="fixture-meta">
        <span>{card.bookmakerCount} bookmakers</span>
        <span>{lineLabel} {card.line.toFixed(1)}</span>
        <span className={card.bookmakerCount > 1 ? "positive" : ""}>{card.bookmakerCount > 1 ? `市場 ${formatPercent(card.bestChance)}` : "未有跨莊同盤"}</span>
        {card.pickLabel.startsWith("買") ? <span className="positive">Edge {formatPercent(card.bestEdge)}</span> : null}
        {card.hasHkjc ? <span className="source-badge">HKJC</span> : null}
      </div>
      <div className={card.pickLabel.startsWith("買") ? "simple-pick" : "simple-pick neutral"}>
        {card.pickLabel}{card.pickLabel.startsWith("買") ? ` @ ${card.bestBookmaker} ${card.bestOdds.toFixed(2)}` : ""}
      </div>
      {otherLines.length > 0 ? (
        <details className="other-lines">
          <summary>其他 {otherLines.length} 個盤口</summary>
          <div className="line-list">
            {otherLines.map((line) => (
              <div className="line-item" key={line.id}>
                <span>{lineLabel} {line.line.toFixed(1)}</span>
                <span>{line.bookmakerCount} 莊</span>
                <strong className={line.pickLabel.startsWith("買") ? "positive" : ""}>{line.pickLabel}</strong>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </article>
  );
}

function FixtureDetail({ fixture, rows }: { fixture: { commenceTime: string; bookmakerCount: number }; rows: ReturnType<typeof analyzeEntries> }) {
  return (
    <div className="fixture-detail">
      <div className="fixture-detail-head">
        <span>{formatDate(fixture.commenceTime)}</span>
        <span>{fixture.bookmakerCount} bookmakers</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Bookmaker</th>
              <th>Outcome</th>
              <th>Odds</th>
              <th>Edge</th>
              <th>Stake</th>
              <th>Risk</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.bookmaker}</td>
                <td>{row.outcomeLabel}</td>
                <td>{row.odds.toFixed(2)}</td>
                <td className={row.edge > 0 ? "positive" : "negative"}>{formatPercent(row.edge)}</td>
                <td>{formatMoney(row.suggestedStake)}</td>
                <td><span className={`badge ${badgeClass(row.riskLabel)}`}>{row.riskLabel}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="panel">
      <div className="panel-title">
        {icon}
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TotalsPick({ label, fairOdds, edge, stake }: { label: string; fairOdds: number; edge: number; stake: number }) {
  return (
    <div className="totals-pick">
      <div>
        <strong>{label}</strong>
        <span>Fair odds {formatFiniteOdds(fairOdds)} · Edge {formatPercent(edge)}</span>
      </div>
      <span className={`badge ${stake > 0 ? "value" : edge > 0 ? "watch" : "avoid"}`}>
        {stake > 0 ? `建議 ${formatMoney(stake)}` : edge > 0 ? "觀察" : "不建議"}
      </span>
    </div>
  );
}

function CornerPick({ label, fairOdds, edge, stake }: { label: string; fairOdds: number; edge: number; stake: number }) {
  return (
    <div className="corner-pick">
      <div>
        <strong>{label}</strong>
        <span>Fair odds {formatFiniteOdds(fairOdds)} · Edge {formatPercent(edge)}</span>
      </div>
      <span className={`badge ${stake > 0 ? "value" : edge > 0 ? "watch" : "avoid"}`}>
        {stake > 0 ? `建議 ${formatMoney(stake)}` : edge > 0 ? "觀察" : "不建議"}
      </span>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-suffix">
        <input
          type="number"
          min={min}
          max={max}
          step="0.01"
          value={Number.isFinite(value) ? value : 0}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {suffix ? <span>{suffix}</span> : null}
      </div>
    </label>
  );
}

function TextField({
  label,
  value,
  inputMode,
  onChange,
}: {
  label: string;
  value: string;
  inputMode?: "decimal";
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} inputMode={inputMode} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function collectPredictionSnapshots(
  fixtures: Array<{ matchId: string; homeTeam: string; awayTeam: string; commenceTime: string }>,
  rows: AnalysisRow[],
  totalCards: Array<{ matchId: string; line: number; pickLabel: string; commenceTime: string; bestChance: number; bestEdge: number; bestOdds: number; bestBookmaker: string }>,
  cornerCards: Array<{ matchId: string; line: number; pickLabel: string; commenceTime: string; bestChance: number; bestEdge: number; bestOdds: number; bestBookmaker: string }>,
  handicapCards: Array<{ matchId: string; line: number; pickLabel: string; commenceTime: string; bestChance: number; bestEdge: number; bestOdds: number; bestBookmaker: string }>,
  edgeThreshold: number,
): PredictionSnapshot[] {
  const savedAt = new Date().toISOString();
  return [
    ...fixtures.flatMap((fixture) => {
      const pick = bestH2hPick(rows.filter((row) => row.matchId === fixture.matchId), edgeThreshold);
      return toSnapshot(fixture.matchId, "主客和", pick.label.replace(/^買\s*/, ""), fixture.commenceTime, savedAt, "consensus-v1", "market-consensus", undefined, pick.chance, undefined, pick.odds);
    }),
    ...totalCards.flatMap((card) => toSnapshot(card.matchId, "大細波", pickSide(card.pickLabel), card.commenceTime, savedAt, "totals-loo-v1", "leave-one-out-same-line", card.line, card.bestChance, card.bestEdge, card.bestOdds, card.bestBookmaker)),
    ...cornerCards.flatMap((card) => toSnapshot(card.matchId, "角球", pickSide(card.pickLabel), card.commenceTime, savedAt, "corner-loo-v1", "leave-one-out-same-line", card.line, card.bestChance, card.bestEdge, card.bestOdds, card.bestBookmaker)),
    ...handicapCards.flatMap((card) => toSnapshot(card.matchId, "亞洲讓球", card.pickLabel.replace(/^買\s*/, ""), card.commenceTime, savedAt, "hdc-loo-v2", "leave-one-out-same-line", card.line, card.bestChance, card.bestEdge, card.bestOdds, card.bestBookmaker)),
  ];
}

function toSnapshot(matchId: string, market: string, prediction: string, commenceTime: string, savedAt: string, modelVersion: string, source: string, line?: number, chance?: number, edge?: number, odds?: number, bookmaker?: string): PredictionSnapshot[] {
  if ((market !== "亞洲讓球" && market !== "大細波" && !matchId.startsWith("hkjc-")) || prediction.includes("唔買") || new Date(commenceTime).getTime() <= Date.now()) return [];
  return [{ matchId, market, prediction, side: market === "亞洲讓球" && (prediction === "主" || prediction === "客") ? prediction : undefined, commenceTime, savedAt, modelVersion, source, line, chance, edge, odds, bookmaker }];
}

function pickSide(label: string): string {
  if (label.startsWith("買大角")) return "大角";
  if (label.startsWith("買細角")) return "細角";
  if (label.startsWith("買大")) return "大";
  if (label.startsWith("買細")) return "細";
  return "唔買";
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}


function settlementLabel(settlement: ResultEntry["settlement"], hit: boolean | null): string {
  if (settlement === "half-win") return "半中";
  if (settlement === "half-loss") return "半錯";
  if (settlement === "push") return "走水";
  if (settlement === "win" || hit === true) return "中";
  if (settlement === "loss" || hit === false) return "錯";
  return "待對比";
}

function formatHandicapLine(line: number): string {
  return `${line > 0 ? "+" : ""}${Number.isInteger(line) ? line.toFixed(1) : line}`;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return "N/A";
  }
  return `${(value * 100).toFixed(2)}%`;
}

function formatMoney(value: number): string {
  return value <= 0 ? "0.00" : value.toFixed(2);
}

function formatFiniteOdds(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "N/A";
}

function formatDate(value: string): string {
  if (!value) {
    return "未設定時間";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function badgeClass(label: string): string {
  if (label === "可能有 value") {
    return "value";
  }
  if (label === "觀察") {
    return "watch";
  }
  return "avoid";
}

export default App;
