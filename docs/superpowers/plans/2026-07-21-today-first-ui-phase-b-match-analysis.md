# Today-first UI Phase B — 單場分析頁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 實裝 `#/analysis?match=<matchId>` 單場分析頁（四市場卡：模型機率 vs 莊家隱含機率、edge、Kelly stake、現時賠率），刪除舊「模型表現分析」頁內容，並將今日/賽程嘅「睇單場分析」入口改指新頁。

**Architecture:** 純前端、純 client-side 數據。新增純函數 `buildMatchMarketDetails`（按 matchId 由現成 memo 數據 — h2h `rows`、`totalCards`、`cornerCards`、`handicapCards` — 組裝四市場詳情），新頁 `MatchAnalysisPage` + `MarketDetailCard` 做展示；路由加 `analysisMatchIdFromHash` query parser。舊 analysis 頁 JSX/state/memo 直接刪除（owner 2026-07-21 決策：唔搬遷）。**冇新 API、冇 server/DB 改動。**

**Tech Stack:** Vite + React 19 + TypeScript、Vitest（SSR renderToStaticMarkup 斷言）、Playwright（4 viewports）。

**Spec:** `docs/superpowers/specs/2026-07-21-today-first-ui-redesign-design.md` §2.4、§4、§6（Phase B）

## Global Constraints

每個 task 都隱含以下約束（違反 = review reject）：

- **模型檔永久唔准改**：`src/odds.ts`、`totals.ts`、`asianTotals.ts`、`corners.ts`、`handicap.ts`、`buyCandidates.ts`、`buyOpportunities.ts`、`marketCalibration.ts`、`picks.ts`、`fixtureMatch.ts`、`marketDisplay.ts`、`oddsApi.ts`。唔准調 weights / Kelly / ROI 定義 / 3% edge threshold。
- **`src/pages/BuyDashboard.tsx` + `BuyDashboard.test.tsx` 永久唔准改**（pro dashboard 嘅 `#/fixtures/<id>` link 保持不變，屬預期）。
- **唔准新加 API / server / DB 改動。**
- className **只加唔改名**；新樣式只用 `src/styles/tokens.css` 嘅 CSS variables；`--touch-target` 44px、grid 列數、nav breakpoints 唔變；mascot 重用 `<Mascot>` 現有 poses，唔加新素材。
- 刪舊 analysis 頁時，`marketDisplay.ts` 入面變 dead 嘅 export（`calibrationBuckets` / `currentModelRows` / `predictionDistribution` / `summarizePerformanceRows`）**保留唔刪**（模型檔），佢哋嘅測試都保留 — cleanup 留返 Phase C。
- **CRLF 警示**：`src/App.tsx`、`src/route.ts`、`src/route.test.ts`、`src/App.test.tsx`、`src/components/*.tsx`、`src/pages/*.tsx`、`src/stakeDisplay.ts`、`src/main.tsx` 係純 CRLF；`src/odds.ts` / `src/odds.test.ts` 係混合。Edit 工具會自動處理純 CRLF 檔（用 LF 寫 old_string 即可）；**新開檔案**（`src/matchDetails.ts` 等）用 LF 跟模型檔慣例，新開 `.tsx` / test `.tsx` 用 CRLF 跟 components 慣例都得（git 會 normalize，唔使強求，但唔好將現有檔整成全檔行尾 diff）。
- **Windows Git Bash 冇 npm/npx**：
  - Vitest：`node node_modules/vitest/vitest.mjs run`（可加 test 檔路徑過濾）
  - tsc：`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
  - build：`node node_modules/vite/bin/vite.js build`
  - Playwright：`npm.cmd run test:ui:only`（**要先 build**，webServer serve `dist/`）
- **Locked test 字串**（改 source 必要同步改測試，否則即紅）：
  - `src/components/PickCard.test.tsx:52` `'href="#/fixtures/match-1"'`、`:71` `'href="#/fixtures/match%201"'`
  - `src/App.test.tsx:44` 逐字斷言 `{page === "analysis" ? <h1 className="page-heading">模型表現分析</h1> : null}`
  - `tests/ui/dashboard.spec.ts:66-68` click `a[href="#/fixtures/match-value"]` + URL + `.fixture-detail` 斷言
- Playwright `mockApi` 要顯式傳 `dashboardMode`（helpers.ts addInitScript 模式）；預設 `"pro"`。
- TDD：每 task 先寫失敗測試 → 實裝 → 綠 → commit。
- Commit message 用 `feat:` / `test:` / `refactor:` 前綴，同 master 慣例一致。

## 背景資料（探索已確認，implementer 唔使再搵）

- `src/route.ts`（23 行）：`pageFromHash` 用 `startsWith("analysis")`，所以 `#/analysis?match=x` **已經** route 去 `"analysis"` page；`fixtureIdFromHash` 只識 `fixtures|dashboard/<id>`；**冇 query parser**，要新加。
- 數據源（全部喺 `src/App.tsx` 現成 memo，唔使自己 call 模型）：
  - 主客和：`rows`（`analyzeEntries(entries, settings)`，App.tsx:231）→ `AnalysisRow`（`src/odds.ts:40-54`）：`outcomeLabel`、`odds`、`fairProbability`（模型機率）、`breakEvenProbability`、`edge`、`suggestedStake`、`bookmaker`。
  - 大細/角球：`totalCards` / `cornerCards`（`buildTotalsCards`，App.tsx:236-240）→ card 有 `line`、`bestSide`（`"大"|"細"|null`）、`bestChance`、`bestEdge`、`bestOdds`、`bestBookmaker`、`pickLabel`、`bookmakerCount`。
  - 亞洲讓球：`handicapCards`（`buildHandicapCards`，App.tsx:241）→ `HandicapCard`（`src/handicap.ts:24-44`），`bestSide: "主"|"客"`。
  - **冇 stake 欄位**嘅三個卡市場用 `displayStake`（`src/stakeDisplay.ts:17-22`，display-only mirror，預設 1000/0.25/0.02）。
  - `bookmakerCount < 2` 嘅卡：`bestChance = 0`、`bestEdge = -Infinity`、`pickLabel = "資料不足，唔買"`（`handicap.ts:85`）→ 呢種顯示 insufficient 狀態。
  - header 資料：`fixtures`（`upcomingFixtures`，只包未開賽）→ fallback 用四種卡嘅 metadata。
- 舊 analysis 頁要刪嘅嘢（`src/App.tsx`）：heading（467）、成段 section（510-593）、memo（265-273、275-276）、`readiness` state（122）、`ModelReadiness` type（73-100）、`analysisMarket` state（132）、`PerformanceBar`（707-715）、`Stat`（805-812，已無人用）、import 精簡（17 行嘅 `calibrationBuckets`/`currentModelRows`/`predictionDistribution`/`summarizePerformanceRows`）。
- **唔刪**：`loadBacktest`（history 頁用）、`snapshotQuality`/`qualityWarning`（history 頁 653 用）、`FixtureDetail`（pro dashboard `#/fixtures/<id>` deep link 仲用）、`tabForRouteTransition`（fixtures deep link 用）。
- 路徑備忘：Phase A 元件實際喺 `src/pages/` 同 `src/components/`（**唔係** spec 寫嘅 `src/today/` / `src/match/`）；新檔跟呢個 pattern。`stakeDisplay.ts` 喺 `src/`（唔係 `src/utils/`）。
- Playwright mock（`tests/ui/helpers.ts`）：`match-value`（Value United vs Signal City）有 h2h 兩莊 + 大細兩莊；**冇角球、冇亞洲讓球數據** → e2e 可以斷言兩個「呢個市場冇盤」。

---

### Task 1: `analysisMatchIdFromHash` 路由 parser

**Files:**
- Modify: `src/route.ts`
- Test: `src/route.test.ts`

**Interfaces:**
- Produces: `analysisMatchIdFromHash(hash: string): string | null` — 由 `#/analysis?match=<id>` 攞 URL-decode 後嘅 matchId；非 analysis hash 或冇 match param → `null`。Task 6 嘅 App.tsx wiring 用呢個。

- [ ] **Step 1: 寫失敗測試**

喺 `src/route.test.ts` 尾加（import 行加 `analysisMatchIdFromHash`）：

```ts
  it("parses analysis match query param", () => {
    expect(analysisMatchIdFromHash("#/analysis?match=match-1")).toBe("match-1");
    expect(analysisMatchIdFromHash("#/analysis?match=match%201")).toBe("match 1");
  });

  it("returns null when analysis hash has no match param", () => {
    expect(analysisMatchIdFromHash("#/analysis")).toBeNull();
    expect(analysisMatchIdFromHash("#/analysis?foo=1")).toBeNull();
    expect(analysisMatchIdFromHash("#/analysis?match=")).toBeNull();
  });

  it("ignores match param on non-analysis routes", () => {
    expect(analysisMatchIdFromHash("#/today")).toBeNull();
    expect(analysisMatchIdFromHash("#/fixtures/match-1?match=match-2")).toBeNull();
  });
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `node node_modules/vitest/vitest.mjs run src/route.test.ts`
Expected: FAIL（`analysisMatchIdFromHash is not a function` / not exported）

- [ ] **Step 3: 實裝**

喺 `src/route.ts` `fixtureIdFromHash` 之後加：

```ts
export function analysisMatchIdFromHash(hash: string): string | null {
  const value = cleanHash(hash);
  const questionIndex = value.indexOf("?");
  if (questionIndex < 0 || value.slice(0, questionIndex) !== "analysis") return null;
  const match = new URLSearchParams(value.slice(questionIndex + 1)).get("match");
  return match ? match : null;
}
```

- [ ] **Step 4: 跑測試確認 pass**

Run: `node node_modules/vitest/vitest.mjs run src/route.test.ts`
Expected: PASS（7 tests，舊 4 個唔准碎）

- [ ] **Step 5: Commit**

```bash
git add src/route.ts src/route.test.ts
git commit -m "feat: parse analysis match query param"
```

---

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

### Task 3: `MarketDetailCard` 元件 + `match.css`

**Files:**
- Create: `src/components/MarketDetailCard.tsx`
- Test: `src/components/MarketDetailCard.test.tsx`
- Create: `src/styles/match.css`
- Modify: `src/main.tsx`（加一行 import，`src/main.tsx:9` `import "./styles/today.css";` 之後）

**Interfaces:**
- Consumes: `MarketDetail`（Task 2）。
- Produces: `MarketDetailCard(props: { market: string; detail: MarketDetail }): React.ReactElement` — Task 4 用。CSS class：`market-detail-card`、`market-detail-card--empty`、`market-detail-card__selection`、`market-detail-card__odds`、`market-detail-card__bookmaker`（Task 4 嘅 grid 用 `market-detail-grid`）。

- [ ] **Step 1: 寫失敗測試 `src/components/MarketDetailCard.test.tsx`**（跟 PickCard.test.tsx 嘅 SSR pattern： `renderToStaticMarkup` + `toContain`）

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarketDetailCard } from "./MarketDetailCard";

describe("MarketDetailCard", () => {
  it("shows model vs bookie probabilities, edge, stake and odds", () => {
    const markup = renderToStaticMarkup(
      <MarketDetailCard market="主客和" detail={{
        kind: "ok", selection: "主勝", odds: 2.0,
        chance: 0.58, implied: 0.5, edge: 0.16, stake: 20, bookmaker: "Book A",
      }} />,
    );
    expect(markup).toContain("主客和");
    expect(markup).toContain("買：主勝");
    expect(markup).toContain("模型估 58.0%，莊家開 50.0%");
    expect(markup).toContain("Edge +16.0%");
    expect(markup).toContain("建議注碼 $20");
    expect(markup).toContain("2.00");
    expect(markup).toContain("Book A");
  });

  it("shows negative edge without double sign", () => {
    const markup = renderToStaticMarkup(
      <MarketDetailCard market="大細波" detail={{
        kind: "ok", selection: "大 2.5", odds: 1.9,
        chance: 0.5, implied: 1 / 1.9, edge: -0.05, stake: 0, bookmaker: "Book B",
      }} />,
    );
    expect(markup).toContain("Edge -5.0%");
  });

  it("shows empty state when the market has no data", () => {
    const markup = renderToStaticMarkup(<MarketDetailCard market="角球" detail={{ kind: "empty" }} />);
    expect(markup).toContain("角球");
    expect(markup).toContain("呢個市場冇盤");
  });

  it("shows the insufficient note for single-bookmaker markets", () => {
    const markup = renderToStaticMarkup(
      <MarketDetailCard market="亞洲讓球" detail={{ kind: "insufficient", note: "資料不足，唔買" }} />,
    );
    expect(markup).toContain("資料不足，唔買");
  });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `node node_modules/vitest/vitest.mjs run src/components/MarketDetailCard.test.tsx`
Expected: FAIL（module not found）

- [ ] **Step 3: 實裝 `src/components/MarketDetailCard.tsx`**

```tsx
import type { MarketDetail } from "../matchDetails";

export function MarketDetailCard(props: { market: string; detail: MarketDetail }): React.ReactElement {
  const { market, detail } = props;
  if (detail.kind === "empty") {
    return (
      <article className="market-detail-card market-detail-card--empty">
        <h3>{market}</h3>
        <p>呢個市場冇盤</p>
      </article>
    );
  }
  if (detail.kind === "insufficient") {
    return (
      <article className="market-detail-card market-detail-card--empty">
        <h3>{market}</h3>
        <p>{detail.note}</p>
      </article>
    );
  }
  return (
    <article className="market-detail-card">
      <h3>{market}</h3>
      <p className="market-detail-card__selection">買：{detail.selection}</p>
      <p className="market-detail-card__odds">
        {formatOdds(detail.odds)}
        <span className="market-detail-card__bookmaker">（{detail.bookmaker}）</span>
      </p>
      <p>模型估 {formatPercent(detail.chance)}，莊家開 {formatPercent(detail.implied)}</p>
      <p>Edge {detail.edge >= 0 ? "+" : ""}{formatPercent(detail.edge)}</p>
      <p>建議注碼 ${detail.stake}</p>
    </article>
  );
}

function formatPercent(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
}

function formatOdds(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "—";
}
```

- [ ] **Step 4: 寫 `src/styles/match.css` 同 import**

`src/styles/match.css`（只用 tokens.css variables；具體 variable 名以 `src/styles/tokens.css` 同 `src/styles/today.css` 為準，implementer 先讀 today.css 跟佢嘅命名）：

```css
.market-detail-grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: 1fr;
}

@media (min-width: 720px) {
  .market-detail-grid {
    grid-template-columns: 1fr 1fr;
  }
}

.market-detail-card {
  /* 跟 today.css 嘅卡面 style（背景/border/radius/padding 用 tokens） */
}

.market-detail-card--empty {
  /* 同卡面，文字 muted */
}
```

（卡面視覺以 `today.css` 嘅 `.pick-card` 為模板，唔好發明新色系。）

`src/main.tsx` 喺 `import "./styles/today.css";` 後加：

```ts
import "./styles/match.css";
```

- [ ] **Step 5: 跑測試確認 pass + tsc**

Run: `node node_modules/vitest/vitest.mjs run src/components/MarketDetailCard.test.tsx`
Expected: PASS（4 tests）
Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
Expected: 冇新 error

- [ ] **Step 6: Commit**

```bash
git add src/components/MarketDetailCard.tsx src/components/MarketDetailCard.test.tsx src/styles/match.css src/main.tsx
git commit -m "feat: MarketDetailCard component with match styles"
```

---

### Task 4: `MatchAnalysisPage`

**Files:**
- Create: `src/pages/MatchAnalysisPage.tsx`
- Test: `src/pages/MatchAnalysisPage.test.tsx`
- Modify: `src/styles/match.css`（加頁面級樣式）

**Interfaces:**
- Consumes: `MatchHeaderInfo` / `MatchMarketDetails`（Task 2）、`MarketDetailCard`（Task 3）、`BuyOpportunity`（`src/buyOpportunities.ts:26-37`）、`formatKickoff`（`src/components/PickCard.tsx:59`）、`TeamLogo` / `TeamLogoMap`、`Mascot`（`src/components/Kawaii.tsx`，pose `"chiikawa-empty"`）。
- Produces: `MatchAnalysisPage(props)` — Task 6 App.tsx 用：

```ts
export function MatchAnalysisPage(props: {
  matchId: string | null;
  header: MatchHeaderInfo | null;
  details: MatchMarketDetails | null;
  opportunities: BuyOpportunity[];
  logos: TeamLogoMap;
  generatedAt: string | null;
}): React.ReactElement;
```

行為規則（spec §2.4）：
1. `matchId === null`（裸 `#/analysis`）→ picker：Mascot `chiikawa-empty` + 「由今日或賽程揀一場波」+ 今日有貨場次快捷入口（`opportunities` dedupe by matchId，每個 link `#/analysis?match=<encoded>`，顯示「主 vs 客 · 開賽時間」）。
2. `matchId` 有但 `header`/`details` null → 「搵唔到呢場波 — 可能已開賽或已下架」+ link `#/analysis`「揀返另一場 →」。
3. 齊料 → header（logo + 主 vs 客 + logo、`formatKickoff(commenceTime)`、聯賽、「轉場」link 指 `#/analysis`）→ 四張 `MarketDetailCard`（主客和 / 大細波 / 角球 / 亞洲讓球，次序固定）→ 尾行「賠率同步於 {generatedAt ?? "未有成功同步"}」。

- [ ] **Step 1: 寫失敗測試 `src/pages/MatchAnalysisPage.test.tsx`**

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatchAnalysisPage } from "./MatchAnalysisPage";
import type { MatchHeaderInfo, MatchMarketDetails } from "../matchDetails";
import type { BuyOpportunity } from "../buyOpportunities";

const header: MatchHeaderInfo = {
  matchId: "m1", homeTeam: "Home FC", awayTeam: "Away FC",
  homeTeamZh: "主隊", awayTeamZh: "客隊",
  commenceTime: "2030-01-01T20:00:00.000Z", league: "EPL", leagueZh: "英超",
};

const details: MatchMarketDetails = {
  h2h: { kind: "ok", selection: "主勝", odds: 2.0, chance: 0.58, implied: 0.5, edge: 0.16, stake: 20, bookmaker: "Book A" },
  totals: { kind: "empty" },
  corners: { kind: "insufficient", note: "資料不足，唔買" },
  handicap: { kind: "empty" },
};

function opportunity(matchId: string): BuyOpportunity {
  return {
    matchId, homeTeam: "Home FC", awayTeam: "Away FC",
    homeTeamZh: "主隊", awayTeamZh: "客隊",
    commenceTime: "2030-01-01T20:00:00.000Z",
    primary: { market: "主客和", selection: "主勝", odds: 2.0, chance: 0.58, edge: 0.16, bookmaker: "Book A" },
    alternatives: [],
  };
}

const base = { matchId: "m1", header, details, opportunities: [] as BuyOpportunity[], logos: {}, generatedAt: "2026-07-21T09:00:00.000Z" };

describe("MatchAnalysisPage", () => {
  it("renders header, four market cards and sync timestamp", () => {
    const markup = renderToStaticMarkup(<MatchAnalysisPage {...base} />);
    expect(markup).toContain("主隊 vs 客隊");
    expect(markup).toContain("英超");
    expect(markup).toContain("轉場");
    expect(markup).toContain('href="#/analysis"');
    expect(markup).toContain("模型估 58.0%，莊家開 50.0%");
    expect(markup).toContain("呢個市場冇盤");
    expect(markup).toContain("資料不足，唔買");
    expect(markup).toContain("賠率同步於 2026-07-21T09:00:00.000Z");
  });

  it("shows picker with quick links when no match selected", () => {
    const markup = renderToStaticMarkup(
      <MatchAnalysisPage {...base} matchId={null} header={null} details={null} opportunities={[opportunity("m1"), opportunity("m1"), opportunity("m2")]} />,
    );
    expect(markup).toContain("由今日或賽程揀一場波");
    expect(markup).toContain('href="#/analysis?match=m1"');
    expect(markup).toContain('href="#/analysis?match=m2"');
    // dedupe：m1 只出一次
    expect(markup.match(/#\/analysis\?match=m1/g)?.length).toBe(1);
  });

  it("shows not-found state for unknown match", () => {
    const markup = renderToStaticMarkup(<MatchAnalysisPage {...base} matchId="ghost" header={null} details={null} />);
    expect(markup).toContain("搵唔到呢場波");
    expect(markup).toContain('href="#/analysis"');
  });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `node node_modules/vitest/vitest.mjs run src/pages/MatchAnalysisPage.test.tsx`
Expected: FAIL（module not found）

- [ ] **Step 3: 實裝 `src/pages/MatchAnalysisPage.tsx`**

```tsx
import type { BuyOpportunity } from "../buyOpportunities";
import { Mascot } from "../components/Kawaii";
import { MarketDetailCard } from "../components/MarketDetailCard";
import { formatKickoff } from "../components/PickCard";
import { TeamLogo, type TeamLogoMap } from "../components/TeamLogo";
import type { MatchHeaderInfo, MatchMarketDetails } from "../matchDetails";

const MARKETS: Array<{ key: keyof MatchMarketDetails; label: string }> = [
  { key: "h2h", label: "主客和" },
  { key: "totals", label: "大細波" },
  { key: "corners", label: "角球" },
  { key: "handicap", label: "亞洲讓球" },
];

export function MatchAnalysisPage(props: {
  matchId: string | null;
  header: MatchHeaderInfo | null;
  details: MatchMarketDetails | null;
  opportunities: BuyOpportunity[];
  logos: TeamLogoMap;
  generatedAt: string | null;
}): React.ReactElement {
  if (!props.matchId) {
    const matches = uniqueMatches(props.opportunities);
    return (
      <section className="match-analysis">
        <div className="today-empty" role="status">
          <Mascot pose="chiikawa-empty" />
          <p>由今日或賽程揀一場波</p>
        </div>
        {matches.length > 0 ? (
          <ul className="match-analysis__picker">
            {matches.map((match) => (
              <li key={match.matchId}>
                <a href={`#/analysis?match=${encodeURIComponent(match.matchId)}`}>
                  {match.homeTeamZh ?? match.homeTeam} vs {match.awayTeamZh ?? match.awayTeam} · {formatKickoff(match.commenceTime)}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    );
  }

  const { header, details } = props;
  if (!header || !details) {
    return (
      <section className="match-analysis">
        <div className="today-empty" role="status">
          <Mascot pose="chiikawa-empty" />
          <p>搵唔到呢場波 — 可能已開賽或已下架</p>
        </div>
        <p className="match-analysis__back"><a href="#/analysis">揀返另一場 →</a></p>
      </section>
    );
  }

  return (
    <section className="match-analysis">
      <header className="match-analysis__header">
        <h1 className="page-heading">
          <TeamLogo teamName={header.homeTeam} logos={props.logos} />
          {header.homeTeamZh ?? header.homeTeam} vs {header.awayTeamZh ?? header.awayTeam}
          <TeamLogo teamName={header.awayTeam} logos={props.logos} />
        </h1>
        <p className="match-analysis__meta">
          {formatKickoff(header.commenceTime)}
          {header.leagueZh ?? header.league ? ` · ${header.leagueZh ?? header.league}` : ""}
          {" · "}
          <a href="#/analysis">轉場</a>
        </p>
      </header>
      <div className="market-detail-grid">
        {MARKETS.map(({ key, label }) => (
          <MarketDetailCard key={key} market={label} detail={details[key]} />
        ))}
      </div>
      <p className="match-analysis__sync">賠率同步於 {props.generatedAt ?? "未有成功同步"}</p>
    </section>
  );
}

function uniqueMatches(opportunities: BuyOpportunity[]): Array<Pick<BuyOpportunity, "matchId" | "homeTeam" | "awayTeam" | "homeTeamZh" | "awayTeamZh" | "commenceTime">> {
  const seen = new Set<string>();
  const matches: Array<Pick<BuyOpportunity, "matchId" | "homeTeam" | "awayTeam" | "homeTeamZh" | "awayTeamZh" | "commenceTime">> = [];
  for (const opportunity of opportunities) {
    if (seen.has(opportunity.matchId)) continue;
    seen.add(opportunity.matchId);
    matches.push(opportunity);
  }
  return matches;
}
```

- [ ] **Step 4: `src/styles/match.css` 加頁面級樣式**

```css
.match-analysis__header .page-heading {
  /* 跟 today.css heading 風格 */
}

.match-analysis__meta {
  /* muted 細字 */
}

.match-analysis__picker {
  list-style: none;
  /* 每個 link 做 card-like 大行，min-height 跟 --touch-target: 44px */
}

.match-analysis__picker a {
  display: block;
  min-height: var(--touch-target);
}

.match-analysis__sync,
.match-analysis__back {
  /* muted 細字，置中跟 today.css 嘅 footer 風格 */
}
```

- [ ] **Step 5: 跑測試確認 pass**

Run: `node node_modules/vitest/vitest.mjs run src/pages/MatchAnalysisPage.test.tsx`
Expected: PASS（3 tests）。注意 `formatKickoff` 輸出受機器 timezone 影響，測試冇斷言具體時間字串係特意的 — 唔好加。

- [ ] **Step 6: Commit**

```bash
git add src/pages/MatchAnalysisPage.tsx src/pages/MatchAnalysisPage.test.tsx src/styles/match.css
git commit -m "feat: MatchAnalysisPage with picker and not-found states"
```

---

### Task 5: PickCard「睇單場分析」改指新頁

**Files:**
- Modify: `src/components/PickCard.tsx:43`
- Test: `src/components/PickCard.test.tsx:52,71`（同步改 locked 字串）

**Interfaces:**
- Consumes: Task 1 嘅 route convention（`#/analysis?match=<encoded>`）。

- [ ] **Step 1: 先改測試（RED）**

`src/components/PickCard.test.tsx:52` 改做：

```ts
    expect(markup).toContain('href="#/analysis?match=match-1"');
```

`:71` 改做：

```ts
    expect(markup).toContain('href="#/analysis?match=match%201"');
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `node node_modules/vitest/vitest.mjs run src/components/PickCard.test.tsx`
Expected: FAIL（兩條 href 斷言）

- [ ] **Step 3: 改 `src/components/PickCard.tsx:43`**

```tsx
        <a className="pick-card__analysis-link" href={`#/analysis?match=${encodeURIComponent(opportunity.matchId)}`}>
```

- [ ] **Step 4: 跑測試確認 pass**

Run: `node node_modules/vitest/vitest.mjs run src/components/PickCard.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/PickCard.tsx src/components/PickCard.test.tsx
git commit -m "feat: point pick card analysis link at match analysis page"
```

---

### Task 6: App.tsx — 接新頁 + 刪舊「模型表現分析」

**Files:**
- Modify: `src/App.tsx`（多處，見步驟）
- Test: `src/App.test.tsx:44`（同步改 locked 字串）

**Interfaces:**
- Consumes: Task 1 `analysisMatchIdFromHash`、Task 2 `buildMatchMarketDetails`、Task 4 `MatchAnalysisPage`。
- Produces: `page === "analysis"` 時 render `MatchAnalysisPage`；舊分析頁 code 全部移除。

⚠️ 呢個 task 改動多，**每一步改完即刻跑 tsc** 會易捉漏。全部改完先一次過跑 Vitest。

- [ ] **Step 1: 先改 `src/App.test.tsx`（RED 方向：斷言新 wiring）**

`src/App.test.tsx:44` 舊斷言：

```ts
expect(source).toContain('{page === "analysis" ? <h1 className="page-heading">模型表現分析</h1> : null}');
```

改做斷言新頁 wiring（逐字，同 Step 3 嘅 JSX 對齊）：

```ts
expect(source).toContain('<MatchAnalysisPage');
expect(source).toContain('matchId={analysisMatchId}');
```

- [ ] **Step 2: 跑 `src/App.test.tsx` 確認 fail**

Run: `node node_modules/vitest/vitest.mjs run src/App.test.tsx`
Expected: FAIL（新斷言未成立）

- [ ] **Step 3: 改 `src/App.tsx`（逐項，行號以 v1.1.0 master 為準）**

1. **Import（line 17）**：由 `./marketDisplay` import 刪走 `calibrationBuckets`、`currentModelRows`、`predictionDistribution`、`summarizePerformanceRows`（保留 `clearBacktestResponseState, cornerPickLabel, excludeLegacyRows, filterHistoryRows, groupMarketCards, hasPredictionSnapshot, isSnapshotQuality, snapshotQualityMessage, summarizeHistoryRows, type SnapshotQuality`）。
2. **Import（line 19）**：`from "./route"` 加 `analysisMatchIdFromHash`。
3. **新 import**（跟其他 page import 放埋一齊）：
   ```ts
   import { MatchAnalysisPage } from "./pages/MatchAnalysisPage";
   import { buildMatchMarketDetails } from "./matchDetails";
   ```
4. **刪 `ModelReadiness` type（73-100）**。
5. **刪 state**：`readiness`（122）、`analysisMarket`（132）。
6. **加 state**（喺 line 148 `fixtureId` 之後）：
   ```ts
   const [analysisMatchId, setAnalysisMatchId] = useState(() => analysisMatchIdFromHash(window.location.hash));
   ```
7. **`clearAuthenticatedState`（210）**：刪 `setReadiness([]);`。
8. **刪 memo（265-273、275-276）**：`analysisRows`、`currentAnalysisRows`、`marketSummaries`、`modelSummaries`、`directionSummaries`、`calibrationSummaries`、`selectedPerformance`、`selectedReadiness`。**保留** `qualityWarning`（274）。
9. **加 memo**（喺 `selectedFixture` 277 附近）：
   ```ts
   const matchAnalysis = useMemo(
     () => (analysisMatchId ? buildMatchMarketDetails({ matchId: analysisMatchId, fixtures, rows, totalCards, cornerCards, handicapCards }) : null),
     [analysisMatchId, fixtures, rows, totalCards, cornerCards, handicapCards],
   );
   ```
10. **`syncPage`（284-286）**：
    - `if ((nextPage === "history" || nextPage === "analysis") && ...)` 改做 `if (nextPage === "history" && ...)`；
    - `setFixtureId(...)` 之後加 `setAnalysisMatchId(analysisMatchIdFromHash(window.location.hash));`。
11. **autoload gate（323）**：`if ((page === "history" || page === "analysis") && !resultAutoLoadStarted.current)` 改做 `if (page === "history" && !resultAutoLoadStarted.current)`。
12. **`loadBacktest`（341-359）**：刪 `setReadiness(Array.isArray(body.readiness) ? body.readiness as ModelReadiness[] : []);`；catch 入面 `clearBacktestResponseState({ resultEntries, readiness, snapshotQuality })` 改做 `clearBacktestResponseState({ resultEntries, readiness: [], snapshotQuality })`，並刪 `setReadiness(cleared.readiness);`。
13. **刪舊 heading（467）**：`{page === "analysis" ? <h1 className="page-heading">模型表現分析</h1> : null}`。
14. **替換成段舊 analysis section（510-593）** 做：

    ```tsx
          {page === "analysis" ? (
            <MatchAnalysisPage
              matchId={analysisMatchId}
              header={matchAnalysis?.header ?? null}
              details={matchAnalysis?.details ?? null}
              opportunities={buyOpportunities}
              logos={teamLogos}
              generatedAt={lastSuccessfulSync}
            />
          ) : null}
    ```
15. **fixtures 卡 link（486）**：`href={`#/fixtures/${encodeURIComponent(fixture.matchId)}`}` 改做 `href={`#/analysis?match=${encodeURIComponent(fixture.matchId)}`}`。（`#/fixtures/<id>` deep link 本身保留 — `FixtureDetail`、`fixtureIdFromHash`、`tabForRouteTransition`、`selectedFixture` 全部唔郁，pro dashboard 仲用緊。）
16. **刪 `PerformanceBar`（707-715）同 `Stat`（805-812）**。
17. **Import 精簡檢查**：`Loader2`（仲用：671）、`AlertTriangle`（653）、`Calculator`（597/610/624）全部保留；`type AnalysisRow`（line 8）如果 tsc 報 unused 先刪。

- [ ] **Step 4: tsc + 全量 Vitest**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
Expected: 0 error（unused import/state 逐個執漏）
Run: `node node_modules/vitest/vitest.mjs run`
Expected: 全部 PASS。特別留意 `src/App.test.tsx` 其他 source-string 斷言（`:77-82` `tabForRouteTransition` wiring 要保住原字串）。

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: route analysis page to MatchAnalysisPage, drop model-health view"
```

---

### Task 7: Playwright — dashboard.spec 更新 + 新 analysis.spec

**Files:**
- Modify: `tests/ui/dashboard.spec.ts:61-78`
- Test: `tests/ui/analysis.spec.ts`（新開）

**Interfaces:**
- Consumes: `mockApi`（`tests/ui/helpers.ts:54-160`）；mock 數據 `match-value`（Value United vs Signal City，h2h 兩莊 + 大細兩莊，**冇角球/讓球**）。

- [ ] **Step 1: 改 `tests/ui/dashboard.spec.ts` fixtures 卡 click 斷言（約 61-78 行嘅 test）**

而家（約 66-68）：

```ts
    await page.locator('a[href="#/fixtures/match-value"]').click();
    await expect(page).toHaveURL(/#\/fixtures\/match-value$/);
    await expect(page.locator(".fixture-detail")).toBeVisible();
```

改做：

```ts
    await page.locator('a[href="#/analysis?match=match-value"]').click();
    await expect(page).toHaveURL(/#\/analysis\?match=match-value$/);
    await expect(page.locator(".match-analysis")).toBeVisible();
```

同埋喺同一個 test（或新開一個 test）保留 `#/fixtures/<id>` deep link 覆蓋（pro dashboard 仲用）：

```ts
    await page.goto("/#/fixtures/match-value");
    await expect(page.locator(".fixture-detail")).toBeVisible();
```

nav「分析」斷言（75-78：`/#\/analysis$/`）**唔使改**（裸 `#/analysis` 而家係 picker 頁，URL 斷言仲啱）。

- [ ] **Step 2: 新開 `tests/ui/analysis.spec.ts`**

```ts
import { expect, test } from "@playwright/test";
import { mockApi } from "./helpers";

test.beforeEach(async ({ page }) => {
  await mockApi(page, "authenticated", { dashboardMode: "simple" });
});

test("bare analysis route shows picker with quick links", async ({ page }) => {
  await page.goto("/#/analysis");
  await expect(page.getByText("由今日或賽程揀一場波")).toBeVisible();
  await expect(page.locator('a[href="#/analysis?match=match-value"]')).toBeVisible();
});

test("match analysis page shows four market cards with empty states", async ({ page }) => {
  await page.goto("/#/analysis?match=match-value");
  await expect(page.locator(".match-analysis")).toBeVisible();
  await expect(page.getByText("Value United vs Signal City")).toBeVisible();
  await expect(page.getByText("模型估").first()).toBeVisible();
  await expect(page.getByText("呢個市場冇盤")).toHaveCount(2); // 角球 + 亞洲讓球 mock 冇數據
});

test("switch-match link returns to picker", async ({ page }) => {
  await page.goto("/#/analysis?match=match-value");
  await page.getByRole("link", { name: "轉場" }).click();
  await expect(page).toHaveURL(/#\/analysis$/);
  await expect(page.getByText("由今日或賽程揀一場波")).toBeVisible();
});

test("unknown match shows not-found state", async ({ page }) => {
  await page.goto("/#/analysis?match=no-such-match");
  await expect(page.getByText("搵唔到呢場波")).toBeVisible();
});

test("today page pick card links to match analysis", async ({ page }) => {
  await page.goto("/#/today");
  await page.locator(".pick-card__summary").first().click();
  await page.locator(".pick-card__analysis-link").first().click();
  await expect(page).toHaveURL(/#\/analysis\?match=/);
  await expect(page.locator(".match-analysis")).toBeVisible();
});
```

（斷言嘅中文/結構同 Task 3/4 實裝對齊；如果「模型估」喺大細波卡都出現，`getByText("模型估").first()` 得。implementer 跑嘅時候如果 strict mode 报 multiple matches，用 `.first()` 或 locator 收窄，唔好改產品文案。）

- [ ] **Step 3: build + 跑 Playwright（RED → GREEN 一次過）**

```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/vite/bin/vite.js build
npm.cmd run test:ui:only
```

Expected: 全綠（56 舊 + 20 新 = 76；`dashboard.spec` 改咗嘅 test 都綠）。如果有 spec fail，逐個 fix 測試選擇器（**唔准**為遷就測試改產品行為/文案）。

- [ ] **Step 4: Commit**

```bash
git add tests/ui/dashboard.spec.ts tests/ui/analysis.spec.ts
git commit -m "test: cover match analysis page flows in Playwright"
```

---

### Task 8: 全量回歸 + 收尾檢查

**Files:** 冇新改動（除非發現問題）

- [ ] **Step 1: 全量檢查**

```bash
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/vite/bin/vite.js build
npm.cmd run test:ui:only
```

Expected: Vitest 全綠（226 舊 + 新 tests；PickCard/App.test 斷言已更新）、tsc 0 error、build 成功、Playwright 全綠。

- [ ] **Step 2: 紅線核對**

```bash
git diff master...HEAD --stat -- src/odds.ts src/totals.ts src/asianTotals.ts src/corners.ts src/handicap.ts src/buyCandidates.ts src/buyOpportunities.ts src/marketCalibration.ts src/picks.ts src/fixtureMatch.ts src/marketDisplay.ts src/oddsApi.ts src/pages/BuyDashboard.tsx src/pages/BuyDashboard.test.tsx
```

Expected: 空輸出（模型檔 + BuyDashboard 零 diff）。

- [ ] **Step 3: 確認 dead code 決策已執行**

- `marketDisplay.ts` 保留（dead exports 留 Phase C）✅
- `SimpleDashboard.tsx` 保留（Phase C 刪）✅
- 舊 analysis CSS（`src/styles.css:821-1027` 一帶）保留唔刪（Phase C 一併清，避免今期 review 風險）✅

- [ ] **Step 4: 如有執漏，commit fix；否則唔使 commit**

---

## Self-Review 記錄（plan 作者已做）

- **Spec coverage**：§2.4 四市場卡（Task 2/3/4）、冇揀場 picker（Task 4）、轉場（Task 4）、冇數據卡照出「呢個市場冇盤」（Task 2/3）、刪舊模型健康（Task 6）、`?match=` 參數（Task 1）、今日跳轉（Task 5）、賽程跳轉（Task 6 step 15 + Task 7）、跨頁流 e2e（Task 7）。§2.3 賽程頁分組/filter 係 **Phase C**，唔喺呢個 plan。
- **刻意唔做**（寫低免誤會）：TodayPage 即將開賽 link 維持 `#/fixtures/<id>`（spec §2.2「撳去賽程頁」）；BuyDashboard / SimpleDashboard link 唔郁；舊 analysis CSS 同 marketDisplay dead exports 留 Phase C。
- **Placeholder scan**：每個 code step 有完整代碼；match.css 卡面細節以 today.css 為模板（視覺微調空間係刻意嘅，結構 class 已鎖）。
- **Type consistency**：`MarketDetail` / `MatchMarketDetails` / `MatchHeaderInfo` / `buildMatchMarketDetails` / `MarketDetailCard` / `MatchAnalysisPage` props 喺 Task 2/3/4/6 之間逐字一致；`analysisMatchIdFromHash` 名喺 Task 1/6 一致。
