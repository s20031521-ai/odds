import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LandingPage } from "./TodayPage";

describe("LandingPage recommendation coverage", () => {
  it("separates Hong Kong today's fixtures from all upcoming and shows peer coverage", () => {
    const now = Date.parse("2026-08-23T04:00:00.000Z");
    const markup = renderToStaticMarkup(
      <LandingPage
        opportunities={[]}
        fixtures={[
          fixture("today-single", "2026-08-23T10:00:00.000Z", 1),
          fixture("today-peer", "2026-08-23T14:00:00.000Z", 3),
          fixture("tomorrow", "2026-08-24T02:00:00.000Z", 1),
        ]}
        generatedAt="2026-08-23T04:00:00.000Z"
        dataFresh
        logos={{}}
        now={now}
      />
    );

    expect(markup).toContain("今日 2 場波｜1 場已有多莊家比較｜暫時 0 個達 3% 推薦門檻");
    expect(markup).toContain("場未開波賽程");
  });
});

function fixture(matchId: string, commenceTime: string, bookmakerCount: number) {
  return {
    matchId,
    homeTeam: `${matchId} home`,
    awayTeam: `${matchId} away`,
    commenceTime,
    bookmakerCount,
  };
}
