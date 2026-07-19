import { useState } from "react";
import type { BuyMarket, BuyOpportunity, BuyPick } from "../buyOpportunities";

const MARKET_FILTERS = ["全部市場", "主客和", "大細波", "角球", "亞洲讓球"] as const;
type MarketFilter = (typeof MARKET_FILTERS)[number];

export function filterOpportunitiesByMarket(
  opportunities: BuyOpportunity[],
  market: MarketFilter,
): BuyOpportunity[] {
  if (market === "全部市場") return opportunities.slice();
  return opportunities.filter((opportunity) =>
    [opportunity.primary, ...opportunity.alternatives].some((pick) => pick.market === market));
}

export function BuyDashboard(props: {
  opportunities: BuyOpportunity[];
  generatedAt: string | null;
  dataFresh: boolean;
}): React.ReactElement {
  const [market, setMarket] = useState<MarketFilter>("全部市場");
  const activeOpportunities = props.dataFresh ? props.opportunities : [];
  const visibleOpportunities = filterOpportunitiesByMarket(activeOpportunities, market);
  const picks = activeOpportunities.flatMap((opportunity) => [opportunity.primary, ...opportunity.alternatives]);
  const averageEdge = picks.length ? picks.reduce((sum, pick) => sum + pick.edge, 0) / picks.length : 0;
  const nextKickoff = activeOpportunities.reduce<string | null>((next, opportunity) => {
    if (!next || Date.parse(opportunity.commenceTime) < Date.parse(next)) return opportunity.commenceTime;
    return next;
  }, null);

  return (
    <section className="buy-dashboard" aria-labelledby="buy-dashboard-title">
      <header className="buy-dashboard__header">
        <div>
          <p className="eyebrow">Football odds</p>
          <h1 id="buy-dashboard-title">值得買 Dashboard</h1>
        </div>
        <p className="buy-dashboard__sync">同步時間 {props.generatedAt ? <time dateTime={props.generatedAt}>{props.generatedAt}</time> : "未有成功同步"}</p>
      </header>

      <div className="buy-dashboard__kpis" aria-label="值得買摘要">
        <Kpi label="值得買賽事" value={activeOpportunities.length.toString()} />
        <Kpi label="合資格買盤" value={picks.length.toString()} />
        <Kpi label="平均 Edge" value={formatPercent(averageEdge)} />
        <Kpi label="下一場開賽" value={nextKickoff ? formatDate(nextKickoff) : "—"} />
      </div>

      <div className="buy-dashboard__filters" aria-label="市場篩選">
        {MARKET_FILTERS.map((label) => (
          <button
            aria-pressed={market === label}
            key={label}
            onClick={() => setMarket(label)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {!props.dataFresh ? (
        <div className="buy-dashboard__empty" role="status">資料未更新，暫停顯示買盤。</div>
      ) : activeOpportunities.length === 0 ? (
        <div className="buy-dashboard__empty">
          <p>暫時未有賽事達到 3% Edge。</p>
          <a href="#/fixtures">查看全部賽事</a>
        </div>
      ) : (
        <div className="buy-dashboard__grid">
          {visibleOpportunities.map((opportunity) => (
            <article className="dashboard-card" key={opportunity.matchId}>
              <a className="dashboard-card__link" href={`#/fixtures/${encodeURIComponent(opportunity.matchId)}`}>
                <time dateTime={opportunity.commenceTime}>{formatDate(opportunity.commenceTime)}</time>
                <h2>{opportunity.homeTeamZh ?? opportunity.homeTeam} <span>vs</span> {opportunity.awayTeamZh ?? opportunity.awayTeam}</h2>
                {opportunity.leagueZh ?? opportunity.league ? <p className="dashboard-card__league">{opportunity.leagueZh ?? opportunity.league}</p> : null}
                <PickDetails pick={opportunity.primary} />
              </a>
              {opportunity.alternatives.length ? (
                <div className="dashboard-card__alternatives" aria-label="其他合資格買盤">
                  {opportunity.alternatives.map((pick) => (
                    <span className="dashboard-card__alternative" key={pickKey(pick)}>
                      {pick.market} · {formatSelection(pick)} · {formatPercent(pick.edge)}
                    </span>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function Kpi(props: { label: string; value: string }) {
  return <div className="buy-dashboard__kpi"><span>{props.label}</span><strong>{props.value}</strong></div>;
}

function PickDetails({ pick }: { pick: BuyPick }) {
  return (
    <div className="dashboard-card__pick">
      <strong>{pick.market} · {formatSelection(pick)}</strong>
      <dl>
        <div><dt>莊家</dt><dd>{pick.bookmaker}</dd></div>
        <div><dt>賠率</dt><dd>{formatOdds(pick.odds)}</dd></div>
        <div><dt>機會率</dt><dd>{formatPercent(pick.chance)}</dd></div>
        <div><dt>Edge</dt><dd>{formatPercent(pick.edge)}</dd></div>
      </dl>
    </div>
  );
}

function formatSelection(pick: BuyPick): string {
  return pick.line === undefined ? pick.selection : `${pick.selection} ${formatLine(pick.line)}`;
}

function formatLine(line: number): string {
  return `${line > 0 ? "+" : ""}${Number.isInteger(line) ? line.toFixed(1) : line}`;
}

function formatOdds(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "—";
}

function formatPercent(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "—";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function pickKey(pick: BuyPick): string {
  return `${pick.market}|${pick.line ?? ""}|${pick.selection}|${pick.bookmaker}`;
}

export type { BuyMarket };
