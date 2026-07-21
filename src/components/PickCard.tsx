import type { BuyOpportunity, BuyPick } from "../buyOpportunities";
import { displayStake } from "../stakeDisplay";
import { TeamLogo, type TeamLogoMap } from "./TeamLogo";

export function PickCard(props: {
  opportunity: BuyOpportunity;
  logos: TeamLogoMap;
  generatedAt: string | null;
}): React.ReactElement {
  const { opportunity, logos } = props;
  const primary = opportunity.primary;
  const home = opportunity.homeTeamZh ?? opportunity.homeTeam;
  const away = opportunity.awayTeamZh ?? opportunity.awayTeam;
  return (
    <details className="pick-card">
      <summary className="pick-card__summary">
        <span className="pick-card__match">
          <TeamLogo teamName={opportunity.homeTeam} logos={logos} />
          {home} vs {away}
          <TeamLogo teamName={opportunity.awayTeam} logos={logos} />
          <time className="pick-card__kickoff" dateTime={opportunity.commenceTime}>
            {formatKickoff(opportunity.commenceTime)}
          </time>
        </span>
        <span className="pick-card__selection">買：{formatSelection(primary)}</span>
        <span className="pick-card__odds">{formatOdds(primary.odds)}</span>
        <span className="pick-card__toggle" aria-hidden="true">詳情▾</span>
      </summary>
      <div className="pick-card__details">
        <p>Edge +{formatPercent(primary.edge)}</p>
        <p>模型估 {formatPercent(primary.chance)}，莊家開 {formatPercent(1 / primary.odds)}</p>
        <p>建議注碼 ${displayStake(primary)}</p>
        <p>賠率同步於 {props.generatedAt ?? "未有成功同步"}</p>
        {opportunity.alternatives.length > 0 ? (
          <ul className="pick-card__alternatives">
            {opportunity.alternatives.map((pick) => (
              <li key={pickKey(pick)}>
                {formatSelection(pick)} @ {formatOdds(pick.odds)}（{pick.bookmaker}）
              </li>
            ))}
          </ul>
        ) : null}
        <a className="pick-card__analysis-link" href={`#/analysis?match=${encodeURIComponent(opportunity.matchId)}`}>
          睇單場分析 →
        </a>
      </div>
    </details>
  );
}

export function formatSelection(pick: BuyPick): string {
  return pick.line === undefined ? pick.selection : `${pick.selection} ${formatLine(pick.line)}`;
}

export function formatOdds(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "—";
}

export function formatKickoff(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatLine(line: number): string {
  return Number.isInteger(line) ? line.toFixed(1) : `${line}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function pickKey(pick: BuyPick): string {
  return `${pick.market}|${pick.line ?? ""}|${pick.selection}|${pick.bookmaker}`;
}
