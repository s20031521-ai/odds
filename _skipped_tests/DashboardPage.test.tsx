import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuyOpportunity } from "../buyOpportunities";
import { recordedOpportunity } from "../testFixtures/recordedOpportunity";
import type { TeamLogoMap } from "../components/TeamLogo";
import { DASHBOARD_MODE_STORAGE_KEY, type StorageLike } from "../dashboardMode";
import { DashboardPage, recordedOpportunitiesForDashboard } from "./DashboardPage";

const opportunities: BuyOpportunity[] = [
  {
    matchId: "match-1",
    homeTeam: "Home",
    awayTeam: "Away",
    commenceTime: "2026-07-17T12:00:00Z",
    primary: { market: "主客和", selection: "主隊", odds: 2.1, chance: 0.52, edge: 0.092, bookmaker: "Alpha" },
    alternatives: [],
  },
];

const testLogos: TeamLogoMap = {};

function storageWith(value: string): StorageLike {
  return {
    getItem: (key) => (key === DASHBOARD_MODE_STORAGE_KEY ? value : null),
    setItem: () => {},
  };
}

describe("DashboardPage", () => {
  it("maps recorded summaries only for the unchanged professional dashboard without duplicating the line", () => {
    const mapped = recordedOpportunitiesForDashboard([recordedOpportunity]);

    expect(mapped).toHaveLength(1);
    expect(mapped[0].primary).toMatchObject({
      market: "大細波",
      selection: "大",
      line: 2.5,
      odds: 2.04,
      chance: 0.55,
      edge: 0.122,
      bookmaker: "Beta",
    });
  });

  it("defaults to simple mode when nothing is stored", () => {
    const markup = renderToStaticMarkup(
      <DashboardPage opportunities={opportunities} recordedOpportunities={[recordedOpportunity]} fixtures={[]} generatedAt="now" dataFresh logos={testLogos} />,
    );

    expect(markup).toContain("today-page");
    expect(markup).not.toContain("buy-dashboard__kpis");
    expect(markup).toMatch(/aria-pressed="true"[^>]*>今日<\/button>/);
    expect(markup).toMatch(/aria-pressed="false"[^>]*>專業<\/button>/);
  });

  it("renders the pro dashboard when pro is stored", () => {
    const markup = renderToStaticMarkup(
      <DashboardPage
        opportunities={opportunities}
        recordedOpportunities={[recordedOpportunity]}
        fixtures={[]}
        generatedAt="now"
        dataFresh
        storage={storageWith("pro")}
        logos={testLogos}
      />,
    );

    expect(markup).toContain("buy-dashboard__kpis");
    expect(markup).toContain("current-buyable-range-panel");
    expect(markup).toContain("1.91–2.04");
    expect(markup).toContain("值得買 Dashboard");
    expect(markup).not.toContain("today-page");
    expect(markup).toMatch(/aria-pressed="true"[^>]*>專業<\/button>/);
  });

  it("treats invalid stored values as simple", () => {
    const markup = renderToStaticMarkup(
      <DashboardPage
        opportunities={opportunities}
        recordedOpportunities={[recordedOpportunity]}
        fixtures={[]}
        generatedAt="now"
        dataFresh
        storage={storageWith("junk")}
        logos={testLogos}
      />,
    );

    expect(markup).toContain("today-page");
  });

  it("keeps the toggle available in the stale state", () => {
    const markup = renderToStaticMarkup(
      <DashboardPage opportunities={[]} recordedOpportunities={[]} fixtures={[]} generatedAt={null} dataFresh={false} logos={testLogos} />,
    );

    expect(markup).toContain("dashboard-mode-bar");
    expect(markup).toContain("數據舊咗，唔好住落注");
  });

  it("passes logos through to the active dashboard", () => {
    const logos: TeamLogoMap = { Arsenal: { id: 1, logo: "/team-logos/1.png" } };
    const markup = renderToStaticMarkup(
      <DashboardPage opportunities={opportunities} recordedOpportunities={[recordedOpportunity]} fixtures={[]} generatedAt="now" dataFresh logos={logos} />,
    );

    expect(markup).toContain('src="/team-logos/1.png"');
  });

  it("simple mode renders TodayPage with fixtures and picks", () => {
    const markup = renderToStaticMarkup(
      <DashboardPage
        opportunities={opportunities}
        recordedOpportunities={[recordedOpportunity]}
        fixtures={[]}
        generatedAt="2026-07-21T11:50:00Z"
        dataFresh
        logos={testLogos}
        storage={storageWith("simple")}
      />,
    );
    expect(markup).toContain("today-page");
    expect(markup).toContain("pick-card");
    expect(markup).toContain("1.91–2.04");
  });

  it("hides stale or empty recorded opportunities from both modes", () => {
    const stale = renderToStaticMarkup(
      <DashboardPage opportunities={opportunities} recordedOpportunities={[recordedOpportunity]} fixtures={[]} generatedAt="now" dataFresh={false} logos={testLogos} />,
    );
    const emptyPro = renderToStaticMarkup(
      <DashboardPage opportunities={[]} recordedOpportunities={[]} fixtures={[]} generatedAt="now" dataFresh storage={storageWith("pro")} logos={testLogos} />,
    );

    expect(stale).not.toContain("buyable-odds-range");
    expect(emptyPro).not.toContain("current-buyable-range-panel");
  });
});
