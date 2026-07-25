import { describe, expect, it } from "vitest";
import {
  filterFixturePicks,
  formatFixturePickLabel,
  fixturePickFromPrefill,
  type FixturePick,
} from "./fixtureSearch";

const fixtures: FixturePick[] = [
  {
    matchId: "m1",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    homeTeamZh: "阿仙奴",
    awayTeamZh: "車路士",
    commenceTime: "2026-07-28T12:00:00Z",
  },
  {
    matchId: "m2",
    homeTeam: "Liverpool",
    awayTeam: "Everton",
    homeTeamZh: "利物浦",
    awayTeamZh: "愛華頓",
    commenceTime: "2026-07-27T15:00:00Z",
  },
  {
    matchId: "m3",
    homeTeam: "Barcelona",
    awayTeam: "Real Madrid",
    commenceTime: "2026-07-29T18:00:00Z",
    league: "La Liga",
  },
];

describe("formatFixturePickLabel", () => {
  it("prefers zh labels", () => {
    expect(formatFixturePickLabel(fixtures[0])).toBe("阿仙奴 vs 車路士");
  });

  it("falls back to english", () => {
    expect(formatFixturePickLabel(fixtures[2])).toBe("Barcelona vs Real Madrid");
  });
});

describe("filterFixturePicks", () => {
  it("returns latest first when query empty", () => {
    const hits = filterFixturePicks(fixtures, "", 10);
    expect(hits.map((f) => f.matchId)).toEqual(["m3", "m1", "m2"]);
  });

  it("matches chinese team name", () => {
    const hits = filterFixturePicks(fixtures, "阿仙奴");
    expect(hits.map((f) => f.matchId)).toEqual(["m1"]);
  });

  it("matches english team or league", () => {
    expect(filterFixturePicks(fixtures, "liverpool").map((f) => f.matchId)).toEqual(["m2"]);
    expect(filterFixturePicks(fixtures, "liga").map((f) => f.matchId)).toEqual(["m3"]);
  });

  it("matches matchId", () => {
    expect(filterFixturePicks(fixtures, "m2").map((f) => f.matchId)).toEqual(["m2"]);
  });
});

describe("fixturePickFromPrefill", () => {
  it("returns null when no match fields", () => {
    expect(fixturePickFromPrefill({ market: "totals" } as never)).toBeNull();
    expect(fixturePickFromPrefill(undefined)).toBeNull();
  });

  it("builds pick from prefill", () => {
    const pick = fixturePickFromPrefill({
      matchId: "m1",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      homeTeamZh: "阿仙奴",
      commenceTime: "2026-07-28T12:00:00Z",
    });
    expect(pick?.matchId).toBe("m1");
    expect(pick?.homeTeamZh).toBe("阿仙奴");
  });
});
