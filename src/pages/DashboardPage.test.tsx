import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuyOpportunity } from "../buyOpportunities";
import { DASHBOARD_MODE_STORAGE_KEY, type StorageLike } from "../dashboardMode";
import { DashboardPage } from "./DashboardPage";

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

function storageWith(value: string): StorageLike {
  return {
    getItem: (key) => (key === DASHBOARD_MODE_STORAGE_KEY ? value : null),
    setItem: () => {},
  };
}

describe("DashboardPage", () => {
  it("defaults to simple mode when nothing is stored", () => {
    const markup = renderToStaticMarkup(<DashboardPage opportunities={opportunities} generatedAt="now" dataFresh />);

    expect(markup).toContain("simple-dashboard");
    expect(markup).not.toContain("buy-dashboard__kpis");
    expect(markup).toMatch(/aria-pressed="true"[^>]*>極簡<\/button>/);
    expect(markup).toMatch(/aria-pressed="false"[^>]*>專業<\/button>/);
  });

  it("renders the pro dashboard when pro is stored", () => {
    const markup = renderToStaticMarkup(
      <DashboardPage opportunities={opportunities} generatedAt="now" dataFresh storage={storageWith("pro")} />,
    );

    expect(markup).toContain("buy-dashboard__kpis");
    expect(markup).toContain("值得買 Dashboard");
    expect(markup).not.toContain("simple-dashboard");
    expect(markup).toMatch(/aria-pressed="true"[^>]*>專業<\/button>/);
  });

  it("treats invalid stored values as simple", () => {
    const markup = renderToStaticMarkup(
      <DashboardPage opportunities={opportunities} generatedAt="now" dataFresh storage={storageWith("junk")} />,
    );

    expect(markup).toContain("simple-dashboard");
  });

  it("keeps the toggle available in the stale state", () => {
    const markup = renderToStaticMarkup(<DashboardPage opportunities={[]} generatedAt={null} dataFresh={false} />);

    expect(markup).toContain("dashboard-mode-bar");
    expect(markup).toContain("資料未更新，暫停顯示買盤。");
  });
});
