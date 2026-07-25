import { describe, expect, it } from "vitest";
import {
  filterFixturePicks,
  finishedPicksFromResultRows,
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
    status: "upcoming",
  },
  {
    matchId: "m2",
    homeTeam: "Liverpool",
    awayTeam: "Everton",
    homeTeamZh: "利物浦",
    awayTeamZh: "愛華頓",
    commenceTime: "2026-07-27T15:00:00Z",
    status: "finished",
    score: "2-1",
  },
  {
    matchId: "m3",
    homeTeam: "Barcelona",
    awayTeam: "Real Madrid",
    commenceTime: "2026-07-29T18:00:00Z",
    league: "La Liga",
    status: "upcoming",
  },
  {
    matchId: "m4",
    homeTeam: "",
    awayTeam: "",
    commenceTime: "2026-07-26T12:00:00Z",
    status: "finished",
  },
];

describe("formatFixturePickLabel", () => {
  it("prefers zh labels", () => {
    expect(formatFixturePickLabel(fixtures[0])).toBe("阿仙奴 vs 車路士");
  });

  it("falls back to english", () => {
    expect(formatFixturePickLabel(fixtures[2])).toBe("Barcelona vs Real Madrid");
  });

  it("falls back to matchId when no teams", () => {
    expect(formatFixturePickLabel(fixtures[3])).toBe("m4");
  });
});

describe("filterFixturePicks", () => {
  it("returns latest first when query empty", () => {
    const hits = filterFixturePicks(fixtures, "", 10);
    expect(hits.map((f) => f.matchId)).toEqual(["m3", "m1", "m2", "m4"]);
  });

  it("filters by status tab", () => {
    expect(filterFixturePicks(fixtures, "", 20, "upcoming").map((f) => f.matchId)).toEqual(["m3", "m1"]);
    expect(filterFixturePicks(fixtures, "", 20, "finished").map((f) => f.matchId)).toEqual(["m2", "m4"]);
  });

  it("matches chinese team name within tab", () => {
    const hits = filterFixturePicks(fixtures, "阿仙奴", 20, "upcoming");
    expect(hits.map((f) => f.matchId)).toEqual(["m1"]);
  });

  it("matches matchId for finished without teams", () => {
    expect(filterFixturePicks(fixtures, "m4", 20, "finished").map((f) => f.matchId)).toEqual(["m4"]);
  });

  it("respects limit 20 default for empty query", () => {
    const many: FixturePick[] = Array.from({ length: 30 }, (_, i) => ({
      matchId: `x${i}`,
      homeTeam: `H${i}`,
      awayTeam: `A${i}`,
      commenceTime: new Date(Date.UTC(2026, 6, i + 1)).toISOString(),
      status: "finished" as const,
    }));
    expect(filterFixturePicks(many, "", undefined, "finished")).toHaveLength(20);
  });
});

describe("finishedPicksFromResultRows", () => {
  it("dedupes by matchId and keeps score/teams", () => {
    const picks = finishedPicksFromResultRows([
      { matchId: "m1", homeTeam: "", awayTeam: "", score: "" },
      { matchId: "m1", homeTeam: "Arsenal", awayTeam: "Chelsea", score: "1-0" },
      { matchId: "m2", homeTeam: "A", awayTeam: "B" },
    ]);
    expect(picks).toHaveLength(2);
    const m1 = picks.find((p) => p.matchId === "m1")!;
    expect(m1.homeTeam).toBe("Arsenal");
    expect(m1.score).toBe("1-0");
    expect(m1.status).toBe("finished");
  });

  it("keeps matchId-only rows", () => {
    const picks = finishedPicksFromResultRows([{ matchId: "only-id" }]);
    expect(picks).toEqual([
      expect.objectContaining({ matchId: "only-id", homeTeam: "", awayTeam: "", status: "finished" }),
    ]);
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
