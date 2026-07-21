import { describe, expect, it } from "vitest";
import { formatFixtureDateHeading, formatFixtureDayHeading, groupFixturesByDate } from "./dashboard";

const fixtures = [
  { matchId: "later", homeTeam: "Later", awayTeam: "Away", commenceTime: "2026-07-09T20:00", bookmakerCount: 1 },
  { matchId: "soon", homeTeam: "Soon", awayTeam: "Away", commenceTime: "2026-07-08T20:00", bookmakerCount: 1 },
  { matchId: "same-day", homeTeam: "Same", awayTeam: "Away", commenceTime: "2026-07-08T22:00", bookmakerCount: 1 },
];

describe("dashboard grouping", () => {
  it("groups fixtures by date with nearest day first", () => {
    const groups = groupFixturesByDate(fixtures);

    expect(groups.map((group) => group.date)).toEqual(["2026-07-08", "2026-07-09"]);
    expect(groups[0].fixtures.map((fixture) => fixture.matchId)).toEqual(["soon", "same-day"]);
  });

  it("groups UTC fixtures by their Hong Kong calendar date", () => {
    const groups = groupFixturesByDate([
      { matchId: "midnight", homeTeam: "Home", awayTeam: "Away", commenceTime: "2026-08-21T19:00:00Z", bookmakerCount: 1 },
    ]);

    expect(groups.map((group) => group.date)).toEqual(["2026-08-22"]);
  });

  it("formats a date heading without a midnight time", () => {
    expect(formatFixtureDateHeading("2026-08-22")).toBe("2026/08/22");
    expect(formatFixtureDateHeading("未設定日期")).toBe("未設定日期");
  });

  it("prefixes today and tomorrow headings in Hong Kong time", () => {
    const now = new Date("2026-08-21T17:00:00Z"); // 香港時間 2026-08-22 01:00

    expect(formatFixtureDayHeading("2026-08-22", now)).toBe("今日 2026/08/22");
    expect(formatFixtureDayHeading("2026-08-23", now)).toBe("聽日 2026/08/23");
    expect(formatFixtureDayHeading("2026-08-24", now)).toBe("2026/08/24");
    expect(formatFixtureDayHeading("未設定日期", now)).toBe("未設定日期");
  });
});
