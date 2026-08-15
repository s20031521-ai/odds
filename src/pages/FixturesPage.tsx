import { useEffect, useMemo, useState } from "react";
import { CalendarX2 } from "lucide-react";
import { FixtureCard, type FixtureOdds } from "../components/FixtureCard";
import type { TeamLogoMap } from "../components/TeamLogo";
import type { BetCreateRequest } from "../apiClient";

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

type DayTab = "today" | "tomorrow" | "upcoming";

const DAY_TABS: Array<{ key: DayTab; label: string }> = [
  { key: "today", label: "今日" },
  { key: "tomorrow", label: "明日" },
  { key: "upcoming", label: "即將到來" },
];

function localDayKey(value: string): string {
  const d = new Date(value);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function groupFixturesByDate(fixtures: Fixture[]): Array<{ label: string; fixtures: Fixture[] }> {
  const groups = new Map<string, Fixture[]>();
  for (const fixture of fixtures) {
    const key = localDayKey(fixture.commenceTime);
    const existing = groups.get(key);
    if (existing) existing.push(fixture);
    else groups.set(key, [fixture]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => {
      const d = new Date(key);
      const label = `${d.getMonth() + 1}月${d.getDate()}日`;
      return {
        label,
        fixtures: items.sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime)),
      };
    });
}

export function FixturesPage(props: {
  fixtures: Fixture[];
  logos: TeamLogoMap;
  oddsByMatch?: Map<string, FixtureOdds>;
  onBet?: (prefill: Partial<BetCreateRequest>) => void;
}): React.ReactElement {
  const now = useNow();
  const [tab, setTab] = useState<DayTab>("today");
  const [league, setLeague] = useState<string | null>(null);

  const leagues = useMemo(() => {
    const seen = new Map<string, string>();
    for (const f of props.fixtures) {
      const label = f.leagueZh ?? f.league;
      if (label && !seen.has(label)) seen.set(label, label);
    }
    return [...seen.values()];
  }, [props.fixtures]);

  const todayKey = localDayKey(new Date(now).toISOString());
  const tomorrowKey = localDayKey(new Date(now + 86_400_000).toISOString());

  const tabbed = useMemo(() => {
    if (tab === "today") return props.fixtures.filter((f) => localDayKey(f.commenceTime) === todayKey);
    if (tab === "tomorrow") return props.fixtures.filter((f) => localDayKey(f.commenceTime) === tomorrowKey);
    return props.fixtures;
  }, [props.fixtures, tab, todayKey, tomorrowKey]);

  const filtered = useMemo(
    () => (league ? tabbed.filter((f) => (f.leagueZh ?? f.league) === league) : tabbed),
    [tabbed, league],
  );

  const groups = useMemo(() => groupFixturesByDate(filtered), [filtered]);

  return (
    <section className="fixtures-page" aria-labelledby="fixtures-title">
      <div className="fixtures-page__head">
        <div>
          <h1 id="fixtures-title" className="page-heading">賽程列表</h1>
          <p className="fixtures-page__sub">選擇比賽以建立你的注單</p>
        </div>
        <div className="day-tabs" role="tablist">
          {DAY_TABS.map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={`day-tabs__tab${tab === key ? " active" : ""}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {leagues.length > 1 ? (
        <div className="fixtures-page__chips" role="group" aria-label="聯賽篩選">
          <button
            className={`filter-chip${league === null ? " active" : ""}`}
            onClick={() => setLeague(null)}
          >
            所有比賽
          </button>
          {leagues.map((name) => (
            <button
              key={name}
              className={`filter-chip${league === name ? " active" : ""}`}
              onClick={() => setLeague(league === name ? null : name)}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div className="landing-page__empty">
          <CalendarX2 size={28} aria-hidden="true" />
          <p>暫無賽事</p>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.label} className="fixtures-group">
            {tab === "upcoming" ? (
              <h2 className="fixtures-group__heading">{group.label}</h2>
            ) : null}
            <div className="fixtures-group__cards">
              {group.fixtures.map((fixture) => (
                <FixtureCard
                  key={fixture.matchId}
                  {...fixture}
                  logos={props.logos}
                  now={now}
                  odds={props.oddsByMatch?.get(fixture.matchId) ?? null}
                  onBet={props.onBet}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </section>
  );
}
