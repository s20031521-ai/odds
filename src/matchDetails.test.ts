import { describe, expect, it } from "vitest";
import { buildMatchMarketDetails } from "./matchDetails";
import type { AnalysisRow, Fixture } from "./odds";
import type { HandicapCard } from "./handicap";

const fixture: Fixture = {
  matchId: "m1", homeTeam: "Home FC", awayTeam: "Away FC",
  homeTeamZh: "主隊", awayTeamZh: "客隊",
  commenceTime: "2030-01-01T12:00:00.000Z", bookmakerCount: 2, league: "EPL", leagueZh: "英超",
};

function h2hRow(overrides: Partial<AnalysisRow> = {}): AnalysisRow {
  return {
    id: "r1", matchId: "m1", match: "Home FC vs Away FC", bookmaker: "Book A",
    outcome: "home", outcomeLabel: "主勝", odds: 2.0,
    fairProbability: 0.58, breakEvenProbability: 0.5, edge: 0.16,
    suggestedStake: 20, margin: 0.05, riskLabel: "可能有 value",
    ...overrides,
  };
}

function card(overrides: Partial<HandicapCard> = {}): HandicapCard {
  return {
    matchId: "m1", homeTeam: "Home FC", awayTeam: "Away FC",
    commenceTime: "2030-01-01T12:00:00.000Z", league: "EPL",
    line: 2.5, homeOdds: 1.95, awayOdds: 1.95, bookmakerCount: 3,
    bestChance: 0.58, bestEdge: 0.131, bestOdds: 1.95,
    pickLabel: "買 大", bestBookmaker: "Book B", bestSide: "大" as HandicapCard["bestSide"],
    hasHkjc: true,
    ...overrides,
  };
}

const base = { fixtures: [fixture], rows: [h2hRow()], totalCards: [], cornerCards: [], handicapCards: [] };

describe("buildMatchMarketDetails", () => {
  it("resolves header from fixtures with zh names and league", () => {
    const { header } = buildMatchMarketDetails({ matchId: "m1", ...base });
    expect(header).toMatchObject({ matchId: "m1", homeTeamZh: "主隊", awayTeamZh: "客隊", leagueZh: "英超" });
  });

  it("falls back to card metadata when fixture is gone (already kicked off)", () => {
    const { header } = buildMatchMarketDetails({ matchId: "m1", ...base, fixtures: [], handicapCards: [card()] });
    expect(header).toMatchObject({ matchId: "m1", homeTeam: "Home FC", awayTeam: "Away FC" });
  });

  it("returns null header when nothing knows the match", () => {
    const { header } = buildMatchMarketDetails({ matchId: "nope", ...base });
    expect(header).toBeNull();
  });

  it("builds h2h detail from the best-edge row", () => {
    const rows = [h2hRow(), h2hRow({ id: "r2", edge: 0.05, outcomeLabel: "客勝", odds: 3.0, fairProbability: 0.4 })];
    const { details } = buildMatchMarketDetails({ matchId: "m1", ...base, rows });
    expect(details.h2h).toEqual({
      kind: "ok", selection: "主勝", odds: 2.0,
      chance: 0.58, implied: 0.5, edge: 0.16, stake: 20, bookmaker: "Book A",
    });
  });

  it("marks markets without data as empty", () => {
    const { details } = buildMatchMarketDetails({ matchId: "m1", ...base });
    expect(details.totals).toEqual({ kind: "empty" });
    expect(details.corners).toEqual({ kind: "empty" });
    expect(details.handicap).toEqual({ kind: "empty" });
  });

  it("builds card market detail with displayStake and formatted line", () => {
    const { details } = buildMatchMarketDetails({ matchId: "m1", ...base, totalCards: [{ ...card(), id: "t1", bestSide: "大" as const }] });
    expect(details.totals).toMatchObject({
      kind: "ok", selection: "大 2.5", odds: 1.95,
      chance: 0.58, edge: 0.131, bookmaker: "Book B",
    });
    if (details.totals.kind === "ok") {
      expect(details.totals.implied).toBeCloseTo(1 / 1.95, 10);
      expect(details.totals.stake).toBe(20); // displayStake mirror: kelly(0.58,1.95)→cap 2% of 1000
    }
  });

  it("picks the best-edge line when a match has multiple lines", () => {
    const cards = [
      { ...card({ line: 2.0, bestEdge: 0.02 }), id: "t1", bestSide: "大" as const },
      { ...card({ line: 3.0, bestEdge: 0.2 }), id: "t2", bestSide: "大" as const },
    ];
    const { details } = buildMatchMarketDetails({ matchId: "m1", ...base, totalCards: cards });
    expect(details.totals).toMatchObject({ kind: "ok", selection: "大 3.0" });
  });

  it("marks single-bookmaker cards as insufficient", () => {
    const thin = card({ bookmakerCount: 1, bestChance: 0, bestEdge: Number.NEGATIVE_INFINITY, bestOdds: 0, pickLabel: "資料不足，唔買" });
    const { details } = buildMatchMarketDetails({ matchId: "m1", ...base, handicapCards: [thin] });
    expect(details.handicap).toEqual({ kind: "insufficient", note: "資料不足，唔買" });
  });

  it("h2h market is empty when no rows match", () => {
    const { details } = buildMatchMarketDetails({ matchId: "m1", ...base, rows: [h2hRow({ matchId: "other" })] });
    expect(details.h2h).toEqual({ kind: "empty" });
  });
});
