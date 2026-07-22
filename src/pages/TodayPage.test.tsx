import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuyableOpportunity } from "../apiClient";
import { recordedOpportunity } from "../testFixtures/recordedOpportunity";
import type { TeamLogoMap } from "../components/TeamLogo";
import type { Fixture } from "../odds";
import { TodayPage } from "./TodayPage";

const NOW = Date.parse("2026-07-21T12:00:00Z");
const logos: TeamLogoMap = {};

const opportunity = (matchId: string, edge: number): BuyableOpportunity => ({
  ...recordedOpportunity,
  sampleId: Number(matchId.replace(/\D/g, "")) || 1,
  fixtureId: `fixture-${matchId}`,
  matchId,
  homeTeam: `Home ${matchId}`,
  awayTeam: `Away ${matchId}`,
  bestQuote: { ...recordedOpportunity.bestQuote, edge },
  quotes: recordedOpportunity.quotes.map((quote) => ({ ...quote, edge })),
});

const fixture = (matchId: string): Fixture => ({
  matchId,
  homeTeam: `Home ${matchId}`,
  awayTeam: `Away ${matchId}`,
  commenceTime: "2026-07-21T20:00:00",
  bookmakerCount: 3,
});

const baseProps = {
  generatedAt: "2026-07-21T11:50:00Z",
  logos,
  now: NOW,
};

describe("TodayPage", () => {
  it("renders freshness bar + pick cards + upcoming fixtures when there are picks", () => {
    const markup = renderToStaticMarkup(
      <TodayPage {...baseProps} opportunities={[opportunity("m1", 0.13)]} fixtures={[fixture("m1"), fixture("m2")]} dataFresh />,
    );
    expect(markup).toContain("today-page");
    expect(markup).toContain("賠率更新於 10 分鐘前");
    expect(markup).toContain("pick-card");
    expect(markup).toContain("1.91–2.04");
    expect(markup).toContain("即將開賽");
    expect(markup).toContain("查看全部賽事");
  });

  it("caps pick cards at 5 and offers overflow button when onShowAll provided", () => {
    const seven = Array.from({ length: 7 }, (_, i) => opportunity(`m${i}`, 0.1));
    const markup = renderToStaticMarkup(
      <TodayPage {...baseProps} opportunities={seven} fixtures={[]} dataFresh onShowAll={() => {}} />,
    );
    expect(markup.match(/class="pick-card"/g)).toHaveLength(5);
    expect(markup).toContain("仲有 2 個盤 →");
  });

  it("hides overflow button without onShowAll", () => {
    const seven = Array.from({ length: 7 }, (_, i) => opportunity(`m${i}`, 0.1));
    const markup = renderToStaticMarkup(
      <TodayPage {...baseProps} opportunities={seven} fixtures={[]} dataFresh />,
    );
    expect(markup).not.toContain("仲有 2 個盤 →");
  });

  it("shows stale empty state when data is not fresh (ignores opportunities)", () => {
    const markup = renderToStaticMarkup(
      <TodayPage {...baseProps} opportunities={[opportunity("m1", 0.13)]} fixtures={[fixture("m1")]} dataFresh={false} />,
    );
    expect(markup).toContain("數據舊咗，唔好住落注 — 更新緊");
    expect(markup).not.toContain("buyable-odds-range");
    expect(markup).not.toContain("today-page__upcoming");
  });

  it("shows no-fixtures state when there are no fixtures", () => {
    const markup = renderToStaticMarkup(
      <TodayPage {...baseProps} opportunities={[]} fixtures={[]} dataFresh />,
    );
    expect(markup).toContain("今日冇波睇，聽日先嚟過");
  });

  it("shows no-value state with fixture count when fixtures exist but nothing qualifies", () => {
    const markup = renderToStaticMarkup(
      <TodayPage {...baseProps} opportunities={[]} fixtures={[fixture("m1"), fixture("m2"), fixture("m3")]} dataFresh />,
    );
    expect(markup).toContain("今日 3 場波，但冇盤值博 — 慳返啖");
  });

  it("limits upcoming fixtures to 3 and links each to its fixture deep link", () => {
    const five = ["a", "b", "c", "d", "e"].map(fixture);
    const markup = renderToStaticMarkup(
      <TodayPage {...baseProps} opportunities={[]} fixtures={five} dataFresh />,
    );
    expect(markup.match(/today-page__upcoming-item/g)).toHaveLength(3);
    expect(markup).toContain('href="#/fixtures/a"');
  });
});
