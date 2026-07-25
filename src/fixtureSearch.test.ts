import { describe, expect, it } from "vitest";
import {
  buildFinishedFixturePicks,
  filterFixturePicks,
  formatFixturePickLabel,
  fixturePickFromPrefill,
  normalizeCatalogResultRow,
  type FixturePick,
} from "./fixtureSearch";
import { expandTeamSearchTerms } from "./teamAliases";

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
    matchId: "kups-vps",
    homeTeam: "KuPS",
    awayTeam: "VPS Vaasa",
    homeTeamZh: "古比斯",
    awayTeamZh: "VPS華沙",
    commenceTime: "2026-07-25T14:00:00Z",
    status: "finished",
    score: "3-1",
    hasModel: false,
  },
  {
    matchId: "model-1",
    homeTeam: "Alpha",
    awayTeam: "Beta",
    commenceTime: "2026-07-25T10:00:00Z",
    status: "finished",
    score: "1-0",
    hasModel: true,
  },
  {
    matchId: "old-model",
    homeTeam: "Old",
    awayTeam: "Match",
    commenceTime: "2026-07-01T10:00:00Z",
    status: "finished",
    score: "0-0",
    hasModel: true,
  },
];

describe("formatFixturePickLabel", () => {
  it("shows bilingual zh / en when both present", () => {
    expect(formatFixturePickLabel(fixtures[1])).toBe("古比斯 / KuPS vs VPS華沙 / VPS Vaasa");
  });

  it("prefers zh-only pair when no separate en needed", () => {
    expect(formatFixturePickLabel(fixtures[0])).toBe("阿仙奴 / Arsenal vs 車路士 / Chelsea");
  });
});

describe("expandTeamSearchTerms", () => {
  it("maps 古比斯 to kups", () => {
    const terms = expandTeamSearchTerms("古比斯");
    expect(terms).toContain("古比斯");
    expect(terms).toContain("kups");
  });
});

describe("filterFixturePicks finished rules", () => {
  const now = new Date("2026-07-26T12:00:00Z");

  it("empty query: only hasModel within last 3 days", () => {
    const hits = filterFixturePicks(fixtures, "", { now, limit: 20 }, "finished");
    expect(hits.map((f) => f.matchId)).toEqual(["model-1"]);
  });

  it("search 古比斯 finds KuPS without hasModel", () => {
    const hits = filterFixturePicks(fixtures, "古比斯", { now, limit: 20 }, "finished");
    expect(hits.map((f) => f.matchId)).toEqual(["kups-vps"]);
  });

  it("search KuPS finds finished match", () => {
    const hits = filterFixturePicks(fixtures, "KuPS", { now, limit: 20 }, "finished");
    expect(hits.map((f) => f.matchId)).toEqual(["kups-vps"]);
  });
});

describe("buildFinishedFixturePicks", () => {
  it("marks hasModel from model match ids", () => {
    const picks = buildFinishedFixturePicks(
      [
        { matchId: "kups-vps", homeTeam: "KuPS", awayTeam: "VPS Vaasa", score: "3-1", commenceTime: "2026-07-25T14:00:00Z" },
        { matchId: "model-1", homeTeam: "Alpha", awayTeam: "Beta", score: "1-0" },
      ],
      ["model-1"],
    );
    expect(picks.find((p) => p.matchId === "kups-vps")?.hasModel).toBe(false);
    expect(picks.find((p) => p.matchId === "model-1")?.hasModel).toBe(true);
    expect(picks.find((p) => p.matchId === "kups-vps")?.homeTeamZh).toBe("古比斯");
  });
});

describe("normalizeCatalogResultRow", () => {
  it("parses results API shape", () => {
    const row = normalizeCatalogResultRow({
      matchId: "hkjc-50071288",
      homeTeam: "KuPS",
      awayTeam: "VPS Vaasa",
      score: "3-1",
      commenceTime: "2026-07-25T22:00:00.000+08:00",
      fixtureId: "d67eaa2b",
    });
    expect(row?.matchId).toBe("hkjc-50071288");
    expect(row?.homeTeam).toBe("KuPS");
  });
});

describe("fixturePickFromPrefill", () => {
  it("returns null when no match fields", () => {
    expect(fixturePickFromPrefill(undefined)).toBeNull();
  });

  it("enriches alias zh", () => {
    const pick = fixturePickFromPrefill({
      matchId: "x",
      homeTeam: "KuPS",
      awayTeam: "VPS Vaasa",
    });
    expect(pick?.homeTeamZh).toBe("古比斯");
  });
});
