### Task 2: `buildMatchMarketDetails` 純函數

**Files:**
- Create: `src/matchDetails.ts`（LF 新檔）
- Test: `src/matchDetails.test.ts`（LF 新檔）

**Interfaces:**
- Consumes: `AnalysisRow`（`src/odds.ts:40-54`）、`Fixture`（`src/odds.ts:28-38`）、`HandicapCard`（`src/handicap.ts:24-44`）、`buildTotalsCards` return type、`displayStake`（`src/stakeDisplay.ts:17`）、`BuyMarket`（`src/buyOpportunities.ts:3`）。
- Produces（Task 3/4/6 用）：

```ts
export type MarketDetail =
  | { kind: "empty" }
  | { kind: "insufficient"; note: string }
  | { kind: "ok"; selection: string; odds: number; chance: number; implied: number; edge: number; stake: number; bookmaker: string };

export type MatchMarketDetails = { h2h: MarketDetail; totals: MarketDetail; corners: MarketDetail; handicap: MarketDetail };

export type MatchHeaderInfo = {
  matchId: string; homeTeam: string; awayTeam: string;
  homeTeamZh?: string; awayTeamZh?: string;
  commenceTime: string; league?: string; leagueZh?: string;
};

export function buildMatchMarketDetails(input: {
  matchId: string;
  fixtures: Fixture[];
  rows: AnalysisRow[];
  totalCards: TotalsCard[];
  cornerCards: TotalsCard[];
  handicapCards: HandicapCard[];
}): { header: MatchHeaderInfo | null; details: MatchMarketDetails };
```

行為規則：
- header：`fixtures` 搵 matchId → 冇就四種卡（handicap→totals→corners 次序唔重要，find 第一個 match）攞 metadata → 都冇 → `null`（頁面顯示「搵唔到呢場波」）。
- h2h：matchId 嘅 rows 冇 → `empty`；有 → 取 `edge` 最大嗰行，`chance = fairProbability`、`implied = 1 / odds`、`stake = suggestedStake`（用 analyzer 預算值，唔使 displayStake）。
- 卡市場：matchId 嘅卡冇 → `empty`；揀 `bestEdge` 最大嗰張；`bestChance <= 0` 或 `bestEdge` 唔 finite 或 `bestOdds <= 1` → `{ kind: "insufficient", note: card.pickLabel || "資料不足，唔買" }`；否則 `ok`，`selection = "<bestSide> <line>"`（line 整數轉 `.toFixed(1)`，同 PickCard `formatLine` 一致），`stake = displayStake(...)`。

- [ ] **Step 1: 寫失敗測試 `src/matchDetails.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { buildMatchMarketDetails } from "./matchDetails";
import type { AnalysisRow, Fixture } from "./odds";
import type { HandicapCard } from "./handicap";

const fixture: Fixture = {
  matchId: "m1", homeTeam: "Home FC", awayTeam: "Away FC",
  homeTeamZh: "主隊", awayTeamZh: "客隊",
  commenceTime: "2030-01-01T12:00:00.000Z", bookmakerCount: 2, league: "EPL", leagueZh: "英超",
};

function h2hRow(overrides: Partial<AnalysisRow> = {}): AnalysisRow {
  return {
    id: "r1", matchId: "m1", match: "Home FC vs Away FC", bookmaker: "Book A",
    outcome: "home", outcomeLabel: "主勝", odds: 2.0,
    fairProbability: 0.58, breakEvenProbability: 0.5, edge: 0.16,
    suggestedStake: 20, margin: 0.05, riskLabel: "可能有 value",
    ...overrides,
  };
}

function card(overrides: Partial<HandicapCard> = {}): HandicapCard {
  return {
    matchId: "m1", homeTeam: "Home FC", awayTeam: "Away FC",
    commenceTime: "2030-01-01T12:00:00.000Z", league: "EPL",
    line: 2.5, homeOdds: 1.95, awayOdds: 1.95, bookmakerCount: 3,
    bestChance: 0.58, bestEdge: 0.131, bestOdds: 1.95,
    pickLabel: "買 大", bestBookmaker: "Book B", bestSide: "大" as HandicapCard["bestSide"],
    hasHkjc: true,
    ...overrides,
  };
}

const base = { fixtures: [fixture], rows: [h2hRow()], totalCards: [], cornerCards: [], handicapCards: [] };

describe("buildMatchMarketDetails", () => {
  it("resolves header from fixtures with zh names and league", () => {
    const { header } = buildMatchMarketDetails({ matchId: "m1", ...base });
    expect(header).toMatchObject({ matchId: "m1", homeTeamZh: "主隊", awayTeamZh: "客隊", leagueZh: "英超" });
  });

  it("falls back to card metadata when fixture is gone (already kicked off)", () => {
    const { header } = buildMatchMarketDetails({ matchId: "m1", ...base, fixtures: [], handicapCards: [card()] });
    expect(header).toMatchObject({ matchId: "m1", homeTeam: "Home FC", awayTeam: "Away FC" });
  });

  it("returns null header when nothing knows the match", () => {
    const { header } = buildMatchMarketDetails({ matchId: "nope", ...base });
    expect(header).toBeNull();
  });

  it("builds h2h detail from the best-edge row", () => {
    const rows = [h2hRow(), h2hRow({ id: "r2", edge: 0.05, outcomeLabel: "客勝", odds: 3.0, fairProbability: 0.4 })];
    const { details } = buildMatchMarketDetails({ matchId: "m1", ...base, rows });
    expect(details.h2h).toEqual({
      kind: "ok", selection: "主勝", odds: 2.0,
      chance: 0.58, implied: 0.5, edge: 0.16, stake: 20, bookmaker: "Book A",
    });
  });

  it("marks markets without data as empty", () => {
    const { details } = buildMatchMarketDetails({ matchId: "m1", ...base });
    expect(details.totals).toEqual({ kind: "empty" });
    expect(details.corners).toEqual({ kind: "empty" });
    expect(details.handicap).toEqual({ kind: "empty" });
  });

  it("builds card market detail with displayStake and formatted line", () => {
    const { details } = buildMatchMarketDetails({ matchId: "m1", ...base, totalCards: [card()] });
    expect(details.totals).toMatchObject({
      kind: "ok", selection: "大 2.5", odds: 1.95,
      chance: 0.58, edge: 0.131, bookmaker: "Book B",
    });
    if (details.totals.kind === "ok") {
      expect(details.totals.implied).toBeCloseTo(1 / 1.95, 10);
      expect(details.totals.stake).toBe(20); // displayStake mirror: kelly(0.58,1.95)→cap 2% of 1000
    }
  });

  it("picks the best-edge line when a match has multiple lines", () => {
    const cards = [card({ line: 2.0, bestEdge: 0.02 }), card({ line: 3.0, bestEdge: 0.2 })];
    const { details } = buildMatchMarketDetails({ matchId: "m1", ...base, totalCards: cards });
    expect(details.totals).toMatchObject({ kind: "ok", selection: "大 3.0" });
  });

  it("marks single-bookmaker cards as insufficient", () => {
    const thin = card({ bookmakerCount: 1, bestChance: 0, bestEdge: Number.NEGATIVE_INFINITY, bestOdds: 0, pickLabel: "資料不足，唔買" });
    const { details } = buildMatchMarketDetails({ matchId: "m1", ...base, handicapCards: [thin] });
    expect(details.handicap).toEqual({ kind: "insufficient", note: "資料不足，唔買" });
  });

  it("h2h market is empty when no rows match", () => {
    const { details } = buildMatchMarketDetails({ matchId: "m1", ...base, rows: [h2hRow({ matchId: "other" })] });
    expect(details.h2h).toEqual({ kind: "empty" });
  });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `node node_modules/vitest/vitest.mjs run src/matchDetails.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 3: 實裝 `src/matchDetails.ts`**

```ts
import type { AnalysisRow, Fixture } from "./odds";
import type { HandicapCard } from "./handicap";
import type { buildTotalsCards } from "./oddsApi";
import type { BuyMarket } from "./buyOpportunities";
import { displayStake } from "./stakeDisplay";

export type TotalsCard = ReturnType<typeof buildTotalsCards>[number];

export type MarketDetail =
  | { kind: "empty" }
  | { kind: "insufficient"; note: string }
  | {
      kind: "ok";
      selection: string;
      odds: number;
      chance: number;
      implied: number;
      edge: number;
      stake: number;
      bookmaker: string;
    };

export type MatchMarketDetails = {
  h2h: MarketDetail;
  totals: MarketDetail;
  corners: MarketDetail;
  handicap: MarketDetail;
};

export type MatchHeaderInfo = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamZh?: string;
  awayTeamZh?: string;
  commenceTime: string;
  league?: string;
  leagueZh?: string;
};

export function buildMatchMarketDetails(input: {
  matchId: string;
  fixtures: Fixture[];
  rows: AnalysisRow[];
  totalCards: TotalsCard[];
  cornerCards: TotalsCard[];
  handicapCards: HandicapCard[];
}): { header: MatchHeaderInfo | null; details: MatchMarketDetails } {
  const { matchId } = input;
  return {
    header: resolveHeader(input),
    details: {
      h2h: h2hDetail(input.rows.filter((row) => row.matchId === matchId)),
      totals: cardDetail("大細波", bestCard(input.totalCards, matchId)),
      corners: cardDetail("角球", bestCard(input.cornerCards, matchId)),
      handicap: cardDetail("亞洲讓球", bestCard(input.handicapCards, matchId)),
    },
  };
}

function resolveHeader(input: {
  matchId: string;
  fixtures: Fixture[];
  totalCards: TotalsCard[];
  cornerCards: TotalsCard[];
  handicapCards: HandicapCard[];
}): MatchHeaderInfo | null {
  const fixture = input.fixtures.find((item) => item.matchId === input.matchId);
  if (fixture) return fixture;
  const card = [...input.handicapCards, ...input.totalCards, ...input.cornerCards].find((item) => item.matchId === input.matchId);
  return card ?? null;
}

function bestCard<T extends { matchId: string; bestEdge: number }>(cards: T[], matchId: string): T | null {
  const matches = cards.filter((card) => card.matchId === matchId);
  if (matches.length === 0) return null;
  return matches.reduce((best, card) => (card.bestEdge > best.bestEdge ? card : best));
}

function h2hDetail(rows: AnalysisRow[]): MarketDetail {
  if (rows.length === 0) return { kind: "empty" };
  const best = rows.reduce((top, row) => (row.edge > top.edge ? row : top));
  return {
    kind: "ok",
    selection: best.outcomeLabel,
    odds: best.odds,
    chance: best.fairProbability,
    implied: 1 / best.odds,
    edge: best.edge,
    stake: best.suggestedStake,
    bookmaker: best.bookmaker,
  };
}

function cardDetail(market: BuyMarket, card: TotalsCard | HandicapCard | null): MarketDetail {
  if (!card) return { kind: "empty" };
  if (!(card.bestChance > 0) || !Number.isFinite(card.bestEdge) || !(card.bestOdds > 1)) {
    return { kind: "insufficient", note: card.pickLabel || "資料不足，唔買" };
  }
  const selection = `${card.bestSide} ${formatLine(card.line)}`;
  return {
    kind: "ok",
    selection,
    odds: card.bestOdds,
    chance: card.bestChance,
    implied: 1 / card.bestOdds,
    edge: card.bestEdge,
    stake: displayStake({
      market,
      selection,
      line: card.line,
      odds: card.bestOdds,
      chance: card.bestChance,
      edge: card.bestEdge,
      bookmaker: card.bestBookmaker,
    }),
    bookmaker: card.bestBookmaker,
  };
}

function formatLine(line: number): string {
  return Number.isInteger(line) ? line.toFixed(1) : `${line}`;
}
```

注意：`resolveHeader` 入面 `fixture` / `card` 直接 return 做 `MatchHeaderInfo` — structural typing 下得（多餘欄位唔緊要，因為唔係 object literal）。

- [ ] **Step 4: 跑測試確認 pass**

Run: `node node_modules/vitest/vitest.mjs run src/matchDetails.test.ts`
Expected: PASS（9 tests）。如果 `stake` 斷言差少少，先手計 `displayStake({odds:1.95, chance:0.58})` 核實再改斷言，**唔准**改 `stakeDisplay.ts`。

- [ ] **Step 5: Commit**

```bash
git add src/matchDetails.ts src/matchDetails.test.ts
git commit -m "feat: buildMatchMarketDetails for single-match analysis"
```

---

