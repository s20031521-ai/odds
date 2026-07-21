import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuyOpportunity } from "../buyOpportunities";
import type { TeamLogoMap } from "./TeamLogo";
import { formatKickoff, PickCard } from "./PickCard";

const opportunity: BuyOpportunity = {
  matchId: "match-1",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  homeTeamZh: "阿仙奴",
  awayTeamZh: "車路士",
  commenceTime: "2026-07-21T20:00:00",
  league: "Premier League",
  primary: { market: "大細波", selection: "大", line: 2.5, odds: 1.95, chance: 0.58, edge: 0.131, bookmaker: "Alpha" },
  alternatives: [
    { market: "主客和", selection: "主隊", odds: 2.1, chance: 0.52, edge: 0.092, bookmaker: "Beta" },
  ],
};

const logos: TeamLogoMap = { Arsenal: { id: 42, logo: "/team-logos/42.png" } };

describe("PickCard", () => {
  it("renders collapsed three-line summary inside a details element", () => {
    const markup = renderToStaticMarkup(
      <PickCard opportunity={opportunity} logos={logos} generatedAt="2026-07-21T12:00:00Z" />,
    );
    expect(markup).toContain("<details");
    expect(markup).toContain("pick-card");
    expect(markup).toContain("阿仙奴 vs 車路士"); // zh 名優先
    expect(markup).toContain("買：大 2.5");
    expect(markup).toContain("1.95");
    expect(markup).toContain("詳情▾");
  });

  it("falls back to English names when zh missing", () => {
    const noZh: BuyOpportunity = { ...opportunity, homeTeamZh: undefined, awayTeamZh: undefined };
    const markup = renderToStaticMarkup(
      <PickCard opportunity={noZh} logos={logos} generatedAt={null} />,
    );
    expect(markup).toContain("Arsenal vs Chelsea");
  });

  it("renders expanded detail content (edge, probability comparison, stake, sync time, analysis link)", () => {
    const markup = renderToStaticMarkup(
      <PickCard opportunity={opportunity} logos={logos} generatedAt="2026-07-21T12:00:00Z" />,
    );
    expect(markup).toContain("Edge +13.1%");
    expect(markup).toContain("模型估 58.0%，莊家開 51.3%");
    expect(markup).toContain("建議注碼 $20"); // displayStake(0.58, 1.95) capped 2% of 1000
    expect(markup).toContain("賠率同步於 2026-07-21T12:00:00Z");
    expect(markup).toContain('href="#/fixtures/match-1"');
    expect(markup).toContain("睇單場分析 →");
  });

  it("lists alternative picks", () => {
    const markup = renderToStaticMarkup(
      <PickCard opportunity={opportunity} logos={logos} generatedAt={null} />,
    );
    expect(markup).toContain("未有成功同步");
    expect(markup).toContain("主隊");
    expect(markup).toContain("2.10");
    expect(markup).toContain("Beta");
  });

  it("encodes matchId in the analysis link", () => {
    const spaced: BuyOpportunity = { ...opportunity, matchId: "match 1" };
    const markup = renderToStaticMarkup(
      <PickCard opportunity={spaced} logos={logos} generatedAt={null} />,
    );
    expect(markup).toContain('href="#/fixtures/match%201"');
  });
});

describe("formatKickoff", () => {
  it("formats as M月D日 HH:MM", () => {
    const input = "2026-07-21T20:00:00";
    const date = new Date(input);
    const pad = (n: number) => String(n).padStart(2, "0");
    const expected = `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    expect(formatKickoff(input)).toBe(expected);
  });

  it("returns the raw string when unparseable", () => {
    expect(formatKickoff("not-a-date")).toBe("not-a-date");
  });
});
