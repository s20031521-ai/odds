import type { BuyOpportunity, BuyPick } from "../buyOpportunities";

export function SimpleDashboard(props: {
  opportunities: BuyOpportunity[];
  generatedAt: string | null;
  dataFresh: boolean;
}): React.ReactElement {
  const activeOpportunities = props.dataFresh ? props.opportunities : [];

  return (
    <section className="simple-dashboard" aria-labelledby="simple-dashboard-title">
      <header className="simple-dashboard__header">
        <h1 id="simple-dashboard-title">值得買</h1>
        <p className="simple-dashboard__sync">同步時間 {props.generatedAt ? <time dateTime={props.generatedAt}>{props.generatedAt}</time> : "未有成功同步"}</p>
      </header>

      {!props.dataFresh ? (
        <div className="simple-dashboard__empty" role="status">資料未更新，暫停顯示買盤。</div>
      ) : activeOpportunities.length === 0 ? (
        <div className="simple-dashboard__empty">暫時冇場次過關</div>
      ) : (
        <div className="simple-dashboard__grid">
          {activeOpportunities.map((opportunity) => (
            <SimpleCard key={opportunity.matchId} opportunity={opportunity} />
          ))}
        </div>
      )}
    </section>
  );
}

function SimpleCard({ opportunity }: { opportunity: BuyOpportunity }): React.ReactElement {
  const picks = [opportunity.primary, ...opportunity.alternatives];
  const league = opportunity.leagueZh ?? opportunity.league;

  return (
    <article className="simple-card">
      <a className="simple-card__link" href={`#/fixtures/${encodeURIComponent(opportunity.matchId)}`}>
        <p className="simple-card__meta">
          {league ? `${league} · ` : ""}<time dateTime={opportunity.commenceTime}>{formatDate(opportunity.commenceTime)}</time>
        </p>
        <h2>{opportunity.homeTeamZh ?? opportunity.homeTeam} <span>vs</span> {opportunity.awayTeamZh ?? opportunity.awayTeam}</h2>
        <ul className="simple-card__picks">
          {picks.map((pick) => (
            <li key={pickKey(pick)}>
              <span>{pick.market} · {formatSelection(pick)}</span>
              <strong>{formatOdds(pick.odds)}</strong>
            </li>
          ))}
        </ul>
      </a>
    </article>
  );
}

function formatSelection(pick: BuyPick): string {
  return pick.line === undefined ? pick.selection : `${pick.selection} ${formatLine(pick.line)}`;
}

function formatLine(line: number): string {
  return `${Number.isInteger(line) ? line.toFixed(1) : line}`;
}

function formatOdds(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "—";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function pickKey(pick: BuyPick): string {
  return `${pick.market}|${pick.line ?? ""}|${pick.selection}|${pick.bookmaker}`;
}
