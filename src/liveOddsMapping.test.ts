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
  it("maps flat h2h rows into complete ManualEntry triplets", () => {
    const payload = normalizeLiveOddsPayload({
      entries: [
        flat({ market: "h2h", selection: "home", odds: 2 }),
        flat({ market: "h2h", selection: "draw", odds: 3.2 }),
        flat({ market: "h2h", selection: "away", odds: 3.8 }),
        // point markets ignored on the client path
        flat({ market: "totals", selection: "over", line: 2.5, odds: 1.9 }),
        flat({ market: "totals", selection: "under", line: 2.5, odds: 1.95 }),
        flat({ market: "spreads", selection: "home", line: -0.25, odds: 2.1 }),
        flat({ market: "spreads", selection: "away", line: -0.25, odds: 1.82 }),
      ],
    });

    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0].odds).toEqual({ home: 2, draw: 3.2, away: 3.8 });
  });

  it("drops incomplete h2h triplets instead of partial odds objects", () => {
    const payload = normalizeLiveOddsPayload({
      entries: [
        flat({ market: "h2h", selection: "home", odds: 2 }),
        flat({ market: "h2h", selection: "draw", odds: 3.2 }),
        null,
        "garbage",
      ],
    });

    expect(payload.entries).toEqual([]);
  });

  it("threads league and Chinese names through on h2h entries", () => {
    const payload = normalizeLiveOddsPayload({
      entries: [
        flat({ market: "h2h", selection: "home", odds: 2, league: "EPL", leagueZh: "英格蘭超級聯賽", homeTeamZh: "主隊", awayTeamZh: "客隊" }),
        flat({ market: "h2h", selection: "draw", odds: 3.2, league: "EPL", leagueZh: "英格蘭超級聯賽", homeTeamZh: "主隊", awayTeamZh: "客隊" }),
        flat({ market: "h2h", selection: "away", odds: 3.8, league: "EPL", leagueZh: "英格蘭超級聯賽", homeTeamZh: "主隊", awayTeamZh: "客隊" }),
      ],
    });

    expect(payload.entries[0]).toMatchObject({
      homeTeam: "Home",
      league: "EPL",
      leagueZh: "英格蘭超級聯賽",
      homeTeamZh: "主隊",
      awayTeamZh: "客隊",
    });
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

  it("returns empty entries for a missing or malformed payload", () => {
    expect(normalizeLiveOddsPayload(null)).toEqual({ entries: [] });
    expect(normalizeLiveOddsPayload({})).toEqual({ entries: [] });
  });
});
