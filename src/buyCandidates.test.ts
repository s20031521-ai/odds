import { describe, expect, it } from "vitest";
import { buildBuyCandidates } from "./buyCandidates";

const fixture = {
  matchId: "match-1",
  homeTeam: "Home",
  awayTeam: "Away",
  commenceTime: "2026-07-17T12:00:00Z",
};

describe("buildBuyCandidates", () => {
  it("maps H2H fields by joining fixture data", () => {
    const result = buildBuyCandidates({
      fixtures: [fixture],
      h2hRows: [{
        matchId: fixture.matchId,
        outcomeLabel: "主隊",
        bookmaker: "H2H Book",
        odds: 2.1,
        fairProbability: 0.52,
        edge: 0.092,
      }],
      totalCards: [],
      cornerCards: [],
      handicapCards: [],
    });

    expect(result).toEqual([{
      ...fixture,
      market: "主客和",
      selection: "主隊",
      bookmaker: "H2H Book",
      odds: 2.1,
      chance: 0.52,
      edge: 0.092,
    }]);
  });

  it("maps numeric market-card fields without reading localized pick labels", () => {
    const shared = {
      ...fixture,
      line: 2.5,
      bestOdds: 2.06,
      bestChance: 0.53,
      bestEdge: 0.0918,
      bestBookmaker: "Numbers Book",
      pickLabel: "故意錯誤、不得解析",
    };

    const result = buildBuyCandidates({
      fixtures: [fixture],
      h2hRows: [],
      totalCards: [{ ...shared, bestSide: "大" }],
      cornerCards: [{ ...shared, line: 9.5, bestSide: "細" }],
      handicapCards: [{ ...shared, line: -0.5, bestSide: "客" }],
    });

    expect(result).toEqual([
      expect.objectContaining({ market: "大細波", selection: "大", line: 2.5, odds: 2.06, chance: 0.53, edge: 0.0918, bookmaker: "Numbers Book" }),
      expect.objectContaining({ market: "角球", selection: "細角", line: 9.5 }),
      expect.objectContaining({ market: "亞洲讓球", selection: "客", line: -0.5 }),
    ]);
    expect(result.map((candidate) => candidate.selection)).not.toContain("故意錯誤、不得解析");
  });

  it("threads league from fixtures and market cards into candidates, omitting it when missing", () => {
    const result = buildBuyCandidates({
      fixtures: [{ ...fixture, league: "English Premier League" }],
      h2hRows: [{
        matchId: fixture.matchId,
        outcomeLabel: "主隊",
        bookmaker: "H2H Book",
        odds: 2.1,
        fairProbability: 0.52,
        edge: 0.092,
      }],
      totalCards: [{ ...fixture, line: 2.5, bestSide: "大", bestOdds: 2.06, bestChance: 0.53, bestEdge: 0.0918, bestBookmaker: "Numbers Book", league: "Liga MX" }],
      cornerCards: [],
      handicapCards: [{ ...fixture, line: -0.5, bestSide: "客", bestOdds: 2, bestChance: 0.5, bestEdge: 0.05, bestBookmaker: "HDC Book" }],
    });

    expect(result[0].league).toBe("English Premier League");
    expect(result[1].league).toBe("Liga MX");
    expect(result[2]).not.toHaveProperty("league");
  });

  it("threads Chinese display names from fixtures and market cards into candidates, omitting them when missing", () => {
    const result = buildBuyCandidates({
      fixtures: [{ ...fixture, homeTeamZh: "主隊", awayTeamZh: "客隊" }],
      h2hRows: [{
        matchId: fixture.matchId,
        outcomeLabel: "主隊",
        bookmaker: "H2H Book",
        odds: 2.1,
        fairProbability: 0.52,
        edge: 0.092,
      }],
      totalCards: [{ ...fixture, line: 2.5, bestSide: "大", bestOdds: 2.06, bestChance: 0.53, bestEdge: 0.0918, bestBookmaker: "Numbers Book", homeTeamZh: "主隊" }],
      cornerCards: [],
      handicapCards: [{ ...fixture, line: -0.5, bestSide: "客", bestOdds: 2, bestChance: 0.5, bestEdge: 0.05, bestBookmaker: "HDC Book" }],
    });

    expect(result[0].homeTeamZh).toBe("主隊");
    expect(result[0].awayTeamZh).toBe("客隊");
    expect(result[1].homeTeamZh).toBe("主隊");
    expect(result[1]).not.toHaveProperty("awayTeamZh");
    expect(result[2]).not.toHaveProperty("homeTeamZh");
  });

  it("threads leagueZh from fixtures and market cards into candidates, omitting it when missing", () => {
    const result = buildBuyCandidates({
      fixtures: [{ ...fixture, league: "English Premier League", leagueZh: "英格蘭超級聯賽" }],
      h2hRows: [{
        matchId: fixture.matchId,
        outcomeLabel: "主隊",
        bookmaker: "H2H Book",
        odds: 2.1,
        fairProbability: 0.52,
        edge: 0.092,
      }],
      totalCards: [{ ...fixture, line: 2.5, bestSide: "大", bestOdds: 2.06, bestChance: 0.53, bestEdge: 0.0918, bestBookmaker: "Numbers Book", leagueZh: "墨西哥超級聯賽" }],
      cornerCards: [],
      handicapCards: [{ ...fixture, line: -0.5, bestSide: "客", bestOdds: 2, bestChance: 0.5, bestEdge: 0.05, bestBookmaker: "HDC Book" }],
    });

    expect(result[0].leagueZh).toBe("英格蘭超級聯賽");
    expect(result[1].leagueZh).toBe("墨西哥超級聯賽");
    expect(result[2]).not.toHaveProperty("leagueZh");
  });

  it("keeps numeric rows for fail-closed selector validation and skips H2H rows without fixtures", () => {
    const result = buildBuyCandidates({
      fixtures: [],
      h2hRows: [{ matchId: "missing", outcomeLabel: "主隊", bookmaker: "Book", odds: 2, fairProbability: 0.5, edge: 0 }],
      totalCards: [{ ...fixture, line: Number.NaN, bestSide: null, bestOdds: 0, bestChance: 0, bestEdge: Number.NEGATIVE_INFINITY, bestBookmaker: "Book" }],
      cornerCards: [],
      handicapCards: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ market: "大細波", selection: "", line: Number.NaN });
  });
});
