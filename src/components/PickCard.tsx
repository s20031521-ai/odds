import { useState } from "react";
import type { BuyableOpportunity } from "../apiClient";
import { BuyableOddsRange, type ObservationLoader } from "./BuyableOddsRange";
import { TeamLogo, type TeamLogoMap } from "./TeamLogo";

const MARKET_LABEL: Record<string, string> = {
  h2h: "主客和",
  totals: "大細波",
  corners: "角球",
  handicap: "讓球",
};

const SELECTION_LABEL: Record<string, string> = {
  home: "主勝",
  away: "客勝",
  draw: "和",
  over: "大",
  under: "細",
};

export function PickCard(props: {
  opportunity: BuyableOpportunity;
  logos: TeamLogoMap;
  loadObservations?: ObservationLoader;
}): React.ReactElement {
  const { opportunity, logos } = props;
  const [expanded, setExpanded] = useState(false);
  const home = opportunity.homeTeamZh ?? opportunity.homeTeam;
  const away = opportunity.awayTeamZh ?? opportunity.awayTeam;
  const market = MARKET_LABEL[opportunity.market] ?? opportunity.market;
  const selection = SELECTION_LABEL[opportunity.selection] ?? opportunity.selection;
  const line = opportunity.line !== undefined ? ` ${opportunity.line > 0 ? "+" : ""}${opportunity.line}` : "";
  const odds = opportunity.bestQuote?.odds;
  const oddsDisplay = odds !== undefined && Number.isFinite(odds) ? `@ ${odds.toFixed(2)}` : "";

  return (
    <article className="pick-card">
      <button
        className="pick-card__summary"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <span className="pick-card__teams">
          <TeamLogo teamName={opportunity.homeTeam} logos={logos} />
          {home} vs {away}
          <TeamLogo teamName={opportunity.awayTeam} logos={logos} />
        </span>
        <time className="pick-card__kickoff" dateTime={opportunity.commenceTime}>
          {formatKickoff(opportunity.commenceTime)}
        </time>
        <span className="pick-card__pick">
          {market} · {selection}{line}  {oddsDisplay}
        </span>
      </button>
      {expanded ? (
        <div className="pick-card__details">
          <BuyableOddsRange opportunity={opportunity} loadObservations={props.loadObservations} />
        </div>
      ) : null}
    </article>
  );
}

export function formatKickoff(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
