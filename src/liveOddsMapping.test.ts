import { describe, expect, it } from "vitest";
import { normalizeLiveOddsPayload } from "./liveOddsMapping";

function flat(overrides: Record<string, unknown>) {
  return {
    id: `${String(overrides.market)}-${String(overrides.selection)}`,
    matchId: "match-1",
    homeTeam: "Home",
    awayTeam: "Away",
    commenceTime: "2026-07-18T10:00:00.000Z",
    bookmaker: "Book",
    ...overrides,
  };
}

describe("normalizeLiveOddsPayload", () => {
  it("maps provider flat rows into existing UI market shapes", () => {
    const payload = normalizeLiveOddsPayload({
      entries: [
        flat({ market: "h2h", selection: "home", odds: 2 }),
        flat({ market: "h2h", selection: "draw", odds: 3.2 }),
        flat({ market: "h2h", selection: "away", odds: 3.8 }),
        flat({ market: "totals", selection: "over", line: 2.5, odds: 1.9 }),
        flat({ market: "totals", selection: "under", line: 2.5, odds: 1.95 }),
        flat({ market: "alternate_totals_corners", selection: "over", line: 9.5, odds: 2.05 }),
        flat({ market: "alternate_totals_corners", selection: "under", line: 9.5, odds: 1.8 }),
        flat({ market: "corners", selection: "over", line: 10.5, odds: 2.1 }),
        flat({ market: "corners", selection: "under", line: 10.5, odds: 1.75 }),
        flat({ market: "spreads", selection: "home", line: -0.25, odds: 2.1 }),
        flat({ market: "spreads", selection: "away", line: -0.25, odds: 1.82 }),
      ],
    });

    expect(payload.entries[0].odds).toEqual({ home: 2, draw: 3.2, away: 3.8 });
    expect(payload.totalEntries[0]).toMatchObject({ line: 2.5, overOdds: 1.9, underOdds: 1.95 });
    expect(payload.cornerEntries[0]).toMatchObject({ line: 9.5, overOdds: 2.05, underOdds: 1.8 });
    expect(payload.cornerEntries[1]).toMatchObject({ line: 10.5, overOdds: 2.1, underOdds: 1.75 });
    expect(payload.handicapEntries[0]).toMatchObject({ line: -0.25, homeOdds: 2.1, awayOdds: 1.82 });
  });

  it("drops malformed flat rows instead of casting them into UI state", () => {
    const payload = normalizeLiveOddsPayload({
      entries: [
        flat({ market: "totals", selection: "over", line: 2.5, odds: Number.NaN }),
        { market: "spreads", selection: "home", odds: 2 },
        flat({ market: "h2h", selection: "home", odds: 2 }),
        flat({ market: "h2h", selection: "draw", odds: 3.2 }),
        null,
        "garbage",
      ],
    });

    // Incomplete h2h triplet (missing away) must not produce a partial odds object,
    // which previously crashed overround() during render and blanked the page.
    expect(payload.entries).toEqual([]);
    expect(payload.totalEntries).toEqual([]);
    expect(payload.cornerEntries).toEqual([]);
    expect(payload.handicapEntries).toEqual([]);
  });

  it("keeps separate lines for the same match and bookmaker", () => {
    const payload = normalizeLiveOddsPayload({
      entries: [
        flat({ id: "m1-bk-25:over", market: "totals", selection: "over", line: 2.5, odds: 1.9 }),
        flat({ id: "m1-bk-25:under", market: "totals", selection: "under", line: 2.5, odds: 1.95 }),
        flat({ id: "m1-bk-35:over", market: "totals", selection: "over", line: 3.5, odds: 2.4 }),
        flat({ id: "m1-bk-35:under", market: "totals", selection: "under", line: 3.5, odds: 1.6 }),
      ],
    });

    expect(payload.totalEntries).toHaveLength(2);
    expect(payload.totalEntries[0]).toMatchObject({ line: 2.5 });
    expect(payload.totalEntries[1]).toMatchObject({ line: 3.5 });
  });

  it("threads league and Chinese names through, omitting them when missing", () => {
    const payload = normalizeLiveOddsPayload({
      entries: [
        flat({ market: "h2h", selection: "home", odds: 2, league: "EPL", leagueZh: "英格蘭超級聯賽", homeTeamZh: "主隊", awayTeamZh: "客隊" }),
        flat({ market: "h2h", selection: "draw", odds: 3.2, league: "EPL", leagueZh: "英格蘭超級聯賽", homeTeamZh: "主隊", awayTeamZh: "客隊" }),
        flat({ market: "h2h", selection: "away", odds: 3.8, league: "EPL", leagueZh: "英格蘭超級聯賽", homeTeamZh: "主隊", awayTeamZh: "客隊" }),
        flat({ market: "totals", selection: "over", line: 2.5, odds: 1.9 }),
        flat({ market: "totals", selection: "under", line: 2.5, odds: 1.95 }),
      ],
    });

    expect(payload.entries[0]).toMatchObject({ homeTeam: "Home", league: "EPL", leagueZh: "英格蘭超級聯賽", homeTeamZh: "主隊", awayTeamZh: "客隊" });
    expect(payload.totalEntries[0]).not.toHaveProperty("league");
    expect(payload.totalEntries[0]).not.toHaveProperty("leagueZh");
    expect(payload.totalEntries[0]).not.toHaveProperty("homeTeamZh");
  });

  it("passes through legacy nested entries unchanged", () => {
    const legacy = {
      id: "legacy-1",
      matchId: "match-1",
      homeTeam: "Home",
      awayTeam: "Away",
      commenceTime: "2026-07-18T10:00:00.000Z",
      bookmaker: "Book",
      odds: { home: 2, draw: 3.2, away: 3.8 },
    };
    const payload = normalizeLiveOddsPayload({ entries: [legacy] });

    expect(payload.entries[0]).toMatchObject({ id: "legacy-1", odds: { home: 2, draw: 3.2, away: 3.8 } });
  });

  it("returns empty buckets for a missing or malformed payload", () => {
    expect(normalizeLiveOddsPayload(null)).toEqual({ entries: [], totalEntries: [], cornerEntries: [], handicapEntries: [] });
    expect(normalizeLiveOddsPayload({})).toEqual({ entries: [], totalEntries: [], cornerEntries: [], handicapEntries: [] });
  });
});
