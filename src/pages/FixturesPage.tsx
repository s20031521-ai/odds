import { useEffect, useMemo, useState } from "react";
import { CalendarX2 } from "lucide-react";
import { FixtureCard, type FixtureOdds } from "../components/FixtureCard";
import { FreshnessBar } from "../components/FreshnessBar";
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

const TAB_STORAGE_KEY = "fixtures.tab";
const LEAGUE_STORAGE_KEY = "fixtures.league";

function storedTab(): DayTab {
  const value = window.sessionStorage.getItem(TAB_STORAGE_KEY);
  return DAY_TABS.some((t) => t.key === value) ? (value as DayTab) : "today";
}

/** 全局搜尋跳過嚟嘅目標場次（#/fixtures?m=<matchId>） */
function highlightFromHash(): string | null {
  const match = window.location.hash.match(/[?&]m=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

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

function groupFixturesByDate(fixtures: Fixture[], now: number): Array<{ label: string; fixtures: Fixture[] }> {
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
        // 未開賽排先（按開波時間），已開賽沉底
        fixtures: items.sort((a, b) => {
          const aStarted = Date.parse(a.commenceTime) <= now ? 1 : 0;
          const bStarted = Date.parse(b.commenceTime) <= now ? 1 : 0;
          return aStarted - bStarted || Date.parse(a.commenceTime) - Date.parse(b.commenceTime);
        }),
      };
    });
}

export function FixturesPage(props: {
  fixtures: Fixture[];
  logos: TeamLogoMap;
  oddsByMatch?: Map<string, FixtureOdds>;
  onBet?: (prefill: Partial<BetCreateRequest>) => void;
  /** ISO timestamp of last successful odds sync（賠率新鮮度） */
  syncedAt?: string | null;
}): React.ReactElement {
  const now = useNow();
  const [highlight, setHighlight] = useState<string | null>(() => highlightFromHash());
  const [tab, setTab] = useState<DayTab>(() => (highlightFromHash() ? "upcoming" : storedTab()));
  const [league, setLeague] = useState<string | null>(() =>
    highlightFromHash() ? null : window.sessionStorage.getItem(LEAGUE_STORAGE_KEY),
  );

  const leagues = useMemo(() => {
    const seen = new Map<string, string>();
    for (const f of props.fixtures) {
      const label = f.leagueZh ?? f.league;
      if (label && !seen.has(label)) seen.set(label, label);
    }
    return [...seen.values()];
  }, [props.fixtures]);

  // 記住用戶揀過嘅 tab / 聯賽，返嚟唔使撳過
  useEffect(() => {
    window.sessionStorage.setItem(TAB_STORAGE_KEY, tab);
  }, [tab]);
  useEffect(() => {
    if (league) window.sessionStorage.setItem(LEAGUE_STORAGE_KEY, league);
    else window.sessionStorage.removeItem(LEAGUE_STORAGE_KEY);
  }, [league]);

  // 存低咗嘅聯賽而家冇嘅話，當冇篩選
  const activeLeague = league && leagues.includes(league) ? league : null;

  const todayKey = localDayKey(new Date(now).toISOString());
  const tomorrowKey = localDayKey(new Date(now + 86_400_000).toISOString());

  const tabbed = useMemo(() => {
    if (tab === "today") return props.fixtures.filter((f) => localDayKey(f.commenceTime) === todayKey);
    if (tab === "tomorrow") return props.fixtures.filter((f) => localDayKey(f.commenceTime) === tomorrowKey);
    return props.fixtures;
  }, [props.fixtures, tab, todayKey, tomorrowKey]);

  const filtered = useMemo(
    () => (activeLeague ? tabbed.filter((f) => (f.leagueZh ?? f.league) === activeLeague) : tabbed),
    [tabbed, activeLeague],
  );

  const groups = useMemo(() => groupFixturesByDate(filtered, now), [filtered, now]);

  // 搜尋跳入：捲去嗰場、highlight 幾秒、清返個 hash 參數
  useEffect(() => {
    if (!highlight) return;
    window.history.replaceState(null, "", "#/fixtures");
    const el = document.getElementById(`fixture-${highlight}`);
    if (!el) {
      setHighlight(null);
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = window.setTimeout(() => setHighlight(null), 3000);
    return () => window.clearTimeout(timer);
  }, [highlight, groups]);

  // 人已喺賽程頁再搜另一場：hashchange 時更新 highlight 目標
  useEffect(() => {
    const onHashChange = () => {
      const target = highlightFromHash();
      if (target) {
        setTab("upcoming");
        setLeague(null);
        setHighlight(target);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

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

      <FreshnessBar generatedAt={props.syncedAt ?? null} dataFresh={Boolean(props.syncedAt)} now={now} />

      {leagues.length > 1 ? (
        <div className="fixtures-page__chips" role="group" aria-label="聯賽篩選">
          <button
            className={`filter-chip${activeLeague === null ? " active" : ""}`}
            onClick={() => setLeague(null)}
          >
            所有比賽
          </button>
          {leagues.map((name) => (
            <button
              key={name}
              className={`filter-chip${activeLeague === name ? " active" : ""}`}
              onClick={() => setLeague(activeLeague === name ? null : name)}
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
                  highlighted={fixture.matchId === highlight}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </section>
  );
}
