import { describe, expect, it } from "vitest";
import { buildTotalsCards, parseOddsApiCorners, parseOddsApiEvents, parseOddsApiHandicaps, parseOddsApiTotals } from "./oddsApi";

describe("Odds API parser", () => {
  it("uses leave-one-out same-line consensus for totals", () => {
    const base = {
      matchId: "event-1", homeTeam: "Arsenal", awayTeam: "Chelsea",
      commenceTime: "2026-07-12T12:00:00Z", line: 2.5,
    };
    const [card] = buildTotalsCards([
      { ...base, id: "a", bookmaker: "Book A", overOdds: 2.2, underOdds: 1.7 },
      { ...base, id: "b", bookmaker: "Book B", overOdds: 1.8, underOdds: 2.05 },
    ], 0.03);
    expect(card.pickLabel).toBe("買大");
    expect(card.bestBookmaker).toBe("Book A");
    expect(card.bestSide).toBe("大");
  });

  it("does not turn a single-bookmaker totals line into a buy", () => {
    const [card] = buildTotalsCards([{
      id: "single",
      matchId: "event-1",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      commenceTime: "2026-07-12T12:00:00Z",
      bookmaker: "Book A",
      line: 2.5,
      overOdds: 2.2,
      underOdds: 1.7,
    }], 0.03);

    expect(card.bookmakerCount).toBe(1);
    expect(card.pickLabel).toBe("資料不足，唔買");
  });

  it("imports complete h2h bookmaker odds and skips incomplete bookmakers", () => {
    const entries = parseOddsApiEvents([
      {
        id: "event-1",
        home_team: "Arsenal",
        away_team: "Chelsea",
        commence_time: "2026-07-10T20:00:00Z",
        bookmakers: [
          {
            key: "book-a",
            title: "Book A",
            markets: [
              {
                key: "h2h",
                outcomes: [
                  { name: "Arsenal", price: 2.1 },
                  { name: "Draw", price: 3.4 },
                  { name: "Chelsea", price: 3.6 },
                ],
              },
            ],
          },
          {
            key: "book-b",
            title: "Book B",
            markets: [{ key: "h2h", outcomes: [{ name: "Arsenal", price: 2.2 }] }],
          },
        ],
      },
    ]);

    expect(entries).toEqual([
      {
        id: "event-1-book-a",
        matchId: "event-1",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        commenceTime: "2026-07-10T20:00:00Z",
        bookmaker: "Book A",
        odds: { home: 2.1, draw: 3.4, away: 3.6 },
      },
    ]);
  });

  it("returns no entries for non-array payloads", () => {
    expect(parseOddsApiEvents({})).toEqual([]);
  });

  it("skips malformed bookmaker shapes instead of throwing", () => {
    expect(
      parseOddsApiEvents([
        {
          id: "event-1",
          home_team: "Arsenal",
          away_team: "Chelsea",
          commence_time: "2026-07-10T20:00:00Z",
          bookmakers: [{ key: "bad", title: "Bad Book" }, null],
        },
      ]),
    ).toEqual([]);
  });

  it("skips malformed market and outcome shapes instead of throwing", () => {
    expect(
      parseOddsApiEvents([
        {
          id: "event-1",
          home_team: "Arsenal",
          away_team: "Chelsea",
          commence_time: "2026-07-10T20:00:00Z",
          bookmakers: [
            { key: "bad-market", title: "Bad Market", markets: [null] },
            {
              key: "bad-outcome",
              title: "Bad Outcome",
              markets: [{ key: "h2h", outcomes: [null, { name: null, price: 2.1 }] }],
            },
          ],
        },
      ]),
    ).toEqual([]);
  });

  it("imports spreads as home-perspective handicap lines", () => {
    expect(parseOddsApiHandicaps([{
      id: "event-1",
      home_team: "Arsenal",
      away_team: "Chelsea",
      commence_time: "2026-07-10T20:00:00Z",
      bookmakers: [{
        key: "book-a",
        title: "Book A",
        markets: [{ key: "spreads", outcomes: [
          { name: "Arsenal", price: 1.91, point: -0.75 },
          { name: "Chelsea", price: 1.95, point: 0.75 },
        ] }],
      }],
    }])).toEqual([{
      id: "event-1-book-a-hdc--0.75",
      matchId: "event-1",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      homeTeamEn: "Arsenal",
      awayTeamEn: "Chelsea",
      commenceTime: "2026-07-10T20:00:00Z",
      bookmaker: "Book A",
      line: -0.75,
      homeOdds: 1.91,
      awayOdds: 1.95,
    }]);
  });

  it("imports event-specific corner totals", () => {
    expect(parseOddsApiCorners({
      id: "event-1", home_team: "France", away_team: "Spain", commence_time: "2026-07-14T19:00:00Z",
      bookmakers: [{ key: "pinnacle", title: "Pinnacle", markets: [{ key: "alternate_totals_corners", outcomes: [
        { name: "Over", price: 1.91, point: 9.5 }, { name: "Under", price: 1.95, point: 9.5 },
      ] }]}],
    })).toEqual([expect.objectContaining({ id: "event-1-pinnacle-corners-9.5", line: 9.5, overOdds: 1.91, underOdds: 1.95 })]);
  });

  it("imports totals market odds by line", () => {
    const entries = parseOddsApiTotals([
      {
        id: "event-1",
        home_team: "Arsenal",
        away_team: "Chelsea",
        commence_time: "2026-07-10T20:00:00Z",
        bookmakers: [
          {
            key: "book-a",
            title: "Book A",
            markets: [
              {
                key: "totals",
                outcomes: [
                  { name: "Over", price: 1.91, point: 2.5 },
                  { name: "Under", price: 1.95, point: 2.5 },
                ],
              },
            ],
          },
        ],
      },
    ]);

    expect(entries).toEqual([
      {
        id: "event-1-book-a-totals-2.5",
        matchId: "event-1",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        commenceTime: "2026-07-10T20:00:00Z",
        bookmaker: "Book A",
        line: 2.5,
        overOdds: 1.91,
        underOdds: 1.95,
      },
    ]);
  });
});
