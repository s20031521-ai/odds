import type { BuyOpportunity } from "../buyOpportunities";
import { EmptyState } from "../components/EmptyState";
import { FreshnessBar } from "../components/FreshnessBar";
import { formatKickoff, PickCard } from "../components/PickCard";
import { TeamLogo, type TeamLogoMap } from "../components/TeamLogo";
import type { Fixture } from "../odds";

const MAX_PICK_CARDS = 5;
const UPCOMING_FIXTURE_COUNT = 3;

export function TodayPage(props: {
  opportunities: BuyOpportunity[];
  fixtures: Fixture[];
  generatedAt: string | null;
  dataFresh: boolean;
  logos: TeamLogoMap;
  now?: number;
  onShowAll?: () => void;
}): React.ReactElement {
  const now = props.now ?? Date.now();
  const active = props.dataFresh ? props.opportunities : [];
  const visible = active.slice(0, MAX_PICK_CARDS);
  const overflow = active.length - visible.length;
  return (
    <section className="today-page" aria-labelledby="today-page-title">
      <h1 id="today-page-title" className="page-heading">今日</h1>
      <FreshnessBar generatedAt={props.generatedAt} dataFresh={props.dataFresh} now={now} />
      {!props.dataFresh ? (
        <EmptyState reason="stale" />
      ) : active.length === 0 ? (
        <EmptyState
          reason={props.fixtures.length === 0 ? "no-fixtures" : "no-value"}
          fixtureCount={props.fixtures.length}
        />
      ) : (
        <div className="today-page__picks">
          {visible.map((opportunity) => (
            <PickCard
              key={opportunity.matchId}
              opportunity={opportunity}
              logos={props.logos}
              generatedAt={props.generatedAt}
            />
          ))}
          {overflow > 0 && props.onShowAll ? (
            <button type="button" className="today-page__show-all" onClick={props.onShowAll}>
              仲有 {overflow} 個盤 →
            </button>
          ) : null}
        </div>
      )}
      {!props.dataFresh ? null : (
      <section className="today-page__upcoming" aria-label="即將開賽">
        <h2>即將開賽</h2>
        <ul>
          {props.fixtures.slice(0, UPCOMING_FIXTURE_COUNT).map((item) => (
            <li key={item.matchId} className="today-page__upcoming-item">
              <a href={`#/fixtures/${encodeURIComponent(item.matchId)}`}>
                <TeamLogo teamName={item.homeTeam} logos={props.logos} />
                {item.homeTeamZh ?? item.homeTeam} vs {item.awayTeamZh ?? item.awayTeam}
                <time dateTime={item.commenceTime}>{formatKickoff(item.commenceTime)}</time>
              </a>
            </li>
          ))}
        </ul>
        <a href="#/fixtures">查看全部賽事</a>
      </section>
      )}
    </section>
  );
}
