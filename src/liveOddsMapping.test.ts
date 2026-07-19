import { describe, expect, it } from "vitest";
import { normalizeLiveOddsPayload } from "./App";

describe("live odds API payload mapping", () => {
  it("maps provider-key flat rows into existing UI market shapes", () => {
    const payload = normalizeLiveOddsPayload({
      entries: [
        flat({ market: "h2h", selection: "home", odds: 2 }),
        flat({ market: "h2h", selection: "draw", odds: 3.2 }),
        flat({ market: "h2h", selection: "away", odds: 3.8 }),
        flat({ market: "totals", selection: "over", line: 2.5, price: 1.9 }),
        flat({ market: "totals", selection: "under", line: 2.5, price: 1.95 }),
        flat({ market: "alternate_totals_corners", selection: "over", point: 9.5, odds: 2.05 }),
        flat({ market: "alternate_totals_corners", selection: "under", point: 9.5, odds: 1.8 }),
        flat({ market: "spreads", selection: "home", line: -0.25, odds: 2.1 }),
        flat({ market: "spreads", selection: "away", line: -0.25, odds: 1.82 }),
      ],
    });

    expect(payload.entries[0].odds).toEqual({ home: 2, draw: 3.2, away: 3.8 });
    expect(payload.totalEntries[0]).toMatchObject({ line: 2.5, overOdds: 1.9, underOdds: 1.95 });
    expect(payload.cornerEntries[0]).toMatchObject({ line: 9.5, overOdds: 2.05, underOdds: 1.8 });
    expect(payload.handicapEntries[0]).toMatchObject({ line: -0.25, homeOdds: 2.1, awayOdds: 1.82 });
  });

  it("drops malformed flat rows instead of casting them into UI state", () => {
    const payload = normalizeLiveOddsPayload({
      entries: [
        flat({ market: "totals", selection: "over", line: 2.5, odds: Number.NaN }),
        { market: "spreads", selection: "home", odds: 2 },
      ],
    });

    expect(payload.entries).toEqual([]);
    expect(payload.totalEntries).toEqual([]);
    expect(payload.cornerEntries).toEqual([]);
    expect(payload.handicapEntries).toEqual([]);
  });

  it("threads league from flat rows into normalized entries and omits it when missing", () => {
    const payload = normalizeLiveOddsPayload({
      entries: [
        flat({ market: "h2h", selection: "home", odds: 2, league: "EPL" }),
        flat({ market: "h2h", selection: "draw", odds: 3.2, league: "EPL" }),
        flat({ market: "h2h", selection: "away", odds: 3.8, league: "EPL" }),
        flat({ market: "totals", selection: "over", line: 2.5, odds: 1.9, league: "Liga MX" }),
        flat({ market: "totals", selection: "under", line: 2.5, odds: 1.95, league: "Liga MX" }),
        flat({ market: "spreads", selection: "home", line: -0.25, odds: 2.1 }),
        flat({ market: "spreads", selection: "away", line: -0.25, odds: 1.82 }),
      ],
    });

    expect(payload.entries[0].league).toBe("EPL");
    expect(payload.totalEntries[0].league).toBe("Liga MX");
    expect(payload.handicapEntries[0]).not.toHaveProperty("league");
  });

  it("threads Chinese team names from flat rows into normalized entries and omits them when missing", () => {
    const payload = normalizeLiveOddsPayload({
      entries: [
        flat({ market: "h2h", selection: "home", odds: 2, homeTeamZh: "主隊", awayTeamZh: "客隊" }),
        flat({ market: "h2h", selection: "draw", odds: 3.2, homeTeamZh: "主隊", awayTeamZh: "客隊" }),
        flat({ market: "h2h", selection: "away", odds: 3.8, homeTeamZh: "主隊", awayTeamZh: "客隊" }),
        flat({ market: "totals", selection: "over", line: 2.5, odds: 1.9 }),
        flat({ market: "totals", selection: "under", line: 2.5, odds: 1.95 }),
        flat({ market: "spreads", selection: "home", line: -0.25, odds: 2.1, homeTeamZh: "主隊", awayTeamZh: "客隊" }),
        flat({ market: "spreads", selection: "away", line: -0.25, odds: 1.82, homeTeamZh: "主隊", awayTeamZh: "客隊" }),
      ],
    });

    expect(payload.entries[0].homeTeam).toBe("Home");
    expect(payload.entries[0].homeTeamZh).toBe("主隊");
    expect(payload.entries[0].awayTeamZh).toBe("客隊");
    expect(payload.totalEntries[0]).not.toHaveProperty("homeTeamZh");
    expect(payload.totalEntries[0]).not.toHaveProperty("awayTeamZh");
    expect(payload.handicapEntries[0].homeTeamZh).toBe("主隊");
    expect(payload.handicapEntries[0].awayTeamZh).toBe("客隊");
  });

  it("threads leagueZh from flat rows into normalized entries and omits it when missing", () => {
    const payload = normalizeLiveOddsPayload({
      entries: [
        flat({ market: "h2h", selection: "home", odds: 2, leagueZh: "英格蘭超級聯賽" }),
        flat({ market: "h2h", selection: "draw", odds: 3.2, leagueZh: "英格蘭超級聯賽" }),
        flat({ market: "h2h", selection: "away", odds: 3.8, leagueZh: "英格蘭超級聯賽" }),
        flat({ market: "totals", selection: "over", line: 2.5, odds: 1.9 }),
        flat({ market: "totals", selection: "under", line: 2.5, odds: 1.95 }),
        flat({ market: "spreads", selection: "home", line: -0.25, odds: 2.1, leagueZh: "香港超級聯賽" }),
        flat({ market: "spreads", selection: "away", line: -0.25, odds: 1.82, leagueZh: "香港超級聯賽" }),
      ],
    });

    expect(payload.entries[0].leagueZh).toBe("英格蘭超級聯賽");
    expect(payload.totalEntries[0]).not.toHaveProperty("leagueZh");
    expect(payload.handicapEntries[0].leagueZh).toBe("香港超級聯賽");
  });
});

function flat(overrides: Record<string, unknown>) {
  return {
    id: `${overrides.market}-${overrides.selection}`,
    matchId: "match-1",
    homeTeam: "Home",
    awayTeam: "Away",
    commenceTime: "2026-07-18T10:00:00.000Z",
    bookmaker: "Book",
    ...overrides,
  };
}
