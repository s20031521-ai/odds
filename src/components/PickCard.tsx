import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown } from "lucide-react";
import type { BetCreateRequest, BuyableOpportunity } from "../apiClient";
import { BuyableOddsRange, type ObservationLoader } from "./BuyableOddsRange";
import { formatCountdown } from "./FixtureCard";
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

/** 倒數要每秒跳，先至有趕住落注嘅感覺 */
function useSecondTicker(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function PickCard(props: {
  opportunity: BuyableOpportunity;
  logos: TeamLogoMap;
  loadObservations?: ObservationLoader;
  onBet?: (prefill: Partial<BetCreateRequest>) => void;
  /** 注單管理已記低咗同一場同一盤口 */
  recorded?: boolean;
}): React.ReactElement {
  const { opportunity, logos } = props;
  const [expanded, setExpanded] = useState(false);
  const now = useSecondTicker();
  const home = opportunity.homeTeamZh ?? opportunity.homeTeam;
  const away = opportunity.awayTeamZh ?? opportunity.awayTeam;
  const league = opportunity.leagueZh ?? opportunity.league;
  const market = MARKET_LABEL[opportunity.market] ?? opportunity.market;
  const selection = SELECTION_LABEL[opportunity.selection] ?? opportunity.selection;
  const line = opportunity.line !== undefined ? ` ${opportunity.line > 0 ? "+" : ""}${opportunity.line}` : "";
  const odds = opportunity.bestQuote?.odds;
  const oddsDisplay = odds !== undefined && Number.isFinite(odds) ? `@ ${odds.toFixed(2)}` : "";
  const countdown = formatCountdown(opportunity.commenceTime, now);

  return (
    <article className="pick-card">
      <button
        className="pick-card__summary"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <span className="pick-card__meta">
          {league ? <span className="pick-card__league">{league}</span> : null}
          <time className="pick-card__kickoff" dateTime={opportunity.commenceTime}>
            {formatKickoff(opportunity.commenceTime)}
          </time>
          {countdown ? (
            <span className="pick-card__countdown mono">倒數 {countdown}</span>
          ) : null}
        </span>
        <span className="pick-card__teams">
          <TeamLogo teamName={opportunity.homeTeam} logos={logos} />
          {home} vs {away}
          <TeamLogo teamName={opportunity.awayTeam} logos={logos} />
        </span>
        <span className="pick-card__pick">
          {market} · {selection}{line}  {oddsDisplay}
        </span>
        <ChevronDown
          size={16}
          className={`pick-card__chevron${expanded ? " pick-card__chevron--open" : ""}`}
          aria-hidden="true"
        />
      </button>
      {expanded ? (
        <div className="pick-card__details">
          <BuyableOddsRange opportunity={opportunity} loadObservations={props.loadObservations} />
        </div>
      ) : null}
      {props.onBet ? (
        <div className="pick-card__bet">
          {props.recorded ? (
            <span className="pick-card__recorded">
              <CheckCircle2 size={14} aria-hidden="true" />
              已記 ✓
            </span>
          ) : null}
          <button className="secondary-button compact" type="button"
            onClick={() => props.onBet?.({
              fixtureId: opportunity.fixtureId,
              matchId: opportunity.matchId,
              sampleId: opportunity.sampleId,
              homeTeam: opportunity.homeTeam,
              homeTeamZh: opportunity.homeTeamZh,
              awayTeam: opportunity.awayTeam,
              awayTeamZh: opportunity.awayTeamZh,
              commenceTime: opportunity.commenceTime,
              market: opportunity.market,
              selection: opportunity.selection,
              line: opportunity.line,
              odds: opportunity.bestQuote?.odds,
              source: "today_card",
            })}>
            我有買
          </button>
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
