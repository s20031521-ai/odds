import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { BetCreateRequest } from "../apiClient";
import type { OddsSet, OutcomeKey } from "../odds";
import { TeamLogo, type TeamLogoMap } from "./TeamLogo";

export type FixtureOdds = {
  current: OddsSet;
  /** Previous price per outcome (backend Phase-7 history); arrows hidden without it. */
  previous?: Partial<OddsSet> | null;
  bookmaker?: string;
};

const OUTCOME_LABELS: Record<OutcomeKey, string> = {
  home: "1",
  draw: "X",
  away: "2",
};

const OUTCOME_SELECTION: Record<OutcomeKey, string> = {
  home: "home",
  draw: "draw",
  away: "away",
};

function formatCountdown(commenceTime: string, now: number): string | null {
  const kickoff = Date.parse(commenceTime);
  if (!Number.isFinite(kickoff) || kickoff <= now) return null;
  const totalSeconds = Math.floor((kickoff - now) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function MovementIcon(props: { current: number; previous?: number | null }): React.ReactElement | null {
  if (props.previous == null || props.previous === props.current) {
    return props.previous == null ? null : <Minus size={12} className="odds-button__move odds-button__move--flat" aria-hidden="true" />;
  }
  return props.current > props.previous ? (
    <ArrowUp size={12} className="odds-button__move odds-button__move--up" aria-label="賠率上升" />
  ) : (
    <ArrowDown size={12} className="odds-button__move odds-button__move--down" aria-label="賠率下跌" />
  );
}

export function FixtureCard(props: {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamZh?: string;
  awayTeamZh?: string;
  commenceTime: string;
  league?: string;
  leagueZh?: string;
  logos: TeamLogoMap;
  now: number;
  odds?: FixtureOdds | null;
  onBet?: (prefill: Partial<BetCreateRequest>) => void;
  /** 全局搜尋跳入時短暫 highlight */
  highlighted?: boolean;
}): React.ReactElement {
  const countdown = formatCountdown(props.commenceTime, props.now);
  const kickoff = new Date(props.commenceTime);
  const started = !Number.isNaN(kickoff.getTime()) && kickoff.getTime() <= props.now;
  const pad = (n: number) => String(n).padStart(2, "0");
  const kickoffLabel = Number.isNaN(kickoff.getTime())
    ? props.commenceTime
    : `${pad(kickoff.getHours())}:${pad(kickoff.getMinutes())}`;

  function betOn(outcome: OutcomeKey) {
    const odds = props.odds?.current[outcome];
    props.onBet?.({
      matchId: props.matchId,
      homeTeam: props.homeTeam,
      homeTeamZh: props.homeTeamZh,
      awayTeam: props.awayTeam,
      awayTeamZh: props.awayTeamZh,
      commenceTime: props.commenceTime,
      market: "h2h",
      selection: OUTCOME_SELECTION[outcome],
      odds,
      source: "fixtures_odds_button",
    });
  }

  return (
    <article
      className={`fixture-card${props.highlighted ? " fixture-card--highlighted" : ""}`}
      id={`fixture-${props.matchId}`}
    >
      <div className="fixture-card__accent" aria-hidden="true" />
      <header className="fixture-card__head">
        <span className="fixture-card__time mono">{kickoffLabel}</span>
        {countdown ? (
          <span className="fixture-card__countdown mono">倒數 {countdown}</span>
        ) : started ? (
          <span className="fixture-card__started">已開賽</span>
        ) : null}
        {props.leagueZh || props.league ? (
          <span className="fixture-card__league">{props.leagueZh ?? props.league}</span>
        ) : null}
        {props.onBet ? (
          <button
            className="fixture-card__logbet"
            type="button"
            onClick={() =>
              props.onBet?.({
                matchId: props.matchId,
                homeTeam: props.homeTeam,
                homeTeamZh: props.homeTeamZh,
                awayTeam: props.awayTeam,
                awayTeamZh: props.awayTeamZh,
                commenceTime: props.commenceTime,
                source: "fixtures",
              })
            }
          >
            我有買
          </button>
        ) : null}
      </header>
      <div className="fixture-card__body">
        <div className="fixture-card__teams">
          <span className="fixture-card__team">
            <TeamLogo teamName={props.homeTeam} logos={props.logos} />
            {props.homeTeamZh ?? props.homeTeam}
          </span>
          <span className="fixture-card__team">
            <TeamLogo teamName={props.awayTeam} logos={props.logos} />
            {props.awayTeamZh ?? props.awayTeam}
          </span>
        </div>
        {props.odds ? (
          <div className="fixture-card__odds" role="group" aria-label="主客和賠率">
            {(Object.keys(OUTCOME_LABELS) as OutcomeKey[]).map((outcome) => (
              <button
                key={outcome}
                type="button"
                className="odds-button"
                onClick={() => betOn(outcome)}
                disabled={!props.onBet || started}
                title={started ? "已開賽" : undefined}
              >
                <span className="odds-button__label">{OUTCOME_LABELS[outcome]}</span>
                <span className="odds-button__value mono">
                  {props.odds!.current[outcome].toFixed(2)}
                  <MovementIcon
                    current={props.odds!.current[outcome]}
                    previous={props.odds!.previous?.[outcome]}
                  />
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}
