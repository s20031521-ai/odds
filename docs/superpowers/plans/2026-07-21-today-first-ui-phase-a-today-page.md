# Today-First UI · Phase A「今日首頁」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將首頁變成「答案優先」嘅今日頁 — 打開 5 秒內見到「今日買咩、點買」，冇貨一句講明原因。

**Architecture:** 純前端改造。新增 `TodayPage`（新鮮度條 + 精選盤卡 + 冇貨狀態 + 即將開賽）取代 `DashboardPage` 嘅 simple 分支；`#/today` 新 route，舊 `#/dashboard` 喺 hash 解析層 alias 去 today（舊書籤唔死）；nav labels 改名。數據完全沿用 `selectBuyOpportunities` output，零模型改動。

**Tech Stack:** React 19 + TS + Vite；Vitest（`renderToStaticMarkup`，node env，冇 jsdom）；Playwright 4 viewports（打 build 後 preview server）。

**Spec:** `docs/superpowers/specs/2026-07-21-today-first-ui-redesign-design.md`（Phase B/C 另出 plan）

## Global Constraints

- **模型凍結**：唔准郁 `src/odds.ts`、`src/totals.ts`、`src/asianTotals.ts`、`src/corners.ts`、`src/handicap.ts`、`src/buyCandidates.ts`、`src/buyOpportunities.ts`、`src/marketCalibration.ts`、`src/picks.ts`；`BUY_EDGE_THRESHOLD = 0.03` 同 analyzer defaults（bankroll 1000 / fractionalKelly 0.25 / stakeCapPercent 0.02）唔准改。
- **`src/pages/BuyDashboard.tsx` 同 `src/pages/BuyDashboard.test.tsx` 一個 byte 都唔准郁**（owner 紅線）。
- **鎖死字串**（有測試逐字斷言，改必同步改測試；呢期唔應該改到佢哋）：`資料未更新，暫停顯示買盤。`、`暫時未有賽事達到 3% Edge。`、`查看全部賽事`、`同步時間`、`未有成功同步`、`暫時冇場次過關`、`完場對比`、`模型表現分析`、`OFFLINE_WARNING`（`src/App.tsx:104`，`App.test.tsx:124` 連 `const OFFLINE_WARNING = ` 前綴一齊斷）。
- className 只加新、唔改舊名；幾何唔變：`--touch-target: 44px`、dashboard grid 列數、nav breakpoints。
- 新 UI 只用 `src/styles/tokens.css` 嘅 CSS variables；零外部資源（離線紅線）。
- **Windows 環境**：Git Bash 冇 `npm`/`npx` — Vitest 用 `node node_modules/vitest/vitest.mjs run`，tsc 用 `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`，build 用 `node node_modules/vite/bin/vite.js build`，Playwright 用 PowerShell `npm.cmd run test:ui:only`。
- TDD：每個行為先寫 failing test（RED → GREEN），每 task 完 commit。
- `DashboardMode` 嘅 storage 值保持 `"simple" | "pro"` 唔變（Playwright init script 同現有用戶 localStorage 相容）；今期只改顯示 label。

---

### Task 1: Route — `#/today` + 舊 `#/dashboard` alias

**Files:**
- Modify: `src/route.ts`
- Test: `src/route.test.ts`

**Interfaces:**
- Produces: `Page = "today" | "fixtures" | "analysis" | "history"`；`pageFromHash("#/today") → "today"`；`pageFromHash("#/dashboard") → "today"`（alias）；`pageFromHash("#/dashboard/<id>") → "fixtures"`（legacy 深鏈唔變）。`fixtureIdFromHash`、`tabForRouteTransition` signature 唔變。

- [ ] **Step 1: 改 test（RED）**

`src/route.test.ts` 入面（現有 L8 `expect(pageFromHash("#/dashboard")).toBe("dashboard");`），改做：

```ts
expect(pageFromHash("#/today")).toBe("today");
expect(pageFromHash("#/dashboard")).toBe("today"); // legacy alias
```

其餘 assertion 唔郁（`#/dashboard/game-1` → `"fixtures"` 等 legacy 行為保留）。

- [ ] **Step 2: 跑 test 確認 fail**

Run: `node node_modules/vitest/vitest.mjs run src/route.test.ts`
Expected: FAIL — `pageFromHash("#/today")` 而家回 `"dashboard"`；`"today"` type 未存在可能直接 TS 錯。

- [ ] **Step 3: 改 `src/route.ts`（GREEN）**

L1 同 `pageFromHash` 改做：

```ts
export type Page = "today" | "fixtures" | "analysis" | "history";
export type FixtureAnalysisTab = "h2h" | "totals" | "corners" | "handicap";

export function pageFromHash(hash: string): Page {
  const value = cleanHash(hash);
  if (value === "fixtures" || value.startsWith("fixtures/") || value.startsWith("dashboard/")) return "fixtures";
  if (value.startsWith("analysis")) return "analysis";
  if (value.startsWith("history")) return "history";
  return "today";
}
```

（`dashboard/<id>` 深鏈繼續落 fixtures；bare `dashboard` 同 `today` 都跌去 default `"today"`。`fixtureIdFromHash`、`tabForRouteTransition`、`cleanHash` 唔郁。）

- [ ] **Step 4: 跑 test 確認 pass**

Run: `node node_modules/vitest/vitest.mjs run src/route.test.ts`
Expected: PASS

注意：呢刻 `App.tsx` / `AppShell.tsx` 仲用緊 `"dashboard"`，`tsc` 會报錯 — 正常，Task 2/9/10 會執。**唔好喺呢度順手改。**

- [ ] **Step 5: Commit**

```bash
git add src/route.ts src/route.test.ts
git commit -m "feat: add #/today route, alias legacy #/dashboard"
```

---

### Task 2: AppShell nav labels 改名

**Files:**
- Modify: `src/components/AppShell.tsx:5-10`
- Test: `src/components/AppShell.test.tsx`

**Interfaces:**
- Consumes: Task 1 嘅 `Page` type。
- Produces: nav items `今日 #/today`、`賽程 #/fixtures`、`分析 #/analysis`、`紀錄 #/history`（呢個順序）。Playwright `dashboard.spec.ts` 用 `getByRole("link", { name })` 會受影響（Task 11 處理）。

- [ ] **Step 1: 改 test（RED）**

`src/components/AppShell.test.tsx:7-12` 嘅 expected array 改做：

```ts
["#/today", "今日"],
["#/fixtures", "賽程"],
["#/analysis", "分析"],
["#/history", "紀錄"],
```

- [ ] **Step 2: 跑 test 確認 fail**

Run: `node node_modules/vitest/vitest.mjs run src/components/AppShell.test.tsx`
Expected: FAIL（舊 labels `值得買/全部賽事/完場紀錄/模型健康` 唔 match）

- [ ] **Step 3: 改 `src/components/AppShell.tsx:5-10`（GREEN）**

```ts
const navigationItems = Object.freeze([
  { route: "today", href: "#/today", label: "今日" },
  { route: "fixtures", href: "#/fixtures", label: "賽程" },
  { route: "analysis", href: "#/analysis", label: "分析" },
  { route: "history", href: "#/history", label: "紀錄" },
] as const);
```

- [ ] **Step 4: 跑 test 確認 pass**

Run: `node node_modules/vitest/vitest.mjs run src/components/AppShell.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/AppShell.tsx src/components/AppShell.test.tsx
git commit -m "feat: rename nav labels to 今日/賽程/分析/紀錄"
```

---

### Task 3: `displayStake` 注碼顯示 helper

**Files:**
- Create: `src/stakeDisplay.ts`
- Test: `src/stakeDisplay.test.ts`

**Interfaces:**
- Consumes: `BuyPick`（`src/buyOpportunities.ts:5-13`）。
- Produces:
  ```ts
  export type StakeSettings = { bankroll: number; fractionalKelly: number; stakeCapPercent: number };
  export const DEFAULT_STAKE_SETTINGS: StakeSettings; // { bankroll: 1000, fractionalKelly: 0.25, stakeCapPercent: 0.02 }
  export function displayStake(pick: BuyPick, settings?: StakeSettings): number; // 回傳整數金額
  ```
  Task 4 `PickCard` 用 `displayStake(primary)`。呢個係**顯示層** helper，公式跟現行 analyzer defaults，唔郁任何模型檔。

- [ ] **Step 1: 寫 test（RED）**

Create `src/stakeDisplay.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import type { BuyPick } from "./buyOpportunities";
import { DEFAULT_STAKE_SETTINGS, displayStake } from "./stakeDisplay";

const pick = (chance: number, odds: number): BuyPick => ({
  market: "大細波", selection: "大", line: 2.5, odds, chance, edge: chance * odds - 1, bookmaker: "Alpha",
});

describe("displayStake", () => {
  it("caps at 2% of bankroll when fractional Kelly exceeds the cap", () => {
    // fullKelly = (0.58*1.95-1)/(1.95-1) ≈ 0.138 → ×0.25 ≈ 0.0345 > 0.02 cap → 1000×0.02 = 20
    expect(displayStake(pick(0.58, 1.95))).toBe(20);
  });

  it("returns fractional Kelly stake when below the cap", () => {
    // fullKelly = (0.52*1.5-1)/0.5 = -0.44 → 負數 clamp 做 0；用正例：(0.55*1.4-1)/0.4 = -0.575 都係負
    // 正例：odds 3.0 chance 0.36 → fullKelly = (1.08-1)/2 = 0.04 → ×0.25 = 0.01 → 1000×0.01 = 10
    expect(displayStake(pick(0.36, 3.0))).toBe(10);
  });

  it("returns 0 for negative edge", () => {
    expect(displayStake(pick(0.3, 2.0))).toBe(0);
  });

  it("returns 0 for invalid inputs", () => {
    expect(displayStake(pick(0, 1.95))).toBe(0);
    expect(displayStake(pick(0.5, 1))).toBe(0);
  });

  it("respects custom settings", () => {
    expect(displayStake(pick(0.36, 3.0), { bankroll: 5000, fractionalKelly: 0.25, stakeCapPercent: 0.02 })).toBe(50);
  });

  it("exposes frozen defaults matching analyzer settings", () => {
    expect(DEFAULT_STAKE_SETTINGS).toEqual({ bankroll: 1000, fractionalKelly: 0.25, stakeCapPercent: 0.02 });
  });
});
```

- [ ] **Step 2: 跑 test 確認 fail**

Run: `node node_modules/vitest/vitest.mjs run src/stakeDisplay.test.ts`
Expected: FAIL — module 未存在

- [ ] **Step 3: 寫 implementation（GREEN）**

Create `src/stakeDisplay.ts`：

```ts
import type { BuyPick } from "./buyOpportunities";

export type StakeSettings = {
  bankroll: number;
  fractionalKelly: number;
  stakeCapPercent: number;
};

// Display-only mirror of the analyzer defaults in src/App.tsx — never edit
// these values without owner approval (model freeze red line).
export const DEFAULT_STAKE_SETTINGS: StakeSettings = {
  bankroll: 1000,
  fractionalKelly: 0.25,
  stakeCapPercent: 0.02,
};

export function displayStake(pick: BuyPick, settings: StakeSettings = DEFAULT_STAKE_SETTINGS): number {
  if (!(pick.odds > 1) || !(pick.chance > 0) || !(pick.chance <= 1)) return 0;
  const fullKelly = (pick.chance * pick.odds - 1) / (pick.odds - 1);
  const fraction = Math.min(Math.max(fullKelly, 0) * settings.fractionalKelly, settings.stakeCapPercent);
  return Math.round(settings.bankroll * fraction);
}
```

- [ ] **Step 4: 跑 test 確認 pass**

Run: `node node_modules/vitest/vitest.mjs run src/stakeDisplay.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 5: Commit**

```bash
git add src/stakeDisplay.ts src/stakeDisplay.test.ts
git commit -m "feat: add displayStake helper for pick cards"
```

---

### Task 4: `PickCard` 精選盤卡（`<details>` 原生展開）

**Files:**
- Create: `src/components/PickCard.tsx`
- Test: `src/components/PickCard.test.tsx`

**Interfaces:**
- Consumes: `BuyOpportunity`、`BuyPick`（`src/buyOpportunities.ts:26-37`）；`TeamLogo`、`TeamLogoMap`（`src/components/TeamLogo.tsx`）；`displayStake`（Task 3）。
- Produces:
  ```tsx
  export function PickCard(props: { opportunity: BuyOpportunity; logos: TeamLogoMap; generatedAt: string | null }): React.ReactElement
  export function formatSelection(pick: BuyPick): string   // "大 2.5" / "主隊"
  export function formatOdds(value: number): string        // "1.95" / "—"
  export function formatKickoff(value: string): string     // "7月21日 20:00"（parse 唔到回原字串）
  ```
  用原生 `<details>/<summary>` 做原地展開 — SSR 測試可以斷言 markup、Playwright 可以 click、唔使 JS state、離線 work。Task 7 `TodayPage` 用 `PickCard` + `formatKickoff`。

- [ ] **Step 1: 寫 test（RED）**

Create `src/components/PickCard.test.tsx`：

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuyOpportunity } from "../buyOpportunities";
import type { TeamLogoMap } from "./TeamLogo";
import { formatKickoff, PickCard } from "./PickCard";

const opportunity: BuyOpportunity = {
  matchId: "match-1",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  homeTeamZh: "阿仙奴",
  awayTeamZh: "車路士",
  commenceTime: "2026-07-21T20:00:00",
  league: "Premier League",
  primary: { market: "大細波", selection: "大", line: 2.5, odds: 1.95, chance: 0.58, edge: 0.131, bookmaker: "Alpha" },
  alternatives: [
    { market: "主客和", selection: "主隊", odds: 2.1, chance: 0.52, edge: 0.092, bookmaker: "Beta" },
  ],
};

const logos: TeamLogoMap = { Arsenal: { id: 42, logo: "/team-logos/42.png" } };

describe("PickCard", () => {
  it("renders collapsed three-line summary inside a details element", () => {
    const markup = renderToStaticMarkup(
      <PickCard opportunity={opportunity} logos={logos} generatedAt="2026-07-21T12:00:00Z" />,
    );
    expect(markup).toContain("<details");
    expect(markup).toContain("pick-card");
    expect(markup).toContain("阿仙奴 vs 車路士"); // zh 名優先
    expect(markup).toContain("買：大 2.5");
    expect(markup).toContain("1.95");
    expect(markup).toContain("詳情▾");
  });

  it("falls back to English names when zh missing", () => {
    const noZh: BuyOpportunity = { ...opportunity, homeTeamZh: undefined, awayTeamZh: undefined };
    const markup = renderToStaticMarkup(
      <PickCard opportunity={noZh} logos={logos} generatedAt={null} />,
    );
    expect(markup).toContain("Arsenal vs Chelsea");
  });

  it("renders expanded detail content (edge, probability comparison, stake, sync time, analysis link)", () => {
    const markup = renderToStaticMarkup(
      <PickCard opportunity={opportunity} logos={logos} generatedAt="2026-07-21T12:00:00Z" />,
    );
    expect(markup).toContain("Edge +13.1%");
    expect(markup).toContain("模型估 58.0%，莊家開 51.3%");
    expect(markup).toContain("建議注碼 $20"); // displayStake(0.58, 1.95) capped 2% of 1000
    expect(markup).toContain("賠率同步於 2026-07-21T12:00:00Z");
    expect(markup).toContain('href="#/fixtures/match-1"');
    expect(markup).toContain("睇單場分析 →");
  });

  it("lists alternative picks", () => {
    const markup = renderToStaticMarkup(
      <PickCard opportunity={opportunity} logos={logos} generatedAt={null} />,
    );
    expect(markup).toContain("未有成功同步");
    expect(markup).toContain("主隊");
    expect(markup).toContain("2.10");
    expect(markup).toContain("Beta");
  });

  it("encodes matchId in the analysis link", () => {
    const spaced: BuyOpportunity = { ...opportunity, matchId: "match 1" };
    const markup = renderToStaticMarkup(
      <PickCard opportunity={spaced} logos={logos} generatedAt={null} />,
    );
    expect(markup).toContain('href="#/fixtures/match%201"');
  });
});

describe("formatKickoff", () => {
  it("formats as M月D日 HH:MM", () => {
    const input = "2026-07-21T20:00:00";
    const date = new Date(input);
    const pad = (n: number) => String(n).padStart(2, "0");
    const expected = `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    expect(formatKickoff(input)).toBe(expected);
  });

  it("returns the raw string when unparseable", () => {
    expect(formatKickoff("not-a-date")).toBe("not-a-date");
  });
});
```

- [ ] **Step 2: 跑 test 確認 fail**

Run: `node node_modules/vitest/vitest.mjs run src/components/PickCard.test.tsx`
Expected: FAIL — module 未存在

- [ ] **Step 3: 寫 implementation（GREEN）**

Create `src/components/PickCard.tsx`：

```tsx
import type { BuyOpportunity, BuyPick } from "../buyOpportunities";
import { displayStake } from "../stakeDisplay";
import { TeamLogo, type TeamLogoMap } from "./TeamLogo";

export function PickCard(props: {
  opportunity: BuyOpportunity;
  logos: TeamLogoMap;
  generatedAt: string | null;
}): React.ReactElement {
  const { opportunity, logos } = props;
  const primary = opportunity.primary;
  const home = opportunity.homeTeamZh ?? opportunity.homeTeam;
  const away = opportunity.awayTeamZh ?? opportunity.awayTeam;
  return (
    <details className="pick-card">
      <summary className="pick-card__summary">
        <span className="pick-card__match">
          <TeamLogo teamName={opportunity.homeTeam} logos={logos} />
          {home} vs {away}
          <TeamLogo teamName={opportunity.awayTeam} logos={logos} />
          <time className="pick-card__kickoff" dateTime={opportunity.commenceTime}>
            {formatKickoff(opportunity.commenceTime)}
          </time>
        </span>
        <span className="pick-card__selection">買：{formatSelection(primary)}</span>
        <span className="pick-card__odds">{formatOdds(primary.odds)}</span>
        <span className="pick-card__toggle" aria-hidden="true">詳情▾</span>
      </summary>
      <div className="pick-card__details">
        <p>Edge +{formatPercent(primary.edge)}</p>
        <p>模型估 {formatPercent(primary.chance)}，莊家開 {formatPercent(1 / primary.odds)}</p>
        <p>建議注碼 ${displayStake(primary)}</p>
        <p>賠率同步於 {props.generatedAt ?? "未有成功同步"}</p>
        {opportunity.alternatives.length > 0 ? (
          <ul className="pick-card__alternatives">
            {opportunity.alternatives.map((pick) => (
              <li key={pickKey(pick)}>
                {formatSelection(pick)} @ {formatOdds(pick.odds)}（{pick.bookmaker}）
              </li>
            ))}
          </ul>
        ) : null}
        <a className="pick-card__analysis-link" href={`#/fixtures/${encodeURIComponent(opportunity.matchId)}`}>
          睇單場分析 →
        </a>
      </div>
    </details>
  );
}

export function formatSelection(pick: BuyPick): string {
  return pick.line === undefined ? pick.selection : `${pick.selection} ${formatLine(pick.line)}`;
}

export function formatOdds(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "—";
}

export function formatKickoff(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatLine(line: number): string {
  return Number.isInteger(line) ? line.toFixed(1) : `${line}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function pickKey(pick: BuyPick): string {
  return `${pick.market}|${pick.line ?? ""}|${pick.selection}|${pick.bookmaker}`;
}
```

注意：「模型估 58.0%」嚟自 `formatPercent(0.58)`（toFixed(1)）；「莊家開 51.3%」嚟自 `1/1.95 ≈ 0.5128`。Test 斷言已經對準呢個格式。

- [ ] **Step 4: 跑 test 確認 pass**

Run: `node node_modules/vitest/vitest.mjs run src/components/PickCard.test.tsx`
Expected: PASS（7 tests）

- [ ] **Step 5: Commit**

```bash
git add src/components/PickCard.tsx src/components/PickCard.test.tsx
git commit -m "feat: add PickCard with native details expansion"
```

---

### Task 5: `FreshnessBar` 新鮮度條

**Files:**
- Create: `src/components/FreshnessBar.tsx`
- Test: `src/components/FreshnessBar.test.tsx`

**Interfaces:**
- Produces:
  ```tsx
  export function FreshnessBar(props: { generatedAt: string | null; dataFresh: boolean; now: number }): React.ReactElement
  ```
  三態：stale（黃色警告）/ 有時間戳（「賠率更新於 X 分鐘前」，0 分鐘顯示「賠率啱啱更新」）/ 冇時間戳（「未有成功同步」— 沿用鎖死字串原文，唔係改佢）。Task 7 用。

- [ ] **Step 1: 寫 test（RED）**

Create `src/components/FreshnessBar.test.tsx`：

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FreshnessBar } from "./FreshnessBar";

const NOW = Date.parse("2026-07-21T12:00:00Z");

describe("FreshnessBar", () => {
  it("shows a stale warning when data is not fresh", () => {
    const markup = renderToStaticMarkup(
      <FreshnessBar generatedAt="2026-07-21T10:00:00Z" dataFresh={false} now={NOW} />,
    );
    expect(markup).toContain("freshness-bar--stale");
    expect(markup).toContain("數據好耐冇更新，小心舊盤");
    expect(markup).toContain('role="status"');
  });

  it("shows minutes since sync when fresh", () => {
    const markup = renderToStaticMarkup(
      <FreshnessBar generatedAt="2026-07-21T11:45:00Z" dataFresh now={NOW} />,
    );
    expect(markup).toContain("賠率更新於 15 分鐘前");
    expect(markup).not.toContain("freshness-bar--stale");
  });

  it("shows 啱啱更新 for sub-minute freshness", () => {
    const markup = renderToStaticMarkup(
      <FreshnessBar generatedAt="2026-07-21T11:59:40Z" dataFresh now={NOW} />,
    );
    expect(markup).toContain("賠率啱啱更新");
  });

  it("never shows negative minutes when clock skews", () => {
    const markup = renderToStaticMarkup(
      <FreshnessBar generatedAt="2026-07-21T12:05:00Z" dataFresh now={NOW} />,
    );
    expect(markup).toContain("賠率啱啱更新");
  });

  it("shows 未有成功同步 when generatedAt is null or unparseable", () => {
    for (const generatedAt of [null, "not-a-date"]) {
      const markup = renderToStaticMarkup(
        <FreshnessBar generatedAt={generatedAt} dataFresh now={NOW} />,
      );
      expect(markup).toContain("未有成功同步");
    }
  });
});
```

- [ ] **Step 2: 跑 test 確認 fail**

Run: `node node_modules/vitest/vitest.mjs run src/components/FreshnessBar.test.tsx`
Expected: FAIL — module 未存在

- [ ] **Step 3: 寫 implementation（GREEN）**

Create `src/components/FreshnessBar.tsx`：

```tsx
export function FreshnessBar(props: {
  generatedAt: string | null;
  dataFresh: boolean;
  now: number;
}): React.ReactElement {
  if (!props.dataFresh) {
    return (
      <p className="freshness-bar freshness-bar--stale" role="status">
        數據好耐冇更新，小心舊盤
      </p>
    );
  }
  const synced = Date.parse(props.generatedAt ?? "");
  if (Number.isNaN(synced)) {
    return <p className="freshness-bar" role="status">未有成功同步</p>;
  }
  const minutes = Math.max(0, Math.round((props.now - synced) / 60000));
  return (
    <p className="freshness-bar" role="status">
      {minutes === 0 ? "賠率啱啱更新" : `賠率更新於 ${minutes} 分鐘前`}
    </p>
  );
}
```

- [ ] **Step 4: 跑 test 確認 pass**

Run: `node node_modules/vitest/vitest.mjs run src/components/FreshnessBar.test.tsx`
Expected: PASS（5 tests）

- [ ] **Step 5: Commit**

```bash
git add src/components/FreshnessBar.tsx src/components/FreshnessBar.test.tsx
git commit -m "feat: add FreshnessBar component"
```

---

### Task 6: `EmptyState` 三種冇貨原因

**Files:**
- Create: `src/components/EmptyState.tsx`
- Test: `src/components/EmptyState.test.tsx`

**Interfaces:**
- Consumes: `Mascot`（`src/components/Kawaii.tsx`，poses：`momonga-alert`、`chiikawa-empty`）。
- Produces:
  ```tsx
  export type EmptyReason = "stale" | "no-fixtures" | "no-value";
  export function EmptyState(props: { reason: EmptyReason; fixtureCount?: number }): React.ReactElement
  ```

- [ ] **Step 1: 寫 test（RED）**

Create `src/components/EmptyState.test.tsx`：

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("stale: momonga-alert + 更新緊 message", () => {
    const markup = renderToStaticMarkup(<EmptyState reason="stale" />);
    expect(markup).toContain("mascot--alert");
    expect(markup).toContain("數據舊咗，唔好住落注 — 更新緊");
    expect(markup).toContain('role="status"');
  });

  it("no-fixtures: chiikawa-empty + 冇波睇 message", () => {
    const markup = renderToStaticMarkup(<EmptyState reason="no-fixtures" />);
    expect(markup).toContain("mascot--empty");
    expect(markup).toContain("今日冇波睇，聽日先嚟過");
  });

  it("no-value: chiikawa-empty + fixture count message", () => {
    const markup = renderToStaticMarkup(<EmptyState reason="no-value" fixtureCount={7} />);
    expect(markup).toContain("mascot--empty");
    expect(markup).toContain("今日 7 場波，但冇盤值博 — 慳返啖");
  });

  it("no-value defaults fixture count to 0", () => {
    const markup = renderToStaticMarkup(<EmptyState reason="no-value" />);
    expect(markup).toContain("今日 0 場波");
  });
});
```

- [ ] **Step 2: 跑 test 確認 fail**

Run: `node node_modules/vitest/vitest.mjs run src/components/EmptyState.test.tsx`
Expected: FAIL — module 未存在

- [ ] **Step 3: 寫 implementation（GREEN）**

Create `src/components/EmptyState.tsx`：

```tsx
import { Mascot } from "./Kawaii";

export type EmptyReason = "stale" | "no-fixtures" | "no-value";

export function EmptyState(props: { reason: EmptyReason; fixtureCount?: number }): React.ReactElement {
  if (props.reason === "stale") {
    return (
      <div className="today-empty" role="status">
        <Mascot pose="momonga-alert" />
        <p>數據舊咗，唔好住落注 — 更新緊</p>
      </div>
    );
  }
  if (props.reason === "no-fixtures") {
    return (
      <div className="today-empty" role="status">
        <Mascot pose="chiikawa-empty" />
        <p>今日冇波睇，聽日先嚟過</p>
      </div>
    );
  }
  return (
    <div className="today-empty" role="status">
      <Mascot pose="chiikawa-empty" />
      <p>今日 {props.fixtureCount ?? 0} 場波，但冇盤值博 — 慳返啖</p>
    </div>
  );
}
```

- [ ] **Step 4: 跑 test 確認 pass**

Run: `node node_modules/vitest/vitest.mjs run src/components/EmptyState.test.tsx`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add src/components/EmptyState.tsx src/components/EmptyState.test.tsx
git commit -m "feat: add EmptyState with three no-pick reasons"
```

---

### Task 7: `TodayPage` 組合三層結構

**Files:**
- Create: `src/pages/TodayPage.tsx`
- Test: `src/pages/TodayPage.test.tsx`

**Interfaces:**
- Consumes: Task 4 `PickCard`/`formatKickoff`、Task 5 `FreshnessBar`、Task 6 `EmptyState`、`Fixture` type（`src/odds.ts:28-38`：`{ matchId, homeTeam, awayTeam, homeTeamZh?, awayTeamZh?, commenceTime, bookmakerCount, league?, leagueZh? }`）、`TeamLogo`/`TeamLogoMap`。
- Produces:
  ```tsx
  export function TodayPage(props: {
    opportunities: BuyOpportunity[];
    fixtures: Fixture[];
    generatedAt: string | null;
    dataFresh: boolean;
    logos: TeamLogoMap;
    now?: number;              // 測試 inject；預設 Date.now()
    onShowAll?: () => void;    // 「仲有 X 個盤」撳掣；冇就唔顯示
  }): React.ReactElement
  ```
  常數 `MAX_PICK_CARDS = 5`、`UPCOMING_FIXTURE_COUNT = 3`（module-private）。Task 9 `DashboardPage` 會 render 佢。

- [ ] **Step 1: 寫 test（RED）**

Create `src/pages/TodayPage.test.tsx`：

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuyOpportunity } from "../buyOpportunities";
import type { TeamLogoMap } from "../components/TeamLogo";
import type { Fixture } from "../odds";
import { TodayPage } from "./TodayPage";

const NOW = Date.parse("2026-07-21T12:00:00Z");
const logos: TeamLogoMap = {};

const opportunity = (matchId: string, edge: number): BuyOpportunity => ({
  matchId,
  homeTeam: `Home ${matchId}`,
  awayTeam: `Away ${matchId}`,
  commenceTime: "2026-07-21T20:00:00",
  primary: { market: "大細波", selection: "大", line: 2.5, odds: 1.95, chance: 0.58, edge, bookmaker: "Alpha" },
  alternatives: [],
});

const fixture = (matchId: string): Fixture => ({
  matchId,
  homeTeam: `Home ${matchId}`,
  awayTeam: `Away ${matchId}`,
  commenceTime: "2026-07-21T20:00:00",
  bookmakerCount: 3,
});

const baseProps = {
  generatedAt: "2026-07-21T11:50:00Z",
  logos,
  now: NOW,
};

describe("TodayPage", () => {
  it("renders freshness bar + pick cards + upcoming fixtures when there are picks", () => {
    const markup = renderToStaticMarkup(
      <TodayPage {...baseProps} opportunities={[opportunity("m1", 0.13)]} fixtures={[fixture("m1"), fixture("m2")]} dataFresh />,
    );
    expect(markup).toContain("today-page");
    expect(markup).toContain("賠率更新於 10 分鐘前");
    expect(markup).toContain("pick-card");
    expect(markup).toContain("即將開賽");
    expect(markup).toContain("查看全部賽事");
  });

  it("caps pick cards at 5 and offers overflow button when onShowAll provided", () => {
    const seven = Array.from({ length: 7 }, (_, i) => opportunity(`m${i}`, 0.1));
    const markup = renderToStaticMarkup(
      <TodayPage {...baseProps} opportunities={seven} fixtures={[]} dataFresh onShowAll={() => {}} />,
    );
    expect(markup.match(/<details/g)).toHaveLength(5);
    expect(markup).toContain("仲有 2 個盤 →");
  });

  it("hides overflow button without onShowAll", () => {
    const seven = Array.from({ length: 7 }, (_, i) => opportunity(`m${i}`, 0.1));
    const markup = renderToStaticMarkup(
      <TodayPage {...baseProps} opportunities={seven} fixtures={[]} dataFresh />,
    );
    expect(markup).not.toContain("仲有 2 個盤 →");
  });

  it("shows stale empty state when data is not fresh (ignores opportunities)", () => {
    const markup = renderToStaticMarkup(
      <TodayPage {...baseProps} opportunities={[opportunity("m1", 0.13)]} fixtures={[fixture("m1")]} dataFresh={false} />,
    );
    expect(markup).toContain("數據舊咗，唔好住落注 — 更新緊");
    expect(markup).not.toContain("<details");
  });

  it("shows no-fixtures state when there are no fixtures", () => {
    const markup = renderToStaticMarkup(
      <TodayPage {...baseProps} opportunities={[]} fixtures={[]} dataFresh />,
    );
    expect(markup).toContain("今日冇波睇，聽日先嚟過");
  });

  it("shows no-value state with fixture count when fixtures exist but nothing qualifies", () => {
    const markup = renderToStaticMarkup(
      <TodayPage {...baseProps} opportunities={[]} fixtures={[fixture("m1"), fixture("m2"), fixture("m3")]} dataFresh />,
    );
    expect(markup).toContain("今日 3 場波，但冇盤值博 — 慳返啖");
  });

  it("limits upcoming fixtures to 3 and links each to its fixture deep link", () => {
    const five = ["a", "b", "c", "d", "e"].map(fixture);
    const markup = renderToStaticMarkup(
      <TodayPage {...baseProps} opportunities={[]} fixtures={five} dataFresh />,
    );
    expect(markup.match(/today-page__upcoming-item/g)).toHaveLength(3);
    expect(markup).toContain('href="#/fixtures/a"');
  });
});
```

- [ ] **Step 2: 跑 test 確認 fail**

Run: `node node_modules/vitest/vitest.mjs run src/pages/TodayPage.test.tsx`
Expected: FAIL — module 未存在

- [ ] **Step 3: 寫 implementation（GREEN）**

Create `src/pages/TodayPage.tsx`：

```tsx
import type { BuyOpportunity } from "../buyOpportunities";
import { EmptyState } from "../components/EmptyState";
import { FreshnessBar } from "../components/FreshnessBar";
import { formatKickoff, PickCard } from "../components/PickCard";
import { TeamLogo, type TeamLogoMap } from "../components/TeamLogo";
import type { Fixture } from "../odds";

const MAX_PICK_CARDS = 5;
const UPCOMING_FIXTURE_COUNT = 3;

export function TodayPage(props: {
  opportunities: BuyOpportunity[];
  fixtures: Fixture[];
  generatedAt: string | null;
  dataFresh: boolean;
  logos: TeamLogoMap;
  now?: number;
  onShowAll?: () => void;
}): React.ReactElement {
  const now = props.now ?? Date.now();
  const active = props.dataFresh ? props.opportunities : [];
  const visible = active.slice(0, MAX_PICK_CARDS);
  const overflow = active.length - visible.length;
  return (
    <section className="today-page" aria-labelledby="today-page-title">
      <h1 id="today-page-title" className="page-heading">今日</h1>
      <FreshnessBar generatedAt={props.generatedAt} dataFresh={props.dataFresh} now={now} />
      {!props.dataFresh ? (
        <EmptyState reason="stale" />
      ) : active.length === 0 ? (
        <EmptyState
          reason={props.fixtures.length === 0 ? "no-fixtures" : "no-value"}
          fixtureCount={props.fixtures.length}
        />
      ) : (
        <div className="today-page__picks">
          {visible.map((opportunity) => (
            <PickCard
              key={opportunity.matchId}
              opportunity={opportunity}
              logos={props.logos}
              generatedAt={props.generatedAt}
            />
          ))}
          {overflow > 0 && props.onShowAll ? (
            <button type="button" className="today-page__show-all" onClick={props.onShowAll}>
              仲有 {overflow} 個盤 →
            </button>
          ) : null}
        </div>
      )}
      <section className="today-page__upcoming" aria-label="即將開賽">
        <h2>即將開賽</h2>
        <ul>
          {props.fixtures.slice(0, UPCOMING_FIXTURE_COUNT).map((item) => (
            <li key={item.matchId} className="today-page__upcoming-item">
              <a href={`#/fixtures/${encodeURIComponent(item.matchId)}`}>
                <TeamLogo teamName={item.homeTeam} logos={props.logos} />
                {item.homeTeamZh ?? item.homeTeam} vs {item.awayTeamZh ?? item.awayTeam}
                <time dateTime={item.commenceTime}>{formatKickoff(item.commenceTime)}</time>
              </a>
            </li>
          ))}
        </ul>
        <a href="#/fixtures">查看全部賽事</a>
      </section>
    </section>
  );
}
```

- [ ] **Step 4: 跑 test 確認 pass**

Run: `node node_modules/vitest/vitest.mjs run src/pages/TodayPage.test.tsx`
Expected: PASS（7 tests）

- [ ] **Step 5: Commit**

```bash
git add src/pages/TodayPage.tsx src/pages/TodayPage.test.tsx
git commit -m "feat: add TodayPage composing freshness, picks, empty states, upcoming"
```

---

### Task 8: `today.css` 樣式

**Files:**
- Create: `src/styles/today.css`
- Modify: `src/main.tsx`（加 import）

**Interfaces:**
- Consumes: `tokens.css` 嘅 CSS variables。Produces: `.today-page`、`.pick-card`、`.freshness-bar`、`.today-empty` 等 class 嘅樣式（全部新 class，唔改舊）。

- [ ] **Step 1: 寫 `src/styles/today.css`**

```css
/* Today-first homepage (Phase A). New classes only — do not rename existing ones. */

.today-page__picks {
  display: grid;
  gap: 12px;
}

.pick-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-soft);
}

.pick-card__summary {
  min-height: var(--touch-target);
  cursor: pointer;
  display: grid;
  gap: 4px;
  padding: 16px;
  list-style: none;
}

.pick-card__summary::-webkit-details-marker {
  display: none;
}

.pick-card__match {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.pick-card__kickoff {
  margin-left: auto;
  color: var(--color-muted);
  font-weight: 400;
}

.pick-card__selection {
  color: var(--color-text);
}

.pick-card__odds {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--color-primary-text);
}

.pick-card__toggle {
  color: var(--color-muted);
  font-size: 0.875rem;
}

.pick-card__details {
  padding: 0 16px 16px;
  border-top: 1px dashed var(--color-border);
  color: var(--color-text);
}

.pick-card__alternatives {
  margin: 0;
  padding-left: 1.25rem;
  color: var(--color-muted);
}

.pick-card__analysis-link {
  color: var(--color-primary-text);
  font-weight: 600;
}

.freshness-bar {
  color: var(--color-positive-text);
  margin: 0 0 12px;
}

.freshness-bar--stale {
  color: var(--color-warning);
}

.today-empty {
  text-align: center;
  padding: 32px 16px;
  color: var(--color-text);
}

.today-page__show-all {
  min-height: var(--touch-target);
  width: 100%;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--color-primary-text);
  font-weight: 600;
}

.today-page__upcoming ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}

.today-page__upcoming-item a {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: var(--touch-target);
  color: var(--color-text);
  text-decoration: none;
}
```

- [ ] **Step 2: `src/main.tsx` 加 import**

喺現有 `import "./styles/kawaii.css";` 隔籬加：

```ts
import "./styles/today.css";
```

（打開 `src/main.tsx` 搵現有 styles import 段，跟佢格式加一行。）

- [ ] **Step 3: 驗證 build 過**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` 同 `node node_modules/vite/bin/vite.js build`
Expected: 兩個都成功（tsc 呢刻可能仲有 Task 9/10 未做嘅 `"dashboard"` 相關錯 — 如果係咁，記低佢哋，確認冇 today.css 相關新錯就得）

- [ ] **Step 4: Commit**

```bash
git add src/styles/today.css src/main.tsx
git commit -m "feat: add today page styles"
```

---

### Task 9: `DashboardPage` 駁 TodayPage（simple → 今日）

**Files:**
- Modify: `src/pages/DashboardPage.tsx`
- Test: `src/pages/DashboardPage.test.tsx`

**Interfaces:**
- Consumes: Task 7 `TodayPage`；`Fixture`（`src/odds.ts`）。
- Produces: `DashboardPage` props 加 `fixtures: Fixture[]`；`MODE_LABELS` 變 `{ simple: "今日", pro: "專業" }`；simple 分支 render `TodayPage`，`onShowAll` 將 mode 轉做 `"pro"`。**pro 分支嘅 `<BuyDashboard ... />` call 一個 props 都唔准加減。**

- [ ] **Step 1: 改 test（RED）**

`src/pages/DashboardPage.test.tsx`：
- 每個 `<DashboardPage ... />` render 加 `fixtures={[]}` prop。
- 「defaults to simple mode」test：`expect(markup).toContain("simple-dashboard")` 改做 `expect(markup).toContain("today-page")`；`aria-pressed="true"...>極簡<` 改做 `>今日<`。
- pro mode test 唔郁（照斷言 `buy-dashboard__kpis`）。
- 加一個新 test：

```tsx
it("simple mode renders TodayPage with fixtures and picks", () => {
  const markup = renderToStaticMarkup(
    <DashboardPage
      opportunities={opportunities}
      fixtures={[]}
      generatedAt="2026-07-21T11:50:00Z"
      dataFresh
      logos={testLogos}
      storage={storageWith("simple")}
    />,
  );
  expect(markup).toContain("today-page");
  expect(markup).toContain("pick-card");
});
```

- [ ] **Step 2: 跑 test 確認 fail**

Run: `node node_modules/vitest/vitest.mjs run src/pages/DashboardPage.test.tsx`
Expected: FAIL（`fixtures` prop 未存在 / 仲 render 緊 SimpleDashboard）

- [ ] **Step 3: 改 `src/pages/DashboardPage.tsx`（GREEN）**

- L13-14 嘅 `MODE_LABELS` 改做：

```ts
const MODE_LABELS: Record<DashboardMode, string> = { simple: "今日", pro: "專業" };
```

- Props type（L16-22）加 `fixtures: Fixture[];`，檔頭加 `import type { Fixture } from "../odds";` 同 `import { TodayPage } from "./TodayPage";`，`SimpleDashboard` import 刪走。
- L44-48 嘅二選一 render 改做：

```tsx
{mode === "pro" ? (
  <BuyDashboard opportunities={props.opportunities} generatedAt={props.generatedAt} dataFresh={props.dataFresh} logos={props.logos} />
) : (
  <TodayPage
    opportunities={props.opportunities}
    fixtures={props.fixtures}
    generatedAt={props.generatedAt}
    dataFresh={props.dataFresh}
    logos={props.logos}
    onShowAll={() => selectMode("pro")}
  />
)}
```

- [ ] **Step 4: 跑 test 確認 pass**

Run: `node node_modules/vitest/vitest.mjs run src/pages/DashboardPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/DashboardPage.tsx src/pages/DashboardPage.test.tsx
git commit -m "feat: render TodayPage as default dashboard mode"
```

---

### Task 10: `App.tsx` wiring + PWA start_url

**Files:**
- Modify: `src/App.tsx`（3 處 `"dashboard"` 比較 + DashboardPage props）
- Modify: `vite.config.ts:18`（`start_url`）
- Test: `src/pwaConfig.test.ts:37`
- Check: `src/App.test.tsx`（如有 `"dashboard"` 相關斷言就跟住改）

**Interfaces:**
- Consumes: Task 1 `Page`、Task 9 `DashboardPage` 新 props。
- Produces: `page === "today"` 先 render DashboardPage；`fixtures={dashboardFixtures}` 傳入；PWA `start_url: "/#/today"`。

- [ ] **Step 1: 改 `src/App.tsx`**

成檔搵 `"dashboard"` 字串比較（已知 3 處，行號以現場為準）：
1. auto-load effect（約 L317-327）：`(page === "dashboard" || page === "fixtures")` → 將 `"dashboard"` 改 `"today"`
2. AppShell `dataWarning` 三元（約 L450）：同樣 `"dashboard"` → `"today"`
3. Page render（約 L463）：`{page === "dashboard" ? (` → `{page === "today" ? (`
4. 同一段 `<DashboardPage ... />` 加 prop `fixtures={dashboardFixtures}`（`dashboardFixtures` 已喺 L231-278 derived data 段存在）

- [ ] **Step 2: 改 `vite.config.ts:18`**

```ts
start_url: "/#/today",
```

- [ ] **Step 3: 改 `src/pwaConfig.test.ts:37`**

```ts
'start_url: "/#/today"',
```

- [ ] **Step 4: 全量驗證**

Run:
```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/vitest/vitest.mjs run
```
Expected: tsc 零錯；Vitest 全綠（如 `App.test.tsx` 有 `"dashboard"` 相關斷言 fail，按實際斷言內容改成 `"today"` 對應 — 改之前貼出該斷言確認係 route rename 影響，唔係行為回歸）

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx vite.config.ts src/pwaConfig.test.ts src/App.test.tsx
git commit -m "feat: wire today page into app shell and PWA start_url"
```

---

### Task 11: Playwright — 抽 `tests/ui/helpers.ts` + 更新 dashboard.spec nav labels

**Files:**
- Create: `tests/ui/helpers.ts`
- Modify: `tests/ui/dashboard.spec.ts`

**Interfaces:**
- Produces: `tests/ui/helpers.ts` export `mockApi`、`Scenario` type、同埋 spec 入面嘅 entry/payload builders（由 dashboard.spec.ts 原封搬出）。dashboard.spec.ts 改做 import；行為零改變。

- [ ] **Step 1: 搬 code**

將 `tests/ui/dashboard.spec.ts:7`（`Scenario` type）、`:164-267`（`mockApi` 全 function）同埋佢用到嘅 payload/entry builder（spec 頂部嘅 fixture 數據）搬入新檔 `tests/ui/helpers.ts`，加 `export`。`dashboard.spec.ts` 改做：

```ts
import { DASHBOARD_MODE_STORAGE_KEY } from "../../src/dashboardMode";
import { mockApi } from "./helpers";
```

（`DASHBOARD_MODE_STORAGE_KEY` 如果只有 addInitScript 用就留喺 spec；`mockApi` 內部用到嘅就搬埋。）

⚠️ **mockApi 內嘅 `addInitScript` 寫 `"pro"` 嗰段要改**：抽出嚟做 optional param，等 today.spec 可以唔行 pro：

```ts
async function mockApi(
  page: Page,
  scenario: Scenario,
  options: {
    status?: number;
    dashboardMode?: "simple" | "pro"; // default "pro"（保持 dashboard.spec 現行行為）
    onLogin?: Parameters<Page["route"]>[1];
    onLogout?: Parameters<Page["route"]>[1];
  } = {},
) {
  // ... addInitScript 用 options.dashboardMode ?? "pro"
}
```

- [ ] **Step 2: 更新 nav label 斷言**

`dashboard.spec.ts` L86-102 嘅 `getByRole("link", { name: ... })`：
- `"全部賽事"` → `"賽程"`
- `"完場紀錄"` → `"紀錄"`
- `"模型健康"` → `"分析"`
- `"值得買"` → `"今日"`

`page.goto("/#/dashboard")`（7 處）**唔使改** — alias 會落 today 頁，pro mode 照出 BuyDashboard。

- [ ] **Step 3: 跑現有 spec 確認 32/32 綠（回歸）**

先 build，再 PowerShell：
```powershell
npm.cmd run test:ui:only
```
Expected: 32/32 PASS。如有 fail，逐個對 — 只應該係 label/rename 相關，唔接受行為回歸。

- [ ] **Step 4: Commit**

```bash
git add tests/ui/helpers.ts tests/ui/dashboard.spec.ts
git commit -m "test: extract Playwright mockApi helper, update nav labels"
```

---

### Task 12: Playwright `today.spec.ts`（4 viewports）

**Files:**
- Create: `tests/ui/today.spec.ts`

**Interfaces:**
- Consumes: Task 11 `helpers.ts` 嘅 `mockApi`（用 `dashboardMode: "simple"`）。依賴 `authenticated` scenario 嘅 odds payload 會產生 ≥1 個 buy opportunity（同 dashboard.spec pro mode 斷言嘅係同一條 pipeline）。

- [ ] **Step 1: 寫 spec**

Create `tests/ui/today.spec.ts`：

```ts
import { expect, test } from "@playwright/test";
import { mockApi } from "./helpers";

test.beforeEach(async ({ page }) => {
  await mockApi(page, "authenticated", { dashboardMode: "simple" });
});

test("today page shows pick cards with three-line summary", async ({ page }) => {
  await page.goto("/#/today");
  await expect(page.locator("h1")).toContainText("今日");
  const card = page.locator(".pick-card").first();
  await expect(card).toBeVisible();
  await expect(card.locator(".pick-card__selection")).toContainText("買：");
  await expect(card.locator(".pick-card__odds")).toBeVisible();
});

test("pick card expands in place to show edge and stake", async ({ page }) => {
  await page.goto("/#/today");
  const card = page.locator(".pick-card").first();
  await card.locator("summary").click();
  await expect(card).toHaveAttribute("open", "");
  await expect(card.locator(".pick-card__details")).toContainText("Edge +");
  await expect(card.locator(".pick-card__details")).toContainText("建議注碼 $");
});

test("legacy #/dashboard lands on today page", async ({ page }) => {
  await page.goto("/#/dashboard");
  await expect(page.locator(".today-page")).toBeVisible();
});

test("empty scenario shows a friendly no-pick message", async ({ page }) => {
  await mockApi(page, "empty", { dashboardMode: "simple" });
  await page.goto("/#/today");
  await expect(page.locator(".today-empty")).toBeVisible();
  await expect(page.locator(".today-empty")).toContainText(/冇波睇|冇盤值博/);
});

test("freshness bar is visible with role status", async ({ page }) => {
  await page.goto("/#/today");
  await expect(page.locator(".freshness-bar")).toHaveAttribute("role", "status");
});
```

- [ ] **Step 2: 跑新 spec**

```powershell
npm.cmd run test:ui:only
```
Expected: 32 + 5×4 viewports = 52 tests 全綠。

⚠️ 如果「pick cards」test fail 因為 `authenticated` scenario 冇產生 opportunities：打開 `tests/ui/helpers.ts` 檢查 payload 嘅 odds/chance 係咪過到 3% edge + kickoff 未來（payload 時間可能 hardcode 咗過去日期 — 將 `commenceTime` 改做相對 `Date.now()` 嘅未來時間）。**唔准**為咗過 test 改 `BUY_EDGE_THRESHOLD` 或產品 code。

- [ ] **Step 3: Commit**

```bash
git add tests/ui/today.spec.ts
git commit -m "test: add Playwright coverage for today page"
```

---

### Task 13: 全量回歸 + 收尾

**Files:** —

- [ ] **Step 1: 全量檢查**

```bash
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/vite/bin/vite.js build
```
然後 PowerShell `npm.cmd run test:ui:only`。
Expected: Vitest 全綠（196 + 新增 ~29）、tsc 零錯、build 成功、Playwright 52/52 綠。

- [ ] **Step 2: 紅線自查**

```bash
git diff v1.0.2 --stat -- src/pages/BuyDashboard.tsx src/pages/BuyDashboard.test.tsx src/odds.ts src/totals.ts src/asianTotals.ts src/corners.ts src/handicap.ts src/buyCandidates.ts src/buyOpportunities.ts src/marketCalibration.ts src/picks.ts
```
Expected: 空白（零改動）。

- [ ] **Step 3: grep 殘留舊 label/route**

```bash
grep -rn "值得買\"\|全部賽事\"\|完場紀錄\"\|模型健康\"" src/ tests/ --include="*.ts" --include="*.tsx"
grep -rn "#/dashboard" src/ tests/ index.html vite.config.ts
```
Expected: 第一條零結果；第二條只應出現喺 alias 相關嘅 route/test 檔（`route.ts`、`route.test.ts`、`dashboard.spec.ts` 嘅 legacy goto、`today.spec.ts` 嘅 alias test）。

- [ ] **Step 4: Final commit（如有執漏）**

```bash
git add -A
git commit -m "chore: phase A regression sweep"
```

---

## 部署（完成全部 task 後，跟 runbook）

純前端改動 → 淨 rebuild caddy：`pg_dump` 備份 → `docker tag odds-tool-caddy:latest odds-tool-caddy:rollback` → build caddy → smoke → 乾淨 browser profile 驗證（stale SW 教訓，master handoff §11.3 #6）。詳細指令：`docs/runbooks/production-deployment.md`。**部署係 owner 批准先好做。**

## Self-review 記錄

- Spec coverage：§2.1 導航（Task 1/2/10）、§2.2 首頁三層（Task 5/6/7）、§3 hero 細節（Task 3/4/7）、§5 測試策略（各 task RED→GREEN + Task 11/12/13）。§2.3–2.5 屬 Phase B/C，唔喺呢份 plan。
- 已知偏離（已記入 spec §3.2）：per-pick 時間戳 → page 級「賠率同步於」；分析 link Phase A 指 `#/fixtures/<id>`。
- Type consistency：`BuyOpportunity`/`Fixture`/`TeamLogoMap`/`StorageLike` 全部同現有 codebase 核對過（探索報告 2026-07-21）。
