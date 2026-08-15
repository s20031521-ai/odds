import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Filter, MoreVertical, Plus, Trophy } from "lucide-react";
import type { BetCreateRequest, BetResponse, BetsListResponse } from "../apiClient";
import { BetForm, type FixturePick } from "../components/BetForm";
import { formatKickoff } from "../components/PickCard";
import { formatPrediction, formatSettlementLabel } from "./PerformancePage";
import { MARKET_LABELS, type MarketKey } from "../market";
import {
  betMatchesDate,
  betMatchesStatus,
  betRoi,
  formatBetRef,
  formatPercent,
  type BetDateFilter,
  type BetStatusFilter,
} from "../betMetrics";

const PAGE_SIZE = 10;

const STATUS_OPTIONS: Array<{ key: BetStatusFilter; label: string }> = [
  { key: "all", label: "所有狀態" },
  { key: "win", label: "中" },
  { key: "loss", label: "錯" },
  { key: "push", label: "走" },
  { key: "pending", label: "待結算" },
];

const DATE_FILTERS: Array<{ key: BetDateFilter; label: string }> = [
  { key: "today", label: "今天" },
  { key: "yesterday", label: "昨天" },
  { key: "week", label: "本週" },
];

function HitRateDonut(props: { hitRate: number | null }): React.ReactElement {
  const value = props.hitRate ?? 0;
  return (
    <div className="donut" aria-hidden="true">
      <svg viewBox="0 0 36 36" className="donut__svg">
        <path
          className="donut__track"
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none"
          strokeWidth="3"
        />
        <path
          className="donut__fill"
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none"
          strokeDasharray={`${value}, 100`}
          strokeLinecap="round"
          strokeWidth="3"
        />
      </svg>
      <span className="donut__icon">
        <Trophy size={18} aria-hidden="true" />
      </span>
    </div>
  );
}

export function BetsPage(props: {
  loadBets: () => Promise<BetsListResponse>;
  onCreateBet: (bet: BetCreateRequest) => Promise<void>;
  onUpdateBet?: (id: string, bet: BetCreateRequest) => Promise<void>;
  onDeleteBet?: (id: string) => Promise<void>;
  fixtures?: FixturePick[];
}): React.ReactElement {
  const [data, setData] = useState<BetsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingBet, setEditingBet] = useState<BetResponse | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<BetStatusFilter>("all");
  const [dateFilter, setDateFilter] = useState<BetDateFilter>("all");
  const [pageIndex, setPageIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const result = await props.loadBets();
      setData(result);
    } catch {
      setError("載入注單失敗");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSave(bet: BetCreateRequest) {
    setSaving(true);
    setError(null);
    try {
      if (editingBet && props.onUpdateBet) {
        await props.onUpdateBet(editingBet.id, bet);
      } else {
        await props.onCreateBet(bet);
      }
      setShowForm(false);
      setEditingBet(null);
      await load();
    } catch {
      setError("儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(bet: BetResponse) {
    if (!props.onDeleteBet) return;
    if (!window.confirm(`刪除注單 ${formatBetRef(bet.id)}？`)) return;
    setMenuFor(null);
    setError(null);
    try {
      await props.onDeleteBet(bet.id);
      await load();
    } catch {
      setError("刪除失敗");
    }
  }

  const bets = useMemo(() => data?.bets ?? [], [data]);
  const summary = data?.summary;

  const filtered = useMemo(() => {
    const rows = bets.filter(
      (bet) => betMatchesStatus(bet.settlement, statusFilter) && betMatchesDate(bet, dateFilter),
    );
    return [...rows].sort((a, b) => {
      const ta = Date.parse(a.commence_time ?? a.created_at ?? "");
      const tb = Date.parse(b.commence_time ?? b.created_at ?? "");
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });
  }, [bets, statusFilter, dateFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(pageIndex, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    setPageIndex(0);
    setMenuFor(null);
  }, [statusFilter, dateFilter]);

  if (loading) return <p className="muted">載入中…</p>;

  return (
    <section className="bets-page" aria-labelledby="bets-title">
      {summary ? (
        <div className="bets-stats">
          <div className="stat-card">
            <span className="stat-card__label">總注單</span>
            <span className="stat-card__value">{summary.total.toLocaleString()}</span>
            <span className="stat-card__meta">
              <span>已結算 {summary.settled}</span>
              {summary.pending > 0 ? <span>{summary.pending} 注待結算</span> : null}
            </span>
          </div>
          <div className="stat-card stat-card--row">
            <div className="stat-card__col">
              <span className="stat-card__label">勝率</span>
              <span className="stat-card__value stat-card__value--neon">
                {summary.hitRate !== null ? `${summary.hitRate}%` : "—"}
              </span>
              <span className="stat-card__meta"><span>已結算注單</span></span>
            </div>
            <HitRateDonut hitRate={summary.hitRate} />
          </div>
          <div className="stat-card">
            <span className="stat-card__label">總勝出</span>
            <span className="stat-card__value">{summary.win.toLocaleString()}</span>
            <span className="stat-card__meta">
              <span>錯 {summary.loss}</span>
              {summary.push > 0 ? <span>走 {summary.push}</span> : null}
            </span>
          </div>
        </div>
      ) : null}

      <div className="bets-page__controls">
        <div className="bets-page__title-row">
          <h1 id="bets-title" className="page-heading">注單管理</h1>
          <span className="sync-badge">
            <span className="sync-badge__dot" aria-hidden="true" />
            即時同步
          </span>
        </div>
        <div className="bets-page__actions">
          <div className="bets-page__filter">
            <Filter size={16} aria-hidden="true" />
            <select
              aria-label="狀態篩選"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as BetStatusFilter)}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
          </div>
          <button className="primary-button compact" onClick={() => { setEditingBet(null); setShowForm(true); }}>
            <Plus size={16} aria-hidden="true" />
            新增注單
          </button>
        </div>
      </div>

      <div className="bets-page__quick-filters">
        {DATE_FILTERS.map(({ key, label }) => (
          <button
            key={key}
            className={`filter-chip${dateFilter === key ? " active" : ""}`}
            onClick={() => setDateFilter(dateFilter === key ? "all" : key)}
          >
            {label}
          </button>
        ))}
      </div>

      {summary?.byMarket && summary.byMarket.length > 0 ? (
        <div className="bets-by-market">
          <table className="bets-table">
            <thead>
              <tr>
                <th>玩法</th>
                <th>注數</th>
                <th>中</th>
                <th>錯</th>
                <th>走</th>
                <th>中率</th>
              </tr>
            </thead>
            <tbody>
              {summary.byMarket.map((row) => (
                <tr key={row.market}>
                  <td>{MARKET_LABELS[row.market as MarketKey] ?? row.market}</td>
                  <td>{row.total}</td>
                  <td>{row.win}</td>
                  <td className="negative">{row.loss}</td>
                  <td className="muted">{row.push}</td>
                  <td className={row.hitRate !== null && row.hitRate >= 50 ? "positive" : row.hitRate !== null ? "negative" : "muted"}>
                    {row.hitRate !== null ? `${row.hitRate}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {error ? <p className="notice error">{error}</p> : null}

      {showForm ? (
        <div className="bets-page__form-overlay">
          <BetForm
            prefill={editingBet ? {
              matchId: editingBet.match_id ?? undefined,
              homeTeam: editingBet.home_team ?? undefined,
              awayTeam: editingBet.away_team ?? undefined,
              commenceTime: editingBet.commence_time ?? undefined,
              market: editingBet.market,
              selection: editingBet.selection,
              line: editingBet.line ? Number(editingBet.line) : undefined,
              odds: Number(editingBet.odds),
              stake: Number(editingBet.stake),
            } : undefined}
            fixtures={props.fixtures}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setEditingBet(null); }}
            saving={saving}
          />
        </div>
      ) : null}

      {pageRows.length === 0 ? (
        <div className="empty-state">
          <p>{bets.length === 0 ? "未有注單" : "冇注單符合篩選"}</p>
        </div>
      ) : (
        <div className="bets-table-wrap">
          <table className="bets-table">
            <thead>
              <tr>
                <th>編號</th>
                <th>日期/時間</th>
                <th>賽事</th>
                <th>選項</th>
                <th className="num">本金</th>
                <th className="num">賠率</th>
                <th className="num">ROI</th>
                <th className="num">Yield</th>
                <th>狀態</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((bet) => {
                const settled = formatSettlementLabel(bet.settlement);
                const teams = [bet.home_team, bet.away_team].filter(Boolean).join(" 對 ") || bet.match_id || "—";
                const marketLabel = MARKET_LABELS[bet.market as MarketKey] ?? bet.market;
                const stake = Number(bet.stake);
                const odds = Number(bet.odds);
                const roi = betRoi(bet.settlement, stake, odds);
                return (
                  <tr key={bet.id}>
                    <td className="mono muted">{formatBetRef(bet.id)}</td>
                    <td>
                      {bet.commence_time ? (
                        <time dateTime={bet.commence_time}>{formatKickoff(bet.commence_time)}</time>
                      ) : "—"}
                    </td>
                    <td className="bets-table__match">
                      <span>{teams}</span>
                    </td>
                    <td>{marketLabel} · {formatPrediction(bet.selection, bet.line ? Number(bet.line) : undefined)}</td>
                    <td className="num mono">${stake.toFixed(2)}</td>
                    <td className="num mono">{Number.isFinite(odds) ? odds.toFixed(2) : "—"}</td>
                    <td className={`num mono ${roi !== null && roi > 0 ? "positive" : ""}`}>{formatPercent(roi)}</td>
                    <td className={`num mono ${roi !== null && roi > 0 ? "positive" : ""}`}>{formatPercent(roi)}</td>
                    <td>
                      <span className={`settlement settlement--${bet.settlement}`}>{settled.label}</span>
                    </td>
                    <td className="bets-table__actions">
                      {props.onUpdateBet || props.onDeleteBet ? (
                        <div className="row-menu">
                          <button
                            className="icon-button"
                            type="button"
                            aria-label={`注單 ${formatBetRef(bet.id)} 操作`}
                            onClick={() => setMenuFor(menuFor === bet.id ? null : bet.id)}
                          >
                            <MoreVertical size={16} aria-hidden="true" />
                          </button>
                          {menuFor === bet.id ? (
                            <div className="row-menu__dropdown" role="menu">
                              {props.onUpdateBet ? (
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => { setMenuFor(null); setEditingBet(bet); setShowForm(true); }}
                                >
                                  編輯
                                </button>
                              ) : null}
                              {props.onDeleteBet ? (
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="row-menu__danger"
                                  onClick={() => handleDelete(bet)}
                                >
                                  刪除
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="pagination">
            <span className="pagination__info">
              顯示 {safePage * PAGE_SIZE + 1}-{Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} 項，共 {filtered.length.toLocaleString()} 項
            </span>
            <div className="pagination__buttons">
              <button
                className="icon-button"
                type="button"
                aria-label="上一頁"
                disabled={safePage === 0}
                onClick={() => setPageIndex(safePage - 1)}
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label="下一頁"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPageIndex(safePage + 1)}
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
