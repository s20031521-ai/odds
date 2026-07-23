import { useState } from "react";
import type { BuyMarket, BuyOpportunity, BuyPick } from "../buyOpportunities";
import type { BuyableOpportunity } from "../apiClient";
import { BuyableOddsRange, selectionLabel, type ObservationLoader } from "../components/BuyableOddsRange";
import type { TeamLogoMap } from "../components/TeamLogo";
import {
  readDashboardMode,
  writeDashboardMode,
  type DashboardMode,
  type StorageLike,
} from "../dashboardMode";
import type { Fixture } from "../odds";
import { BuyDashboard } from "./BuyDashboard";
import { LandingPage } from "./TodayPage";

const MODE_ORDER = ["simple", "pro"] as const;
const MODE_LABELS: Record<DashboardMode, string> = { simple: "今日", pro: "專業" };

export function recordedOpportunitiesForDashboard(opportunities: BuyableOpportunity[]): BuyOpportunity[] {
  const grouped = new Map<string, { source: BuyableOpportunity; picks: BuyPick[] }>();
  for (const opportunity of opportunities) {
    const matchId = opportunity.matchId ?? opportunity.fixtureId;
    const quote = opportunity.bestQuote;
    const pick: BuyPick = {
      market: marketLabel(opportunity.market),
      selection: selectionLabel(opportunity, false),
      ...(opportunity.line === undefined ? {} : { line: opportunity.line }),
      odds: quote.odds,
      chance: quote.chance,
      edge: quote.edge,
      bookmaker: quote.bookmaker,
    };
    const existing = grouped.get(matchId);
    if (existing) existing.picks.push(pick);
    else grouped.set(matchId, { source: opportunity, picks: [pick] });
  }
  return [...grouped.entries()].map(([matchId, group]) => {
    const [primary, ...alternatives] = group.picks.sort((left, right) => right.edge - left.edge);
    return {
      matchId,
      homeTeam: group.source.homeTeam,
      awayTeam: group.source.awayTeam,
      ...(group.source.homeTeamZh ? { homeTeamZh: group.source.homeTeamZh } : {}),
      ...(group.source.awayTeamZh ? { awayTeamZh: group.source.awayTeamZh } : {}),
      commenceTime: group.source.commenceTime,
      ...(group.source.league ? { league: group.source.league } : {}),
      ...(group.source.leagueZh ? { leagueZh: group.source.leagueZh } : {}),
      primary,
      alternatives,
    };
  });
}

function marketLabel(market: BuyableOpportunity["market"]): BuyMarket {
  if (market === "h2h") return "主客和";
  if (market === "totals") return "大細波";
  if (market === "corners") return "角球";
  return "亞洲讓球";
}

export function DashboardPage(props: {
  opportunities: BuyOpportunity[];
  recordedOpportunities: BuyableOpportunity[];
  fixtures: Fixture[];
  generatedAt: string | null;
  dataFresh: boolean;
  storage?: StorageLike;
  logos: TeamLogoMap;
  loadObservations?: ObservationLoader;
}): React.ReactElement {
  const [mode, setMode] = useState<DashboardMode>(() => readDashboardMode(props.storage));

  function selectMode(next: DashboardMode): void {
    setMode(next);
    writeDashboardMode(next, props.storage);
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-mode-bar" role="group" aria-label="顯示模式">
        {MODE_ORDER.map((value) => (
          <button
            aria-pressed={mode === value}
            key={value}
            onClick={() => selectMode(value)}
            type="button"
          >
            {MODE_LABELS[value]}
          </button>
        ))}
      </div>
      {mode === "pro" ? (
        <>
          {props.dataFresh && props.recordedOpportunities.length > 0 ? (
            <section className="current-buyable-range-panel" aria-label="目前可買價">
              <h2>目前可買價</h2>
              {props.recordedOpportunities.map((opportunity) => (
                <BuyableOddsRange key={opportunity.sampleId} opportunity={opportunity} loadObservations={props.loadObservations} />
              ))}
            </section>
          ) : null}
          <BuyDashboard opportunities={props.opportunities} generatedAt={props.generatedAt} dataFresh={props.dataFresh} logos={props.logos} />
        </>
      ) : (
        <LandingPage
          opportunities={props.recordedOpportunities}
          fixtures={props.fixtures}
          generatedAt={props.generatedAt}
          dataFresh={props.dataFresh}
          logos={props.logos}
          loadObservations={props.loadObservations}
        />
      )}
    </div>
  );
}
