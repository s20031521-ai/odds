import { formatFixtureDayHeading } from "../dashboard";
import { TeamLogo, type TeamLogoMap } from "../components/TeamLogo";
import { formatKickoff } from "../components/PickCard";
import { Mascot } from "../components/Kawaii";

type Fixture = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamZh?: string;
  awayTeamZh?: string;
  commenceTime: string;
  league?: string;
  leagueZh?: string;
  bookmakerCount: number;
};

function groupFixturesByDate(fixtures: Fixture[]): Array<{ label: string; fixtures: Fixture[] }> {
  const groups = new Map<string, Fixture[]>();
  for (const fixture of fixtures) {
    const date = new Date(fixture.commenceTime);
    const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    const existing = groups.get(key);
    if (existing) existing.push(fixture);
    else groups.set(key, [fixture]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => {
      const d = new Date(key);
      const label = `${d.getMonth() + 1}月${d.getDate()}日`;
      return { label, fixtures: items.sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime)) };
    });
}

export function FixturesPage(props: {
  fixtures: Fixture[];
  logos: TeamLogoMap;
}): React.ReactElement {
  const groups = groupFixturesByDate(props.fixtures);

  return (
    <section className="fixtures-page" aria-labelledby="fixtures-title">
      <h1 id="fixtures-title" className="page-heading">賽程</h1>
      {props.fixtures.length === 0 ? (
        <div className="landing-page__empty">
          <Mascot pose="chiikawa-empty" />
          <p>暫無賽事</p>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.label} className="fixtures-group">
            <h2 className="fixtures-group__heading">{group.label}</h2>
            <ul className="fixtures-group__list">
              {group.fixtures.map((fixture) => (
                <li key={fixture.matchId} className="fixtures-group__item">
                  <span className="fixtures-group__teams">
                    <TeamLogo teamName={fixture.homeTeam} logos={props.logos} />
                    {fixture.homeTeamZh ?? fixture.homeTeam} vs {fixture.awayTeamZh ?? fixture.awayTeam}
                    <TeamLogo teamName={fixture.awayTeam} logos={props.logos} />
                  </span>
                  <time dateTime={fixture.commenceTime}>{formatKickoff(fixture.commenceTime)}</time>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      <Mascot pose="momonga-loading" />
    </section>
  );
}
