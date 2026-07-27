import { useEffect, useState } from "react";
import type { BetCreateRequest, BetsListResponse } from "../apiClient";
import { BetForm, type FixturePick } from "../components/BetForm";
import { formatKickoff } from "../components/PickCard";
import { formatPrediction, formatSettlementLabel } from "./PerformancePage";
import { MARKET_LABELS, type MarketKey } from "../market";

export function BetsPage(props: {
  loadBets: () => Promise<BetsListResponse>;
  onCreateBet: (bet: BetCreateRequest) => Promise<void>;
  fixtures?: FixturePick[];
}): React.ReactElement {
  const [data, setData] = useState<BetsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
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
      await props.onCreateBet(bet);
      setShowForm(false);
      await load();
    } catch {
      setError("儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="muted">載入中…</p>;

  const bets = data?.bets ?? [];
  const summary = data?.summary;

  return (
    <section className="bets-page" aria-labelledby="bets-title">
      <div className="bets-page__head">
        <h1 id="bets-title" className="page-heading">注單</h1>
        <button className="primary-button compact" onClick={() => setShowForm(true)}>
          + 新增注單
        </button>
      </div>

      {summary ? (
        <div className="bets-summary">
          <span>{summary.total} 注 · 已結算 {summary.settled}</span>
          {summary.hitRate !== null ? (
            <span className="positive">中率 {summary.hitRate}%</span>
          ) : null}
          {summary.win > 0 ? <span>中 {summary.win}</span> : null}
          {summary.loss > 0 ? <span className="negative">錯 {summary.loss}</span> : null}
          {summary.push > 0 ? <span className="muted">走 {summary.push}</span> : null}
          {summary.pending > 0 ? <span className="muted">{summary.pending} 注待結算</span> : null}
        </div>
      ) : null}

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
            fixtures={props.fixtures}
            onSave={handleSave}
            onCancel={() => setShowForm(false)}
            saving={saving}
          />
        </div>
      ) : null}

      {bets.length === 0 ? (
        <div className="empty-state">
          <p>未有注單</p>
        </div>
      ) : (
        <div className="bets-table-wrap">
          <table className="bets-table">
            <thead>
              <tr>
                <th>賽事</th>
                <th>盤口</th>
                <th>揀邊</th>
                <th>賠率</th>
                <th>注碼</th>
                <th>結果</th>
              </tr>
            </thead>
            <tbody>
              {bets.map((bet) => {
                const settled = formatSettlementLabel(bet.settlement);
                const teams = [bet.home_team, bet.away_team].filter(Boolean).join(" vs ") || bet.match_id || "—";
                const marketLabel = MARKET_LABELS[bet.market as MarketKey] ?? bet.market;
                return (
                  <tr key={bet.id}>
                    <td className="bets-table__match">
                      <span>{teams}</span>
                      {bet.commence_time ? (
                        <span className="subtext">{formatKickoff(bet.commence_time)}</span>
                      ) : null}
                    </td>
                    <td>{marketLabel}</td>
                    <td>{formatPrediction(bet.selection, bet.line ? Number(bet.line) : undefined)}</td>
                    <td>{Number(bet.odds).toFixed(2)}</td>
                    <td>{Number(bet.stake)}</td>
                    <td className={`settlement settlement--${bet.settlement}`}>{settled.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
