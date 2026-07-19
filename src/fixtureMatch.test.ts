import { describe, expect, it } from "vitest";
import { sameFixture } from "./fixtureMatch";

let fixtureSequence = 0;
const kickoff = Date.parse("2026-07-14T17:00:00Z");

function fixture(homeTeam: string, awayTeam: string, offsetMinutes = 0) {
  fixtureSequence += 1;
  return {
    matchId: `fixture-${fixtureSequence}`,
    homeTeam,
    awayTeam,
    commenceTime: new Date(kickoff + offsetMinutes * 60_000).toISOString(),
  };
}

describe("sameFixture", () => {
  it("does not match a team name that is only a substring of another", () => {
    expect(sameFixture(
      fixture("Manchester", "Liverpool"),
      fixture("Manchester United", "Liverpool"),
    )).toBe(false);
  });

  it("preserves women and men as distinct team identities", () => {
    expect(sameFixture(
      fixture("Arsenal Women", "Chelsea Women"),
      fixture("Arsenal", "Chelsea"),
    )).toBe(false);
  });

  it("matches accent and club-suffix aliases within kickoff tolerance", () => {
    expect(sameFixture(
      fixture("Djurgardens", "Halmstads"),
      fixture("Djurg\u00e5rdens IF", "Halmstads BK", 5),
    )).toBe(true);
  });

  it("matches dotted club-suffix acronyms", () => {
    expect(sameFixture(
      fixture("Djurg\u00e5rdens I.F.", "Halmstads B.K."),
      fixture("Djurgardens", "Halmstads"),
    )).toBe(true);
  });

  it("rejects otherwise identical fixtures outside kickoff tolerance", () => {
    expect(sameFixture(
      fixture("A", "B"),
      fixture("A", "B", 11),
    )).toBe(false);
  });

  it("recognizes a punctuated standalone W as the women marker", () => {
    expect(sameFixture(
      fixture("Arsenal W.", "Chelsea W."),
      fixture("Arsenal Women", "Chelsea Ladies"),
    )).toBe(true);
  });

  it("keeps a punctuated standalone W distinct from a men's team", () => {
    expect(sameFixture(
      fixture("Arsenal W.", "Chelsea W."),
      fixture("Arsenal", "Chelsea"),
    )).toBe(false);
  });

  it.each(["Women", "W.", "Ladies"])("matches literal 女足 to %s", (marker) => {
    expect(sameFixture(
      fixture("Arsenal 女足", "Chelsea 女足"),
      fixture(`Arsenal ${marker}`, `Chelsea ${marker}`),
    )).toBe(true);
  });

  it("keeps literal 女足 distinct from a men's team", () => {
    expect(sameFixture(
      fixture("Arsenal 女足", "Chelsea 女足"),
      fixture("Arsenal", "Chelsea"),
    )).toBe(false);
  });

  it("does not infer the women marker from a W inside another word", () => {
    expect(sameFixture(
      fixture("AFC Wimbledon", "West Brom"),
      fixture("AFC Wimbledon Women", "West Brom Women"),
    )).toBe(false);
  });

  it("fails closed for unknown aliases", () => {
    expect(sameFixture(
      fixture("Manchester Utd", "Liverpool"),
      fixture("Manchester United", "Liverpool"),
    )).toBe(false);
  });
});
