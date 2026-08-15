import { useEffect, useState } from "react";
import { Radar, ArrowRight, Gauge, Clock3, ListChecks } from "lucide-react";
import type { BuyableOpportunity } from "../apiClient";
import type { BetCreateRequest } from "../apiClient";
import type { ObservationLoader } from "../components/BuyableOddsRange";
import { EmptyState } from "../components/EmptyState";
import { FreshnessBar } from "../components/FreshnessBar";
import { PickCard, formatKickoff } from "../components/PickCard";
import { TeamLogo, type TeamLogoMap } from "../components/TeamLogo";
import type { Fixture } from "../odds";

const RADAR_FIXTURE_COUNT = 5;

export type QuotaInfo = {
  used?: number | null;
  remaining?: number | null;
};

function useUtcClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} UTC`;
}

function QuotaCard(props: { quota: QuotaInfo | null }): React.ReactElement {
  const used = props.quota?.used ?? null;
  const remaining = props.quota?.remaining ?? null;
  const total = used !== null && remaining !== null ? used + remaining : null;
  const percent = total && used !== null ? Math.round((used / total) * 100) : null;
  return (
    <div className="stat-card">
      <span className="stat-card__label">
        <Gauge size={12} aria-hidden="true" /> API Quota
      </span>
      <span className={`stat-card__value${percent !== null ? " stat-card__value--neon" : ""}`}>
        {percent !== null ? `${percent}%` : "—"}
      </span>
      {percent !== null ? (
        <div className="stat-card__track" aria-hidden="true">
          <div className="stat-card__fill" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
      <span className="stat-card__meta">
        <span>{used !== null ? `${used.toLocaleString()} used` : "未有數據"}</span>
        <span>{remaining !== null ? `${remaining.toLocaleString()} left` : ""}</span>
      </span>
    </div>
  );
}

export function LandingPage(props: {
  opportunities: BuyableOpportunity[];
  fixtures: Fixture[];
  generatedAt: string | null;
  dataFresh: boolean;
  logos: TeamLogoMap;
  now?: number;
  latencyMs?: number | null;
  quota?: QuotaInfo | null;
  loadObservations?: ObservationLoader;
  onBet?: (prefill: Partial<BetCreateRequest>) => void;
}): React.ReactElement {
  const now = props.now ?? Date.now();
  const clock = useUtcClock();
  const active = props.dataFresh ? props.opportunities : [];
  const sorted = [...[], ...active].sort(
    (a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime)
  );

  return (
    <section className="landing-page" aria-labelledby="landing-title">
      <header className="today-header">
        <div>
          <p className="today-header__kicker">
            <span className="today-header__live-dot" aria-hidden="true" />
            Live Monitoring
          </p>
          <h1 id="landing-title" className="page-heading">今日概覽</h1>
        </div>
        <div className="today-header__clock">
          <span className="today-header__clock-label">Server Time</span>
          <span className="today-header__clock-value" data-testid="utc-clock">{clock}</span>
        </div>
      </header>

      <div className="today-monitoring">
        <QuotaCard quota={props.quota ?? null} />
        <div className="stat-card">
          <span className="stat-card__label">
            <ListChecks size={12} aria-hidden="true" /> 正在監控
          </span>
          <span className="stat-card__value">{props.fixtures.length.toLocaleString()}</span>
          <span className="stat-card__meta"><span>場賽程</span></span>
        </div>
        <div className="stat-card">
          <span className="stat-card__label">
            <Clock3 size={12} aria-hidden="true" /> Latency
          </span>
          <span className="stat-card__value">
            {props.latencyMs != null ? props.latencyMs : "—"}
            {props.latencyMs != null ? <small className="stat-card__unit">ms</small> : null}
          </span>
          <span className="stat-card__meta"><span>API 來回時間</span></span>
        </div>
      </div>

      <FreshnessBar generatedAt={props.generatedAt} dataFresh={props.dataFresh} now={now} />

      {!props.dataFresh ? (
        <EmptyState reason="stale" />
      ) : sorted.length === 0 ? (
        <div className="landing-page__empty">
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
              onBet={props.onBet}
            />
          ))}
        </div>
      )}

      {props.fixtures.length > 0 ? (
        <section className="radar-alerts" aria-label="賽事雷達預警">
          <h2 className="radar-alerts__heading">
            <Radar size={18} aria-hidden="true" />
            賽事雷達預警
            <a href="#/fixtures" className="radar-alerts__view-all">
              View All
            </a>
          </h2>
          <ul className="radar-alerts__list">
            {props.fixtures.slice(0, RADAR_FIXTURE_COUNT).map((item) => (
              <li key={item.matchId}>
                <a href="#/fixtures" className="radar-alerts__item">
                  <span className="radar-alerts__time">
                    <span className="radar-alerts__time-value">{formatKickoff(item.commenceTime)}</span>
                  </span>
                  <span className="radar-alerts__info">
                    {item.leagueZh ?? item.league ? (
                      <span className="radar-alerts__league">{item.leagueZh ?? item.league}</span>
                    ) : null}
                    <span className="radar-alerts__teams">
                      <TeamLogo teamName={item.homeTeam} logos={props.logos} />
                      {item.homeTeamZh ?? item.homeTeam}
                      <span className="radar-alerts__vs">vs</span>
                      {item.awayTeamZh ?? item.awayTeam}
                      <TeamLogo teamName={item.awayTeam} logos={props.logos} />
                    </span>
                  </span>
                  <ArrowRight size={16} className="radar-alerts__arrow" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="landing-page__footer">
        <a href="#/performance">查看模型表現 →</a>
      </footer>
    </section>
  );
}
