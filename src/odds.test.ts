import { describe, expect, it } from "vitest";
import {
  analyzeEntries,
  fairProbabilities,
  filterLegacySampleEntries,
  impliedProbability,
  kellyStake,
  overround,
  sortFixturesByBestEdge,
  upcomingFixtures,
  valueEdge,
  type AnalysisRow,
  type AnalyzerSettings,
  type ManualEntry,
} from "./odds";

const settings: AnalyzerSettings = {
  bankroll: 1000,
  fractionalKelly: 0.25,
  stakeCapPercent: 0.02,
  edgeThreshold: 0.03,
};

describe("odds calculations", () => {
  it("converts decimal odds to implied probability", () => {
    expect(impliedProbability(2)).toBe(0.5);
  });

  it("calculates overround and fair probabilities", () => {
    const odds = { home: 2, draw: 3.5, away: 4 };
    expect(overround(odds)).toBeCloseTo(0.0357, 4);

    const fair = fairProbabilities(odds);
    expect(fair.home + fair.draw + fair.away).toBeCloseTo(1);
    expect(fair.home).toBeCloseTo(0.4828, 4);
  });

  it("calculates value edge", () => {
    expect(valueEdge(2.2, 0.5)).toBeCloseTo(0.1);
  });

  it("caps fractional Kelly stake", () => {
    const stake = kellyStake(3, 0.5, settings);
    expect(stake).toBe(20);
  });

  it("returns no stake for negative Kelly", () => {
    expect(kellyStake(1.5, 0.3, settings)).toBe(0);
  });

  it("rejects invalid odds", () => {
    expect(() => impliedProbability(1)).toThrow();
    expect(() => overround({ home: 2, draw: 0, away: 4 })).toThrow();
  });

  it("dedupes fixtures and sorts by kickoff", () => {
    const fixtures = upcomingFixtures([
      { ...entry("late-a", "Market A", { home: 2, draw: 3, away: 4 }), matchId: "late", commenceTime: "2026-07-10T20:00" },
      { ...entry("early-a", "Market A", { home: 2, draw: 3, away: 4 }), matchId: "early", commenceTime: "2026-07-09T20:00" },
      { ...entry("early-b", "Market B", { home: 2.1, draw: 3, away: 3.8 }), matchId: "early", commenceTime: "2026-07-09T20:00" },
    ], Date.parse("2026-07-09T00:00:00Z"));

    expect(fixtures.map((fixture) => fixture.matchId)).toEqual(["early", "late"]);
    expect(fixtures[0].bookmakerCount).toBe(2);
  });

  it("carries the league from any entry of the match into the fixture", () => {
    const fixtures = upcomingFixtures([
      { ...entry("a", "Market A", { home: 2, draw: 3, away: 4 }), matchId: "with-league", homeTeam: "Home", awayTeam: "Away", commenceTime: "2026-07-10T20:00" },
      { ...entry("b", "Market B", { home: 2.1, draw: 3, away: 3.8 }), matchId: "with-league", homeTeam: "Home", awayTeam: "Away", commenceTime: "2026-07-10T20:00", league: "English Premier League" },
      { ...entry("c", "Market A", { home: 2, draw: 3, away: 4 }), matchId: "without-league", homeTeam: "Other Home", awayTeam: "Other Away", commenceTime: "2026-07-10T21:00" },
    ], Date.parse("2026-07-09T00:00:00Z"));

    expect(fixtures.find((fixture) => fixture.matchId === "with-league")?.league).toBe("English Premier League");
    expect(fixtures.find((fixture) => fixture.matchId === "without-league")).not.toHaveProperty("league");
  });

  it("carries Chinese display names from any entry of the match into the fixture", () => {
    const fixtures = upcomingFixtures([
      { ...entry("a", "Market A", { home: 2, draw: 3, away: 4 }), matchId: "zh-match", homeTeam: "Home", awayTeam: "Away", commenceTime: "2026-07-10T20:00" },
      { ...entry("b", "HKJC", { home: 2.1, draw: 3, away: 3.8 }), matchId: "zh-match", homeTeam: "Home", awayTeam: "Away", commenceTime: "2026-07-10T20:00", homeTeamZh: "主隊", awayTeamZh: "客隊" },
      { ...entry("c", "Market A", { home: 2, draw: 3, away: 4 }), matchId: "en-only", homeTeam: "Other Home", awayTeam: "Other Away", commenceTime: "2026-07-10T21:00" },
    ], Date.parse("2026-07-09T00:00:00Z"));

    const zh = fixtures.find((fixture) => fixture.matchId === "zh-match");
    expect(zh?.homeTeam).toBe("Home");
    expect(zh?.homeTeamZh).toBe("主隊");
    expect(zh?.awayTeamZh).toBe("客隊");
    expect(fixtures.find((fixture) => fixture.matchId === "en-only")).not.toHaveProperty("homeTeamZh");
  });

  it("carries leagueZh from any entry of the match into the fixture", () => {
    const fixtures = upcomingFixtures([
      { ...entry("a", "Market A", { home: 2, draw: 3, away: 4 }), matchId: "zh-league", homeTeam: "Home", awayTeam: "Away", commenceTime: "2026-07-10T20:00", league: "English Premier League" },
      { ...entry("b", "HKJC", { home: 2.1, draw: 3, away: 3.8 }), matchId: "zh-league", homeTeam: "Home", awayTeam: "Away", commenceTime: "2026-07-10T20:00", league: "English Premier League", leagueZh: "英格蘭超級聯賽" },
      { ...entry("c", "Market A", { home: 2, draw: 3, away: 4 }), matchId: "en-league", homeTeam: "Other Home", awayTeam: "Other Away", commenceTime: "2026-07-10T21:00", league: "Liga MX" },
    ], Date.parse("2026-07-09T00:00:00Z"));

    const zh = fixtures.find((fixture) => fixture.matchId === "zh-league");
    expect(zh?.league).toBe("English Premier League");
    expect(zh?.leagueZh).toBe("英格蘭超級聯賽");
    expect(fixtures.find((fixture) => fixture.matchId === "en-league")).not.toHaveProperty("leagueZh");
  });

  it("keeps only fixtures that have not kicked off", () => {
    const fixtures = upcomingFixtures([
      { ...entry("past", "Market A", { home: 2, draw: 3, away: 4 }), matchId: "past", homeTeam: "Past FC", commenceTime: "2026-07-10T11:59:59Z" },
      { ...entry("started", "Market A", { home: 2, draw: 3, away: 4 }), matchId: "started", homeTeam: "Started FC", commenceTime: "2026-07-10T12:00:00Z" },
      { ...entry("future", "Market A", { home: 2, draw: 3, away: 4 }), matchId: "future", homeTeam: "Future FC", commenceTime: "2026-07-10T12:00:01Z" },
      { ...entry("invalid", "Market A", { home: 2, draw: 3, away: 4 }), matchId: "invalid", homeTeam: "Invalid FC", commenceTime: "not-a-date" },
    ], Date.parse("2026-07-10T12:00:00Z"));

    expect(fixtures.map((fixture) => fixture.matchId)).toEqual(["future"]);
  });

  it("merges provider fixture IDs by English teams and kickoff, preferring HKJC for settlement", () => {
    const hkjc = { ...entry("h", "HKJC", { home: 2, draw: 3.4, away: 4 }), matchId: "hkjc-1", homeTeam: "Djurgardens", awayTeam: "Halmstads", commenceTime: "2026-07-14T01:00:00+08:00" };
    const external = { ...entry("e", "Book", { home: 2.1, draw: 3.3, away: 3.9 }), matchId: "external-1", homeTeam: "Djurgårdens IF", awayTeam: "Halmstads BK", commenceTime: "2026-07-13T17:05:00Z" };
    expect(upcomingFixtures([external, hkjc], Date.parse("2026-07-13T00:00:00Z"))).toEqual([expect.objectContaining({ matchId: "hkjc-1", bookmakerCount: 2 })]);
    expect(analyzeEntries([external, hkjc], settings).every((row) => row.matchId === "hkjc-1")).toBe(true);
  });

  it("sorts dashboard fixtures by best edge first", () => {
    const fixtures = [
      { matchId: "low", homeTeam: "Low", awayTeam: "Away", commenceTime: "2026-07-09T20:00", bookmakerCount: 1 },
      { matchId: "high", homeTeam: "High", awayTeam: "Away", commenceTime: "2026-07-10T20:00", bookmakerCount: 1 },
    ];

    const sorted = sortFixturesByBestEdge(fixtures, [
      { ...row("Low vs Away"), edge: 0.02 },
      { ...row("High vs Away"), edge: 0.12 },
    ]);

    expect(sorted.map((fixture) => fixture.matchId)).toEqual(["high", "low"]);
  });

  it("drops legacy hardcoded sample entries", () => {
    const real = { ...entry("real-a", "Market A", { home: 2, draw: 3, away: 4 }), matchId: "real-match" };
    const sample = { ...entry("sample-1", "Bookmaker A", { home: 2.05, draw: 3.45, away: 3.75 }), matchId: "sample-match" };

    expect(filterLegacySampleEntries([sample, real])).toEqual([real]);
  });

  it("analyzes complete 1X2 entries and sorts value first", () => {
    const entries: ManualEntry[] = [
      entry("a", "Market A", { home: 2, draw: 3.4, away: 4 }),
      entry("b", "Market B", { home: 2.15, draw: 3.25, away: 3.7 }),
      entry("c", "Market C", { home: 2.5, draw: 3.2, away: 3.6 }),
    ];

    const rows = analyzeEntries(entries, settings);
    expect(rows).toHaveLength(9);
    expect(rows.every((row) => row.matchId === "match-1")).toBe(true);
    expect(rows[0].edge).toBeGreaterThanOrEqual(rows[1].edge);
    expect(rows.some((row) => row.riskLabel === "可能有 value")).toBe(true);
  });
});

function row(match: string): AnalysisRow {
  return {
    id: match,
    matchId: match.startsWith("High") ? "high" : "low",
    match,
    bookmaker: "Market",
    outcome: "home",
    outcomeLabel: "主勝",
    odds: 2,
    fairProbability: 0.5,
    breakEvenProbability: 0.5,
    edge: 0,
    suggestedStake: 0,
    margin: 0,
    riskLabel: "觀察",
  };
}

function entry(id: string, bookmaker: string, odds: ManualEntry["odds"]): ManualEntry {
  return {
    id,
    matchId: "match-1",
    homeTeam: "Home FC",
    awayTeam: "Away FC",
    commenceTime: "2026-07-07T12:00",
    bookmaker,
    odds,
  };
}
