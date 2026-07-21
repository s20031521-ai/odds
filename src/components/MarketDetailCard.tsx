import type { MarketDetail } from "../matchDetails";

export function MarketDetailCard(props: { market: string; detail: MarketDetail }): React.ReactElement {
  const { market, detail } = props;
  if (detail.kind === "empty") {
    return (
      <article className="market-detail-card market-detail-card--empty">
        <h3>{market}</h3>
        <p>呢個市場冇盤</p>
      </article>
    );
  }
  if (detail.kind === "insufficient") {
    return (
      <article className="market-detail-card market-detail-card--empty">
        <h3>{market}</h3>
        <p>{detail.note}</p>
      </article>
    );
  }
  return (
    <article className="market-detail-card">
      <h3>{market}</h3>
      <p className="market-detail-card__selection">買：{detail.selection}</p>
      <p className="market-detail-card__odds">
        {formatOdds(detail.odds)}
        <span className="market-detail-card__bookmaker">（{detail.bookmaker}）</span>
      </p>
      <p>模型估 {formatPercent(detail.chance)}，莊家開 {formatPercent(detail.implied)}</p>
      <p>Edge {detail.edge >= 0 ? "+" : ""}{formatPercent(detail.edge)}</p>
      <p>建議注碼 ${detail.stake}</p>
    </article>
  );
}

function formatPercent(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
}

function formatOdds(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "—";
}
