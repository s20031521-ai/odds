import { describe, expect, it, vi } from "vitest";
import {
  BUY_EDGE_THRESHOLD,
  selectBuyOpportunities,
  type BuyCandidate,
} from "./buyOpportunities";
import * as buyOpportunitiesModule from "./buyOpportunities";

const NOW = Date.parse("2026-07-16T12:00:00Z");

function candidate(overrides: Partial<BuyCandidate> = {}): BuyCandidate {
  return {
    matchId: "match-1",
    homeTeam: "Home",
    awayTeam: "Away",
    commenceTime: "2026-07-17T12:00:00Z",
    market: "主客和",
    selection: "主",
    odds: 2,
    chance: 0.55,
    edge: BUY_EDGE_THRESHOLD,
    bookmaker: "Book",
    ...overrides,
  };
}

function select(candidates: BuyCandidate[], dataFresh = true) {
  return selectBuyOpportunities(candidates, {
    now: NOW,
    edgeThreshold: BUY_EDGE_THRESHOLD,
    dataFresh,
  });
}

describe("selectBuyOpportunities", () => {
  it("includes edge exactly at 0.03 and excludes 0.029999", () => {
    const result = select([
      candidate({ matchId: "included", edge: 0.03 }),
      candidate({ matchId: "excluded", edge: 0.029999 }),
    ]);

    expect(result.map((opportunity) => opportunity.matchId)).toEqual(["included"]);
  });

  it("excludes candidates whose commence time is equal to or before now", () => {
    const result = select([
      candidate({ matchId: "past", commenceTime: "2026-07-16T11:59:59.999Z" }),
      candidate({ matchId: "equal", commenceTime: "2026-07-16T12:00:00Z" }),
      candidate({ matchId: "future", commenceTime: "2026-07-16T12:00:00.001Z" }),
    ]);

    expect(result.map((opportunity) => opportunity.matchId)).toEqual(["future"]);
  });

  it("returns no opportunities when data is stale", () => {
    expect(select([candidate()], false)).toEqual([]);
  });

  it("groups all markets by match and deterministically orders the primary and alternatives", () => {
    const result = select([
      candidate({ market: "大細波", selection: "細", line: undefined, edge: 0.07 }),
      candidate({ market: "角球", selection: "大", line: 9.5, edge: 0.07 }),
      candidate({ market: "主客和", selection: "主", bookmaker: "Zulu", edge: 0.07 }),
      candidate({ market: "大細波", selection: "大", line: 3.5, edge: 0.07 }),
      candidate({ market: "主客和", selection: "主", bookmaker: "Alpha", edge: 0.07 }),
      candidate({ market: "亞洲讓球", selection: "客", line: -0.5, edge: 0.08 }),
      candidate({ market: "大細波", selection: "細", line: 2.5, edge: 0.07 }),
      candidate({ market: "主客和", selection: "客", bookmaker: "Alpha", edge: 0.07 }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].primary).toMatchObject({ market: "亞洲讓球", selection: "客", edge: 0.08 });
    expect(result[0].alternatives.map(({ market, line, selection, bookmaker }) => ({
      market,
      line,
      selection,
      bookmaker,
    }))).toEqual([
      { market: "主客和", line: undefined, selection: "主", bookmaker: "Alpha" },
      { market: "大細波", line: 2.5, selection: "細", bookmaker: "Book" },
      { market: "大細波", line: 3.5, selection: "大", bookmaker: "Book" },
      { market: "大細波", line: undefined, selection: "細", bookmaker: "Book" },
      { market: "角球", line: 9.5, selection: "大", bookmaker: "Book" },
    ]);
  });

  it("sorts equal-edge opportunities by kickoff and then match id", () => {
    const result = select([
      candidate({ matchId: "b", commenceTime: "2026-07-18T12:00:00Z", edge: 0.05 }),
      candidate({ matchId: "later", commenceTime: "2026-07-19T12:00:00Z", edge: 0.05 }),
      candidate({ matchId: "early", commenceTime: "2026-07-17T12:00:00Z", edge: 0.05 }),
      candidate({ matchId: "a", commenceTime: "2026-07-18T12:00:00Z", edge: 0.05 }),
    ]);

    expect(result.map((opportunity) => opportunity.matchId)).toEqual(["early", "a", "b", "later"]);
  });

  it("deduplicates each market and line within a match using the deterministic best pick", () => {
    const result = select([
      candidate({ market: "大細波", line: 2.5, selection: "細", bookmaker: "Zulu", edge: 0.05 }),
      candidate({ market: "大細波", line: 2.5, selection: "大", bookmaker: "Beta", edge: 0.06 }),
      candidate({ market: "大細波", line: 2.5, selection: "大", bookmaker: "Alpha", edge: 0.06 }),
      candidate({ market: "大細波", line: 3.5, selection: "細", bookmaker: "Zulu", edge: 0.04 }),
      candidate({ market: "主客和", selection: "客隊", bookmaker: "Zulu", edge: 0.05 }),
      candidate({ market: "主客和", selection: "主隊", bookmaker: "Alpha", edge: 0.05 }),
    ]);

    expect([result[0].primary, ...result[0].alternatives]).toEqual([
      expect.objectContaining({ market: "大細波", line: 2.5, selection: "大", bookmaker: "Alpha", edge: 0.06 }),
      expect.objectContaining({ market: "主客和", selection: "主隊", bookmaker: "Alpha", edge: 0.05 }),
      expect.objectContaining({ market: "大細波", line: 3.5, selection: "細", bookmaker: "Zulu", edge: 0.04 }),
    ]);
  });

  it("threads league from candidates into opportunities, omitting it when missing", () => {
    const result = select([
      candidate({ matchId: "with-league", league: "English Premier League" }),
      candidate({ matchId: "without-league" }),
    ]);

    expect(result.find((opportunity) => opportunity.matchId === "with-league")?.league).toBe("English Premier League");
    expect(result.find((opportunity) => opportunity.matchId === "without-league")).not.toHaveProperty("league");
  });

  it("threads Chinese display names from candidates into opportunities, omitting them when missing", () => {
    const result = select([
      candidate({ matchId: "with-zh", homeTeamZh: "主隊", awayTeamZh: "客隊" }),
      candidate({ matchId: "without-zh" }),
    ]);

    const withZh = result.find((opportunity) => opportunity.matchId === "with-zh");
    expect(withZh?.homeTeam).toBe("Home");
    expect(withZh?.homeTeamZh).toBe("主隊");
    expect(withZh?.awayTeamZh).toBe("客隊");
    expect(result.find((opportunity) => opportunity.matchId === "without-zh")).not.toHaveProperty("homeTeamZh");
  });

  it("threads leagueZh from candidates into opportunities, omitting it when missing", () => {
    const result = select([
      candidate({ matchId: "with-zh-league", league: "English Premier League", leagueZh: "英格蘭超級聯賽" }),
      candidate({ matchId: "without-zh-league", league: "Liga MX" }),
    ]);

    const withZh = result.find((opportunity) => opportunity.matchId === "with-zh-league");
    expect(withZh?.league).toBe("English Premier League");
    expect(withZh?.leagueZh).toBe("英格蘭超級聯賽");
    expect(result.find((opportunity) => opportunity.matchId === "without-zh-league")).not.toHaveProperty("leagueZh");
  });

  it("excludes malformed candidates without throwing", () => {
    const invalidRows: BuyCandidate[] = [
      candidate({ matchId: "" }),
      candidate({ homeTeam: "  " }),
      candidate({ awayTeam: "\t" }),
      candidate({ selection: "" }),
      candidate({ bookmaker: "\n" }),
      candidate({ odds: 1 }),
      candidate({ odds: Number.NaN }),
      candidate({ odds: Number.POSITIVE_INFINITY }),
      candidate({ chance: 0 }),
      candidate({ chance: 1.000001 }),
      candidate({ chance: Number.NaN }),
      candidate({ edge: Number.NaN }),
      candidate({ edge: Number.POSITIVE_INFINITY }),
      candidate({ line: Number.NaN }),
      candidate({ line: Number.NEGATIVE_INFINITY }),
      candidate({ commenceTime: "not-a-date" }),
    ];

    expect(() => select(invalidRows)).not.toThrow();
    expect(select([...invalidRows, candidate({ matchId: "valid" })]).map(({ matchId }) => matchId)).toEqual(["valid"]);
  });

  it("does not mutate candidate arrays or objects", () => {
    const candidates = [
      candidate({ matchId: "b", edge: 0.04 }),
      candidate({ matchId: "a", edge: 0.06, market: "角球", line: 8.5 }),
    ];
    const before = structuredClone(candidates);

    select(candidates);

    expect(candidates).toEqual(before);
  });

  it("schedules the next candidate boundary and expires a pick without candidate changes", () => {
    const nextDelay = (buyOpportunitiesModule as {
      nextCandidateKickoffDelay?: (candidates: BuyCandidate[], now: number) => number | null;
    }).nextCandidateKickoffDelay;
    const candidates = [candidate({ commenceTime: "2026-07-16T12:00:01.000Z" })];

    expect(nextDelay).toBeTypeOf("function");
    if (!nextDelay) return;
    expect(selectBuyOpportunities(candidates, {
      now: NOW,
      edgeThreshold: BUY_EDGE_THRESHOLD,
      dataFresh: true,
    })).toHaveLength(1);

    const delay = nextDelay(candidates, NOW);
    expect(delay).toBe(1001);
    expect(selectBuyOpportunities(candidates, {
      now: NOW + delay!,
      edgeThreshold: BUY_EDGE_THRESHOLD,
      dataFresh: true,
    })).toEqual([]);
    expect(nextDelay(candidates, NOW + delay!)).toBeNull();
  });

  it("uses the candidate-change time when a new kickoff arrives after the selector clock aged", () => {
    const selectionRuntime = (buyOpportunitiesModule as {
      candidateSelectionRuntime?: (candidates: BuyCandidate[], now: number) => { now: number; nextDelay: number | null };
    }).candidateSelectionRuntime;

    vi.useFakeTimers();
    try {
      vi.setSystemTime(NOW);
      let selectionNow = Date.now();
      vi.advanceTimersByTime(4 * 60 * 1000);
      const candidates = [candidate({ commenceTime: "2026-07-16T12:05:00.000Z" })];

      expect(selectionRuntime).toBeTypeOf("function");
      if (!selectionRuntime) return;
      const runtime = selectionRuntime(candidates, Date.now());
      selectionNow = runtime.now;
      expect(selectionNow).toBe(Date.parse("2026-07-16T12:04:00.000Z"));
      expect(runtime.nextDelay).toBe(60_001);
      expect(selectBuyOpportunities(candidates, {
        now: selectionNow,
        edgeThreshold: BUY_EDGE_THRESHOLD,
        dataFresh: true,
      })).toHaveLength(1);

      setTimeout(() => { selectionNow = Date.now(); }, runtime.nextDelay!);
      vi.advanceTimersByTime(60_000);
      expect(selectBuyOpportunities(candidates, {
        now: selectionNow,
        edgeThreshold: BUY_EDGE_THRESHOLD,
        dataFresh: true,
      })).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(selectBuyOpportunities(candidates, {
        now: selectionNow,
        edgeThreshold: BUY_EDGE_THRESHOLD,
        dataFresh: true,
      })).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
