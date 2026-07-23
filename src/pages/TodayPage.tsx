import type { BuyableOpportunity } from "../apiClient";
import type { ObservationLoader } from "../components/BuyableOddsRange";
import { EmptyState } from "../components/EmptyState";
import { FreshnessBar } from "../components/FreshnessBar";
import { PickCard, formatKickoff } from "../components/PickCard";
import { TeamLogo, type TeamLogoMap } from "../components/TeamLogo";
import { Mascot } from "../components/Kawaii";
import type { Fixture } from "../odds";

const UPCOMING_FIXTURE_COUNT = 3;

export function LandingPage(props: {
  opportunities: BuyableOpportunity[];
  fixtures: Fixture[];
  generatedAt: string | null;
  dataFresh: boolean;
  logos: TeamLogoMap;
  now?: number;
  loadObservations?: ObservationLoader;
}): React.ReactElement {
  const now = props.now ?? Date.now();
  const active = props.dataFresh ? props.opportunities : [];
  const sorted = [...[], ...active].sort(
    (a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime)
  );


  return (
    <section className="landing-page" aria-labelledby="landing-title">
      <h1 id="landing-title" className="page-heading">今日</h1>
      <FreshnessBar generatedAt={props.generatedAt} dataFresh={props.dataFresh} now={now} />

      {!props.dataFresh ? (
        <EmptyState reason="stale" />
      ) : sorted.length === 0 ? (
        <div className="landing-page__empty">
          <Mascot pose="chiikawa-empty" />
          <p>暫無推薦</p>
        </div>
      ) : (
        <div className="landing-page__picks">
          {sorted.map((opportunity) => (
            <PickCard
              key={opportunity.sampleId}
              opportunity={opportunity}
              logos={props.logos}
              loadObservations={props.loadObservations}
            />
          ))}
        </div>
      )}

      {props.fixtures.length > 0 ? (
        <section className="landing-page__upcoming" aria-label="即將開賽">
          <h2>即將開賽</h2>
          <ul>
            {props.fixtures.slice(0, UPCOMING_FIXTURE_COUNT).map((item) => (
              <li key={item.matchId} className="landing-page__upcoming-item">
                <span className="landing-page__upcoming-teams">
                  <TeamLogo teamName={item.homeTeam} logos={props.logos} />
                  {item.homeTeamZh ?? item.homeTeam} vs {item.awayTeamZh ?? item.awayTeam}
                  <TeamLogo teamName={item.awayTeam} logos={props.logos} />
                </span>
                <time dateTime={item.commenceTime}>{formatKickoff(item.commenceTime)}</time>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="landing-page__footer">
        <Mascot pose="momonga-loading" />
        <a href="#/performance">查看模型表現 →</a>
      </footer>
    </section>
  );
}
