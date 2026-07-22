import type { BuyableOpportunity } from "../apiClient";
import { BuyableOddsRange, type ObservationLoader } from "./BuyableOddsRange";
import { TeamLogo, type TeamLogoMap } from "./TeamLogo";

export function PickCard(props: {
  opportunity: BuyableOpportunity;
  logos: TeamLogoMap;
  loadObservations?: ObservationLoader;
}): React.ReactElement {
  const { opportunity, logos } = props;
  const home = opportunity.homeTeamZh ?? opportunity.homeTeam;
  const away = opportunity.awayTeamZh ?? opportunity.awayTeam;
  return (
    <article className="pick-card">
      <div className="pick-card__summary">
        <span className="pick-card__match">
          <TeamLogo teamName={opportunity.homeTeam} logos={logos} />
          {home} vs {away}
          <TeamLogo teamName={opportunity.awayTeam} logos={logos} />
          <time className="pick-card__kickoff" dateTime={opportunity.commenceTime}>
            {formatKickoff(opportunity.commenceTime)}
          </time>
        </span>
      </div>
      <div className="pick-card__details">
        <BuyableOddsRange opportunity={opportunity} loadObservations={props.loadObservations} />
        <a className="pick-card__analysis-link" href={`#/analysis?match=${encodeURIComponent(opportunity.matchId ?? opportunity.fixtureId)}`}>
          睇單場分析 →
        </a>
      </div>
    </article>
  );
}

export function formatKickoff(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
