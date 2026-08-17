import { useMemo, useState } from "react";
import { TrendingUp, Radar, BrainCircuit } from "lucide-react";
import { formatKickoff } from "../components/PickCard";
import { RadarChart } from "../components/RadarChart";
import { READINESS_MODELS, SHADOW_READINESS_MODELS } from "../readinessModels";
import {
  computeDailyHitRates,
  computeOverallAccuracy,
  computeRollingDiff,
  sparklinePath,
} from "../performanceMetrics";
import type { MarketKey } from "../market";

type PendingEntry = {
  id: string;
  matchId: string;
  market: string;
  prediction: string;
  line: number | null;
  odds: number | null;
  commenceTime: string | null;
  status: "unknown" | "upcoming" | "settling" | "overdue";
  modelVersion?: string;
};

function formatPendingStatus(status: string): { label: string } {
  switch (status) {
    case "upcoming": return { label: "未開賽" };
    case "settling": return { label: "結算中" };
    case "overdue": return { label: "逾期" };
    default: return { label: "未知" };
  }
}

const READINESS_TARGET = 30;

type ModelReadiness = {
  market: string;
  modelVersion: string;
  settledMatches: number;
  pendingMatches: number;
};

type HistoryStats = {
  win: number;
  loss: number;
  push: number;
  winPercent: number;
  lossPercent: number;
};

type ResultEntry = {
  id: string;
  matchId: string;
  homeTeam?: string;
  awayTeam?: string;
  homeTeamZh?: string;
  awayTeamZh?: string;
  commenceTime: string;
  score: string;
  market: string;
  line?: number;
  prediction: string;
  settlement?: "win" | "half-win" | "push" | "half-loss" | "loss";
  modelVersion?: string;
};

/** Prefer zh labels; fall back to English; only then raw matchId. */
export function formatMatchLabel(row: Pick<ResultEntry, "homeTeam" | "awayTeam" | "homeTeamZh" | "awayTeamZh" | "matchId">): string {
  const home = (row.homeTeamZh || row.homeTeam || "").trim();
  const away = (row.awayTeamZh || row.awayTeam || "").trim();
  if (home && away) return `${home} vs ${away}`;
  if (home || away) return home || away;
  return row.matchId || "—";
}

export function formatSettlementLabel(
  settlement: string | undefined | null
): { label: string } {
  switch (settlement) {
    case "win":
      return { label: "中" };
    case "half-win":
      return { label: "半中" };
    case "push":
      return { label: "走" };
    case "half-loss":
      return { label: "半錯" };
    case "loss":
      return { label: "錯" };
    default:
      return { label: "—" };
  }
}

export function formatPrediction(prediction: string, line?: number): string {
  if (line !== undefined && line !== null) {
    return `${prediction} ${line}`;
  }
  return prediction;
}

export function PerformancePage(props: {
  readiness: ModelReadiness[];
  historyStats: Map<string, HistoryStats>;
  results: ResultEntry[];
  pending: PendingEntry[];
  /** ISO timestamp of last successful recommendation refresh (資料新鮮度). */
  dataFreshness?: string | null;
}): React.ReactElement {
  const [selectedMarket, setSelectedMarket] = useState<MarketKey | null>(null);
  const [detailTab, setDetailTab] = useState<"settled" | "pending">("settled");

  const model =
    selectedMarket === null
      ? null
      : READINESS_MODELS.find((m) => m.market === selectedMarket) ?? null;

  /* ---------- Overview aggregations (B4.1 / B4.3) ---------- */
  const overview = useMemo(() => {
    const rows = props.results;
    return {
      accuracy: computeOverallAccuracy(rows),
      sparkline: sparklinePath(computeDailyHitRates(rows)),
      rollingDiff: computeRollingDiff(rows),
    };
  }, [props.results]);

  const radarAxes = useMemo(
    () =>
      READINESS_MODELS.map(({ market, label }) => ({
        label,
        value: props.historyStats.get(market)?.winPercent ?? 0,
      })),
    [props.historyStats],
  );

  const modelVersions = useMemo(
    () => [...new Set(props.readiness.map((r) => r.modelVersion))],
    [props.readiness],
  );

  const freshnessLabel = useMemo(() => {
    if (!props.dataFreshness) return "—";
    const t = Date.parse(props.dataFreshness);
    if (Number.isNaN(t)) return "—";
    const minutes = Math.max(0, Math.round((Date.now() - t) / 60000));
    return minutes === 0 ? "啱啱更新" : `${minutes} 分鐘前`;
  }, [props.dataFreshness]);

  /* ---------- Detail view (kept, reskinned) ---------- */
  if (selectedMarket !== null && model) {
    const readiness = props.readiness.find(
      (r) => r.market === selectedMarket && r.modelVersion === model.modelVersion
    );
    const stats = props.historyStats.get(selectedMarket);
    const settled = readiness?.settledMatches ?? 0;
    const hasStats = stats !== undefined && stats.win + stats.loss > 0;

    const rows = props.results
      .filter(
        (r) =>
          r.market === selectedMarket &&
          r.modelVersion === model.modelVersion
      )
      .sort((a, b) => {
        const ta = Date.parse(a.commenceTime);
        const tb = Date.parse(b.commenceTime);
        if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
        if (Number.isNaN(ta)) return 1;
        if (Number.isNaN(tb)) return -1;
        return tb - ta;
      });

    const pendingRows = props.pending
      .filter(
        (r) =>
          r.market === selectedMarket &&
          r.modelVersion === model.modelVersion
      )
      .sort((a, b) => {
        const ta = Date.parse(a.commenceTime ?? "");
        const tb = Date.parse(b.commenceTime ?? "");
        if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
        if (Number.isNaN(ta)) return 1;
        if (Number.isNaN(tb)) return -1;
        return tb - ta;
      });

    const pendingCount = pendingRows.length;

    return (
      <section
        className="performance-page"
        aria-labelledby="performance-detail-title"
      >
        <header className="performance-detail__header">
          <button
            className="performance-detail__back"
            onClick={() => setSelectedMarket(null)}
            aria-label="返回總覽"
          >
            ← 返回
          </button>
          <h1 id="performance-detail-title" className="page-heading">
            {model.label}
          </h1>
          <div className="performance-detail__summary">
            <span className="performance-detail__count">
              {settled}/{READINESS_TARGET} 場
            </span>
            {hasStats ? (
              <span className="performance-detail__accuracy">
                <span className="positive">
                  中 {stats.winPercent.toFixed(1)}%
                </span>
                {" · "}
                <span className="negative">
                  錯 {stats.lossPercent.toFixed(1)}%
                </span>
                {stats.push > 0 ? (
                  <small> · 走盤 {stats.push}</small>
                ) : null}
              </span>
            ) : (
              <span className="muted">
                {settled === 0 ? "尚未有數據" : "樣本不足"}
              </span>
            )}
          </div>
        </header>

        <nav className="performance-detail__tabs">
          <button
            className={detailTab === "settled" ? "active" : ""}
            onClick={() => setDetailTab("settled")}
          >
            已結算
          </button>
          <button
            className={detailTab === "pending" ? "active" : ""}
            onClick={() => setDetailTab("pending")}
          >
            未結算{pendingCount > 0 ? ` (${pendingCount})` : ""}
          </button>
        </nav>

        {detailTab === "settled" ? (
          <>
        {rows.length === 0 ? (
          <div className="performance-detail__empty">
            <p>呢個盤口暫時未有已結算結果</p>
            <button
              className="secondary-button"
              onClick={() => setSelectedMarket(null)}
            >
              返回總覽
            </button>
          </div>
        ) : (
          <div className="performance-detail__table-wrap">
            <table className="performance-detail__table">
              <thead>
                <tr>
                  <th>對賽</th>
                  <th>開賽</th>
                  <th>揀邊</th>
                  <th>結果</th>
                  <th>比分</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const settlement = formatSettlementLabel(row.settlement);
                  return (
                    <tr key={row.id}>
                      <td>{formatMatchLabel(row)}</td>
                      <td>
                        <time dateTime={row.commenceTime}>
                          {formatKickoff(row.commenceTime)}
                        </time>
                      </td>
                      <td>{formatPrediction(row.prediction, row.line)}</td>
                      <td
                        className={`settlement settlement--${row.settlement ?? "pending"}`}
                      >
                        {settlement.label}
                      </td>
                      <td>{row.score || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
          </>
        ) : (
          <>
        {pendingRows.length === 0 ? (
          <div className="performance-detail__empty">
            <p>呢個盤口暫時未有未結算記錄</p>
          </div>
        ) : (
          <div className="performance-detail__table-wrap">
            <table className="performance-detail__table">
              <thead>
                <tr>
                  <th>賽事 ID</th>
                  <th>開賽</th>
                  <th>揀邊</th>
                  <th>賠率</th>
                  <th>狀態</th>
                </tr>
              </thead>
              <tbody>
                {pendingRows.map((row) => {
                  const status = formatPendingStatus(row.status);
                  return (
                    <tr key={row.id}>
                      <td>{row.matchId}</td>
                      <td>
                        {row.commenceTime ? (
                          <time dateTime={row.commenceTime}>
                            {formatKickoff(row.commenceTime)}
                          </time>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{formatPrediction(row.prediction, row.line ?? undefined)}</td>
                      <td>{row.odds !== null ? row.odds.toFixed(2) : "—"}</td>
                      <td className={`settlement settlement--${row.status}`}>
                        {status.label}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
          </>
        )}
      </section>
    );
  }

  /* ---------- Overview ---------- */
  return (
    <section className="performance-page" aria-labelledby="performance-title">
      <header>
        <h1 id="performance-title" className="page-heading">表現分析</h1>
        <p className="performance-page__sub mono">
          模型 {modelVersions.join(" · ") || "—"}
        </p>
      </header>

      <div className="performance-overview">
        <div className="performance-overview__main">
          <div className="accuracy-callout">
            <span className="accuracy-callout__label">
              <span className="accuracy-callout__dot" aria-hidden="true" />
              整體準確率
            </span>
            <div className="accuracy-callout__row">
              <span className="accuracy-callout__value">
                {overview.accuracy !== null ? (
                  <>
                    {overview.accuracy}
                    <span className="accuracy-callout__percent">%</span>
                  </>
                ) : "—"}
              </span>
              {overview.sparkline ? (
                <svg
                  className="accuracy-callout__sparkline"
                  viewBox="0 0 200 80"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path d={overview.sparkline} />
                </svg>
              ) : null}
              {overview.rollingDiff !== null ? (
                <span className="accuracy-callout__diff">
                  <span className="accuracy-callout__diff-label">7天滾動平均</span>
                  <span className="accuracy-callout__diff-value">
                    <TrendingUp size={14} aria-hidden="true" />
                    {overview.rollingDiff > 0 ? "+" : ""}
                    {overview.rollingDiff}% 差異
                  </span>
                </span>
              ) : null}
            </div>
            <div className="accuracy-callout__track" aria-hidden="true">
              <div
                className="accuracy-callout__fill"
                style={{ width: `${overview.accuracy ?? 0}%` }}
              />
            </div>
          </div>

          <h2 className="performance-section-heading">市場校準</h2>
          <div className="performance-grid">
            {READINESS_MODELS.map(({ market, label, modelVersion }) => {
              const readiness = props.readiness.find(
                (r) => r.market === market && r.modelVersion === modelVersion
              );
              const stats = props.historyStats.get(market);
              const settled = readiness?.settledMatches ?? 0;
              const percent = Math.min(
                100,
                Math.round((settled / READINESS_TARGET) * 100)
              );
              const hasStats = stats !== undefined && stats.win + stats.loss > 0;

              return (
                <button
                  className="performance-card"
                  key={market}
                  onClick={() => { setSelectedMarket(market); setDetailTab("settled"); }}
                  type="button"
                >
                  <div className="performance-card__head">
                    <h2>{label}</h2>
                    <span className="performance-card__count mono">
                      n={settled.toLocaleString()}
                    </span>
                  </div>
                  {hasStats ? (
                    <p className="performance-card__hitrate">
                      <span className="performance-card__hitrate-value">
                        {stats.winPercent.toFixed(1)}%
                      </span>
                      <small className="muted">
                        錯 {stats.lossPercent.toFixed(1)}%
                        {stats.push > 0 ? ` · 走盤 ${stats.push}` : ""}
                      </small>
                    </p>
                  ) : (
                    <p className="performance-card__accuracy muted">
                      {settled === 0 ? "尚未有數據" : "樣本不足"}
                    </p>
                  )}
                  <div
                    className="performance-card__bar"
                    role="img"
                    aria-label={`樣本進度 ${settled}/${READINESS_TARGET} 場`}
                  >
                    <span style={{ width: `${percent}%` }} />
                  </div>
                  <span className="performance-card__count mono">
                    {settled}/{READINESS_TARGET} 場
                  </span>
                  <span className="performance-card__chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
              );
            })}
          </div>

          <h2 className="performance-section-heading">影子模型（實驗中）</h2>
          <div className="performance-grid">
            {SHADOW_READINESS_MODELS.map(({ market, label, modelVersion }) => {
              const readiness = props.readiness.find(
                (r) => r.market === market && r.modelVersion === modelVersion
              );
              const settled = readiness?.settledMatches ?? 0;
              const percent = Math.min(
                100,
                Math.round((settled / READINESS_TARGET) * 100)
              );

              return (
                <div className="performance-card" key={`shadow-${market}-${modelVersion}`}>
                  <div className="performance-card__head">
                    <h2>{label}</h2>
                    <span className="performance-card__count mono">
                      n={settled.toLocaleString()}
                    </span>
                  </div>
                  <p className="performance-card__accuracy muted">
                    {settled === 0 ? "收集緊數據" : "影子模式 · 唔會出推薦"}
                  </p>
                  <div
                    className="performance-card__bar"
                    role="img"
                    aria-label={`影子樣本進度 ${settled}/${READINESS_TARGET} 場`}
                  >
                    <span style={{ width: `${percent}%` }} />
                  </div>
                  <span className="performance-card__count mono">
                    {settled}/{READINESS_TARGET} 場
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <aside className="performance-overview__side">
          <div className="insights-panel">
            <h3 className="insights-panel__heading">
              <BrainCircuit size={16} aria-hidden="true" />
              模型洞察
            </h3>
            <div className="insights-panel__row">
              <span className="insights-panel__label">資料新鮮度</span>
              <span className="insights-panel__value mono">{freshnessLabel}</span>
            </div>
            <div className="insights-panel__row">
              <span className="insights-panel__label">模型版本</span>
              <span className="insights-panel__value mono">
                {modelVersions.join(" · ") || "—"}
              </span>
            </div>
          </div>

          <div className="radar-panel">
            <h3 className="insights-panel__heading">
              <Radar size={16} aria-hidden="true" />
              各玩法中率
            </h3>
            <RadarChart axes={radarAxes} />
          </div>
        </aside>
      </div>
    </section>
  );
}
