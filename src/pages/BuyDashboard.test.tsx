import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuyOpportunity } from "../buyOpportunities";
import { BuyDashboard, filterOpportunitiesByMarket } from "./BuyDashboard";

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

describe("BuyDashboard", () => {
  it("renders populated KPIs, one article per match and compact alternatives", () => {
    const markup = renderToStaticMarkup(<BuyDashboard opportunities={opportunities} generatedAt="2026-07-16T12:34:00Z" dataFresh />);

    expect(markup).toContain("值得買 Dashboard");
    expect(markup).toContain("2026-07-16T12:34:00Z");
    expect(markup.match(/<article/g) ?? []).toHaveLength(2);
    expect(markup).toContain("值得買賽事");
    expect(markup).toMatch(/值得買賽事[\s\S]*?>2</);
    expect(markup).toMatch(/合資格買盤[\s\S]*?>3</);
    expect(markup).toMatch(/平均 Edge[\s\S]*?>8\.15%</);
    expect(markup).toContain("下一場開賽");
    expect(markup).toContain("Home");
    expect(markup).toContain("Alpha");
    expect(markup).toContain("2.10");
    expect(markup).toContain("52.00%");
    expect(markup).toContain("9.20%");
    expect(markup).toContain("dashboard-card__alternative");
    expect(markup).toContain('href="#/fixtures/match-1"');
  });

  it("renders the league line when present and omits it cleanly when missing", () => {
    const markup = renderToStaticMarkup(<BuyDashboard opportunities={opportunities} generatedAt="now" dataFresh />);

    expect(markup).toContain('class="dashboard-card__league"');
    expect(markup.match(/dashboard-card__league/g) ?? []).toHaveLength(2);
  });

  it("renders the Chinese league name when present and falls back to the English canonical name", () => {
    const markup = renderToStaticMarkup(<BuyDashboard opportunities={opportunities} generatedAt="now" dataFresh />);

    expect(markup).toContain('<p class="dashboard-card__league">英格蘭超級聯賽</p>');
    expect(markup).toContain('<p class="dashboard-card__league">Liga MX</p>');
    expect(markup).not.toContain("English Premier League</p>");
  });

  it("renders Chinese display names when present and falls back to English canonical names", () => {
    const markup = renderToStaticMarkup(<BuyDashboard opportunities={opportunities} generatedAt="now" dataFresh />);

    expect(markup).toContain("<h2>主隊 <span>vs</span> 客隊</h2>");
    expect(markup).toContain("<h2>Second Home <span>vs</span> Second Away</h2>");
  });

  it("renders the exact fresh-empty copy and all-fixtures link", () => {
    const markup = renderToStaticMarkup(<BuyDashboard opportunities={[]} generatedAt="now" dataFresh />);

    expect(markup).toContain("暫時未有賽事達到 3% Edge。");
    expect(markup).toContain('href="#/fixtures"');
    expect(markup).toContain("查看全部賽事");
  });

  it("renders the stale copy and no active opportunity articles", () => {
    const markup = renderToStaticMarkup(<BuyDashboard opportunities={opportunities} generatedAt="now" dataFresh={false} />);

    expect(markup).toContain("資料未更新，暫停顯示買盤。");
    expect(markup).not.toContain("<article");
  });

  it("discloses when no HKJC or HDC load has succeeded yet", () => {
    const markup = renderToStaticMarkup(
      <BuyDashboard opportunities={[]} generatedAt={null as unknown as string} dataFresh={false} />,
    );

    expect(markup).toContain("未有成功同步");
    expect(markup).not.toContain("<time");
  });

  it("filters matches purely by contained market without changing their primary picks", () => {
    const before = structuredClone(opportunities);
    const filtered = filterOpportunitiesByMarket(opportunities, "大細波");

    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toBe(opportunities[0]);
    expect(filtered[0].primary.market).toBe("主客和");
    expect(opportunities).toEqual(before);
  });

  it("renders all exact market filter labels with all markets selected by default", () => {
    const markup = renderToStaticMarkup(<BuyDashboard opportunities={opportunities} generatedAt="now" dataFresh />);

    for (const label of ["全部市場", "主客和", "大細波", "角球", "亞洲讓球"]) {
      expect(markup).toContain(`>${label}</button>`);
    }
    expect(markup).toMatch(/aria-pressed="true"[^>]*>全部市場<\/button>/);
  });
});
