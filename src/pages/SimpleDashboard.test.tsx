import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuyOpportunity } from "../buyOpportunities";
import { SimpleDashboard } from "./SimpleDashboard";

const opportunities: BuyOpportunity[] = [
  {
    matchId: "match-1",
    homeTeam: "Home",
    awayTeam: "Away",
    homeTeamZh: "主隊",
    awayTeamZh: "客隊",
    commenceTime: "2026-07-17T12:00:00Z",
    league: "English Premier League",
    leagueZh: "英格蘭超級聯賽",
    primary: { market: "主客和", selection: "主隊", odds: 2.1, chance: 0.52, edge: 0.092, bookmaker: "Alpha" },
    alternatives: [
      { market: "大細波", selection: "大", line: 2.5, odds: 2, chance: 0.54, edge: 0.08, bookmaker: "Beta" },
    ],
  },
  {
    matchId: "match-2",
    homeTeam: "Second Home",
    awayTeam: "Second Away",
    commenceTime: "2026-07-18T12:00:00Z",
    league: "Liga MX",
    primary: { market: "角球", selection: "細角", line: 9.5, odds: 1.95, chance: 0.55, edge: 0.0725, bookmaker: "Gamma" },
    alternatives: [],
  },
];

describe("SimpleDashboard", () => {
  it("renders one card per qualifying match with every qualifying pick as its own row", () => {
    const markup = renderToStaticMarkup(<SimpleDashboard opportunities={opportunities} generatedAt="2026-07-16T12:34:00Z" dataFresh />);

    expect(markup.match(/<article/g) ?? []).toHaveLength(2);
    // match-1 有 2 個過關盤、match-2 有 1 個:合共 3 行,一行都唔多唔少
    expect(markup.match(/<li/g) ?? []).toHaveLength(3);
    expect(markup).toContain("主客和 · 主隊");
    expect(markup).toContain("大細波 · 大 2.5");
    expect(markup).toContain("角球 · 細角 9.5");
    expect(markup).toContain("2.10");
    expect(markup).toContain("1.95");
    expect(markup).toContain('href="#/fixtures/match-1"');
  });

  it("renders Chinese league and team names with English fallback, plus kickoff time", () => {
    const markup = renderToStaticMarkup(<SimpleDashboard opportunities={opportunities} generatedAt="now" dataFresh />);

    expect(markup).toContain("英格蘭超級聯賽");
    expect(markup).toContain("Liga MX");
    expect(markup).toContain("<h2>主隊 <span>vs</span> 客隊</h2>");
    expect(markup).toContain("<h2>Second Home <span>vs</span> Second Away</h2>");
    expect(markup).toContain('dateTime="2026-07-17T12:00:00Z"');
  });

  it("shows no detail numbers: no bookmaker, chance or edge anywhere", () => {
    const markup = renderToStaticMarkup(<SimpleDashboard opportunities={opportunities} generatedAt="now" dataFresh />);

    expect(markup).not.toContain("Alpha");
    expect(markup).not.toContain("52.00%");
    expect(markup).not.toContain("9.20%");
    expect(markup).not.toContain("KPI");
  });

  it("renders the minimal empty state without the all-fixtures link", () => {
    const markup = renderToStaticMarkup(<SimpleDashboard opportunities={[]} generatedAt="now" dataFresh />);

    expect(markup).toContain("暫時冇場次過關");
    expect(markup).not.toContain("#/fixtures");
  });

  it("hides all picks when data is stale", () => {
    const markup = renderToStaticMarkup(<SimpleDashboard opportunities={opportunities} generatedAt="now" dataFresh={false} />);

    expect(markup).toContain("資料未更新，暫停顯示買盤。");
    expect(markup).not.toContain("<article");
  });

  it("keeps the sync line and discloses when no sync has succeeded", () => {
    const markup = renderToStaticMarkup(
      <SimpleDashboard opportunities={[]} generatedAt={null} dataFresh={false} />,
    );

    expect(markup).toContain("同步時間");
    expect(markup).toContain("未有成功同步");
  });
});
