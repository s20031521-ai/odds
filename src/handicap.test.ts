import { describe, expect, it } from "vitest";
import { buildHandicapCards, parseHandicapLine, settleAsianHandicap, type HandicapEntry } from "./handicap";

const entry = (overrides: Partial<HandicapEntry>): HandicapEntry => ({
  id: "hkjc-1",
  matchId: "hkjc-1",
  homeTeam: "曼城",
  awayTeam: "車路士",
  homeTeamEn: "Manchester City",
  awayTeamEn: "Chelsea",
  commenceTime: "2026-07-12T12:00:00Z",
  bookmaker: "HKJC",
  line: -0.75,
  homeOdds: 2.1,
  awayOdds: 1.72,
  ...overrides,
});

describe("HDC Asian handicap", () => {
  it("normalizes HKJC split lines", () => {
    expect(parseHandicapLine("-1.5/-2.0")).toBe(-1.75);
    expect(parseHandicapLine("0.0/+0.5")).toBe(0.25);
    expect(parseHandicapLine("bad")).toBeNull();
  });

  it("settles quarter lines", () => {
    expect(settleAsianHandicap("主", -0.75, 2, 1)).toBe("half-win");
    expect(settleAsianHandicap("主", -0.25, 1, 1)).toBe("half-loss");
    expect(settleAsianHandicap("客", -0.25, 1, 1)).toBe("half-win");
    expect(settleAsianHandicap("主", -1, 2, 1)).toBe("push");
    expect(settleAsianHandicap("主", -1, 1, 2)).toBe("loss");
  });

  it("buys the best external price without requiring HKJC", () => {
    const [card] = buildHandicapCards([
      entry({ id: "a", matchId: "event-1", bookmaker: "Book A", homeOdds: 2.2, awayOdds: 1.7 }),
      entry({ id: "b", matchId: "event-1", bookmaker: "Book B", homeOdds: 1.8, awayOdds: 2.05 }),
    ], 0.03);
    expect(card.matchId).toBe("event-1");
    expect(card.pickLabel).toBe("買 主");
    expect(card.bestBookmaker).toBe("Book A");
    expect(card.hasHkjc).toBe(false);
    expect(card.bookmakerCount).toBe(2);
  });

  it("includes matching HKJC in leave-one-out and marks the card", () => {
    const [card] = buildHandicapCards([
      entry({}),
      entry({ id: "odds-1", matchId: "event-1", bookmaker: "Book A", homeTeam: "Manchester City", awayTeam: "Chelsea", homeOdds: 1.8, awayOdds: 2.05 }),
      entry({ id: "odds-2", matchId: "event-1", bookmaker: "Book B", homeTeam: "Manchester City", awayTeam: "Chelsea", homeOdds: 1.82, awayOdds: 2.02 }),
      entry({ id: "wrong-line", matchId: "event-1", bookmaker: "Book C", homeTeam: "Manchester City", awayTeam: "Chelsea", line: -1, homeOdds: 5, awayOdds: 1.1 }),
    ], 0.03);
    expect(card.matchId).toBe("hkjc-1");
    expect(card.pickLabel).toBe("買 主");
    expect(card.bestBookmaker).toBe("HKJC");
    expect(card.hasHkjc).toBe(true);
    expect(card.bookmakerCount).toBe(3);
  });

  it("renders HKJC-only lines as honest market cards", () => {
    const cards = buildHandicapCards([entry({})], 0.03);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ matchId: "hkjc-1", bookmakerCount: 1, hasHkjc: true, pickLabel: "資料不足，唔買" });
  });

  it("carries the entry league onto the card, preferring the HKJC league, and omits it when missing", () => {
    const [hkjcCard] = buildHandicapCards([
      entry({ league: "香港超級聯賽" }),
      entry({ id: "odds-1", matchId: "event-1", bookmaker: "Book A", homeTeam: "Manchester City", awayTeam: "Chelsea", homeOdds: 1.8, awayOdds: 2.05, league: "EPL" }),
    ], 0.03);
    expect(hkjcCard.league).toBe("香港超級聯賽");

    const [externalCard] = buildHandicapCards([
      entry({ id: "a", matchId: "event-1", bookmaker: "Book A", homeOdds: 2.2, awayOdds: 1.7, league: "EPL" }),
      entry({ id: "b", matchId: "event-1", bookmaker: "Book B", homeOdds: 1.8, awayOdds: 2.05 }),
    ], 0.03);
    expect(externalCard.league).toBe("EPL");

    const [noLeagueCard] = buildHandicapCards([
      entry({ id: "a", matchId: "event-1", bookmaker: "Book A", homeOdds: 2.2, awayOdds: 1.7 }),
      entry({ id: "b", matchId: "event-1", bookmaker: "Book B", homeOdds: 1.8, awayOdds: 2.05 }),
    ], 0.03);
    expect(noLeagueCard).not.toHaveProperty("league");
  });

  it("carries Chinese display names onto the card from the canonical owner and omits them when missing", () => {
    const [hkjcCard] = buildHandicapCards([
      entry({ homeTeamZh: "曼城", awayTeamZh: "車路士" }),
      entry({ id: "odds-1", matchId: "event-1", bookmaker: "Book A", homeTeam: "Manchester City", awayTeam: "Chelsea", homeOdds: 1.8, awayOdds: 2.05 }),
    ], 0.03);
    expect(hkjcCard.homeTeam).toBe("曼城");
    expect(hkjcCard.homeTeamZh).toBe("曼城");
    expect(hkjcCard.awayTeamZh).toBe("車路士");

    const [noZhCard] = buildHandicapCards([
      entry({ id: "a", matchId: "event-1", bookmaker: "Book A", homeOdds: 2.2, awayOdds: 1.7 }),
      entry({ id: "b", matchId: "event-1", bookmaker: "Book B", homeOdds: 1.8, awayOdds: 2.05 }),
    ], 0.03);
    expect(noZhCard).not.toHaveProperty("homeTeamZh");
    expect(noZhCard).not.toHaveProperty("awayTeamZh");
  });

  it("carries leagueZh onto the card from the canonical owner and omits it when missing", () => {
    const [hkjcCard] = buildHandicapCards([
      entry({ league: "Hong Kong Premier League", leagueZh: "香港超級聯賽" }),
      entry({ id: "odds-1", matchId: "event-1", bookmaker: "Book A", homeTeam: "Manchester City", awayTeam: "Chelsea", homeOdds: 1.8, awayOdds: 2.05, league: "EPL" }),
    ], 0.03);
    expect(hkjcCard.league).toBe("Hong Kong Premier League");
    expect(hkjcCard.leagueZh).toBe("香港超級聯賽");

    const [noZhCard] = buildHandicapCards([
      entry({ id: "a", matchId: "event-1", bookmaker: "Book A", homeOdds: 2.2, awayOdds: 1.7, league: "EPL" }),
      entry({ id: "b", matchId: "event-1", bookmaker: "Book B", homeOdds: 1.8, awayOdds: 2.05, league: "EPL" }),
    ], 0.03);
    expect(noZhCard.league).toBe("EPL");
    expect(noZhCard).not.toHaveProperty("leagueZh");
  });

  it("does not compare different lines or a single bookmaker", () => {
    const cards = buildHandicapCards([
      entry({ id: "a", matchId: "event-1", bookmaker: "Book A" }),
      entry({ id: "b", matchId: "event-1", bookmaker: "Book B", line: -1 }),
    ], 0.03);
    expect(cards).toHaveLength(2);
    expect(cards.every((card) => card.pickLabel === "資料不足，唔買")).toBe(true);
  });
});
