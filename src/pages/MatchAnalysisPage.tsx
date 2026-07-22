import type { BuyableOpportunity } from "../apiClient";
import { BuyableOddsRange, type ObservationLoader } from "../components/BuyableOddsRange";
import { Mascot } from "../components/Kawaii";
import { MarketDetailCard } from "../components/MarketDetailCard";
import { formatKickoff } from "../components/PickCard";
import { TeamLogo, type TeamLogoMap } from "../components/TeamLogo";
import { isPostKickoff } from "../kickoffGate";
import type { MatchHeaderInfo, MatchMarketDetails } from "../matchDetails";

const MARKETS: Array<{ key: keyof MatchMarketDetails; label: string }> = [
  { key: "h2h", label: "主客和" },
  { key: "totals", label: "大細波" },
  { key: "corners", label: "角球" },
  { key: "handicap", label: "亞洲讓球" },
];

export function MatchAnalysisPage(props: {
  matchId: string | null;
  header: MatchHeaderInfo | null;
  details: MatchMarketDetails | null;
  recordedOpportunities: BuyableOpportunity[];
  logos: TeamLogoMap;
  generatedAt: string | null;
  loadObservations?: ObservationLoader;
}): React.ReactElement {
  if (!props.matchId) {
    const matches = uniqueMatches(props.recordedOpportunities);
    return (
      <section className="match-analysis">
        <div className="today-empty" role="status">
          <Mascot pose="chiikawa-empty" />
          <p>由今日或賽程揀一場波</p>
        </div>
        {matches.length > 0 ? (
          <ul className="match-analysis__picker">
            {matches.map((match) => (
              <li key={match.matchId}>
                <a href={`#/analysis?match=${encodeURIComponent(match.matchId)}`}>
                  {match.homeTeamZh ?? match.homeTeam} vs {match.awayTeamZh ?? match.awayTeam} · {formatKickoff(match.commenceTime)}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    );
  }

  const { header, details } = props;
  if (!header || !details) {
    return (
      <section className="match-analysis">
        <div className="today-empty" role="status">
          <Mascot pose="chiikawa-empty" />
          <p>搵唔到呢場波 — 可能已開賽或已下架</p>
        </div>
        <p className="match-analysis__back"><a href="#/analysis">揀返另一場 →</a></p>
      </section>
    );
  }

  const postKickoff = isPostKickoff(header.commenceTime);
  return (
    <section className="match-analysis">
      <header className="match-analysis__header">
        <h1 className="page-heading">
          <TeamLogo teamName={header.homeTeam} logos={props.logos} />
          {header.homeTeamZh ?? header.homeTeam} vs {header.awayTeamZh ?? header.awayTeam}
          <TeamLogo teamName={header.awayTeam} logos={props.logos} />
        </h1>
        <p className="match-analysis__meta">
          {formatKickoff(header.commenceTime)}
          {header.leagueZh ?? header.league ? ` · ${header.leagueZh ?? header.league}` : ""}
          {" · "}
          <a href="#/analysis">轉場</a>
        </p>
      </header>
      <div className="market-detail-grid">
        {MARKETS.map(({ key, label }) => (
          <MarketDetailCard key={key} market={label} detail={details[key]} postKickoff={postKickoff} />
        ))}
      </div>
      {!postKickoff && props.recordedOpportunities.some((opportunity) => (opportunity.matchId ?? opportunity.fixtureId) === props.matchId) ? (
        <section className="match-analysis__buyable" aria-label="目前可買價">
          <h2>目前可買價</h2>
          {props.recordedOpportunities
            .filter((opportunity) => (opportunity.matchId ?? opportunity.fixtureId) === props.matchId)
            .map((opportunity) => (
              <BuyableOddsRange key={opportunity.sampleId} opportunity={opportunity} loadObservations={props.loadObservations} />
            ))}
        </section>
      ) : null}
      <p className="match-analysis__sync">賠率同步於 {props.generatedAt ?? "未有成功同步"}</p>
    </section>
  );
}

function uniqueMatches(opportunities: BuyableOpportunity[]): Array<{ matchId: string; homeTeam: string; awayTeam: string; homeTeamZh?: string; awayTeamZh?: string; commenceTime: string }> {
  const seen = new Set<string>();
  const matches: Array<{ matchId: string; homeTeam: string; awayTeam: string; homeTeamZh?: string; awayTeamZh?: string; commenceTime: string }> = [];
  for (const opportunity of opportunities) {
    const matchId = opportunity.matchId ?? opportunity.fixtureId;
    if (seen.has(matchId)) continue;
    seen.add(matchId);
    matches.push({
      matchId,
      homeTeam: opportunity.homeTeam,
      awayTeam: opportunity.awayTeam,
      ...(opportunity.homeTeamZh ? { homeTeamZh: opportunity.homeTeamZh } : {}),
      ...(opportunity.awayTeamZh ? { awayTeamZh: opportunity.awayTeamZh } : {}),
      commenceTime: opportunity.commenceTime,
    });
  }
  return matches;
}
