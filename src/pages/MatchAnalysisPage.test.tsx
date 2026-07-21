import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatchAnalysisPage } from "./MatchAnalysisPage";
import type { MatchHeaderInfo, MatchMarketDetails } from "../matchDetails";
import type { BuyOpportunity } from "../buyOpportunities";

const header: MatchHeaderInfo = {
  matchId: "m1", homeTeam: "Home FC", awayTeam: "Away FC",
  homeTeamZh: "主隊", awayTeamZh: "客隊",
  commenceTime: "2030-01-01T20:00:00.000Z", league: "EPL", leagueZh: "英超",
};

const details: MatchMarketDetails = {
  h2h: { kind: "ok", selection: "主勝", odds: 2.0, chance: 0.58, implied: 0.5, edge: 0.16, stake: 20, bookmaker: "Book A" },
  totals: { kind: "empty" },
  corners: { kind: "insufficient", note: "資料不足，唔買" },
  handicap: { kind: "empty" },
};

function opportunity(matchId: string): BuyOpportunity {
  return {
    matchId, homeTeam: "Home FC", awayTeam: "Away FC",
    homeTeamZh: "主隊", awayTeamZh: "客隊",
    commenceTime: "2030-01-01T20:00:00.000Z",
    primary: { market: "主客和", selection: "主勝", odds: 2.0, chance: 0.58, edge: 0.16, bookmaker: "Book A" },
    alternatives: [],
  };
}

const base = { matchId: "m1", header, details, opportunities: [] as BuyOpportunity[], logos: {}, generatedAt: "2026-07-21T09:00:00.000Z" };

describe("MatchAnalysisPage", () => {
  it("renders header, four market cards and sync timestamp", () => {
    const markup = renderToStaticMarkup(<MatchAnalysisPage {...base} />);
    expect(markup).toContain("主隊 vs 客隊");
    expect(markup).toContain("英超");
    expect(markup).toContain("轉場");
    expect(markup).toContain('href="#/analysis"');
    expect(markup).toContain("模型估 58.0%，莊家開 50.0%");
    expect(markup).toContain("呢個市場冇盤");
    expect(markup).toContain("資料不足，唔買");
    expect(markup).toContain("賠率同步於 2026-07-21T09:00:00.000Z");
  });

  it("shows picker with quick links when no match selected", () => {
    const markup = renderToStaticMarkup(
      <MatchAnalysisPage {...base} matchId={null} header={null} details={null} opportunities={[opportunity("m1"), opportunity("m1"), opportunity("m2")]} />,
    );
    expect(markup).toContain("由今日或賽程揀一場波");
    expect(markup).toContain('href="#/analysis?match=m1"');
    expect(markup).toContain('href="#/analysis?match=m2"');
    // dedupe：m1 只出一次
    expect(markup.match(/#\/analysis\?match=m1/g)?.length).toBe(1);
  });

  it("shows not-found state for unknown match", () => {
    const markup = renderToStaticMarkup(<MatchAnalysisPage {...base} matchId="ghost" header={null} details={null} />);
    expect(markup).toContain("搵唔到呢場波");
    expect(markup).toContain('href="#/analysis"');
  });
});
