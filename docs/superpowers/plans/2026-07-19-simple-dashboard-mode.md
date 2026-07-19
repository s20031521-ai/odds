# 極簡 / 專業雙模式 Dashboard 實作計劃

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dashboard(`#/dashboard`)加「極簡 / 專業」toggle:極簡版每張卡直接列晒該場所有過關投注項目,專業版係現有完整畫面,選擇存 localStorage。

**Architecture:** 新增 `SimpleDashboard`(極簡 view)同 `DashboardPage`(mode state + toggle wrapper),現有 `BuyDashboard` 一個字都唔改、直接做專業 view。Mode 嘅讀寫抽成純函數 `dashboardMode.ts`(StorageLike 注入,跟 `predictionSnapshots.ts` 嘅 pattern),因為 vitest 行 node 冇 DOM/localStorage,互動邏輯必須抽離先測到。

**Tech Stack:** React 19 + TypeScript + Vite + vitest(`renderToStaticMarkup`,node 環境)。

**Spec:** `docs/superpowers/specs/2026-07-19-simple-dashboard-mode-design.md`

## Global Constraints

- `src/pages/BuyDashboard.tsx` 同 `src/pages/BuyDashboard.test.tsx` **唔准改**,一個字都唔改。
- 3% edge 門檻同 `buyOpportunities.ts` 邏輯唔准改;今次只改 presentation。
- 「買得過」定義 = `BuyOpportunity` 嘅 `primary` + `alternatives`(全部已過 3% edge),極簡卡每一行都係買得過嘅盤:3 個過關顯示 3 行,1 個顯示 1 行,唔過關嘅嘢唔會出現。
- localStorage key 係 `dashboard-mode`,值係 `"simple" | "pro"`,預設(包括無效值、讀寫失敗)一律係 `"simple"`。
- 測試環境係 node(vitest `include: ["src/**/*.test.{ts,tsx}"]`),冇 jsdom/testing-library;component 測試用 `react-dom/server` 嘅 `renderToStaticMarkup`。
- `src/App.tsx` 係 CRLF 混合換行,Edit 時要用檔案實際換行。
- 每個 task 完咗要 commit;收工前 `npm test` + `npm run build` 全綠。

---

### Task 1: `dashboardMode.ts` — mode 讀寫純函數

**Files:**
- Create: `src/dashboardMode.ts`
- Test: `src/dashboardMode.test.ts`

**Interfaces:**
- Produces(之後 Task 3 會用):
  - `type DashboardMode = "simple" | "pro"`
  - `DASHBOARD_MODE_STORAGE_KEY: "dashboard-mode"`
  - `interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }`
  - `readDashboardMode(storage?: StorageLike): DashboardMode`
  - `writeDashboardMode(mode: DashboardMode, storage?: StorageLike): void`

- [ ] **Step 1: 寫 failing test** — 建立 `src/dashboardMode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DASHBOARD_MODE_STORAGE_KEY,
  readDashboardMode,
  writeDashboardMode,
  type StorageLike,
} from "./dashboardMode";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: StorageLike = {
    getItem: (key) => (data.has(key) ? data.get(key)! : null),
    setItem: (key, value) => { data.set(key, value); },
  };
  return { storage, data };
}

describe("readDashboardMode", () => {
  it("defaults to simple when storage is missing or empty", () => {
    expect(readDashboardMode(undefined)).toBe("simple");
    expect(readDashboardMode(fakeStorage().storage)).toBe("simple");
  });

  it("returns pro only for the exact stored value pro", () => {
    expect(readDashboardMode(fakeStorage({ [DASHBOARD_MODE_STORAGE_KEY]: "pro" }).storage)).toBe("pro");
  });

  it("treats invalid stored values as simple", () => {
    expect(readDashboardMode(fakeStorage({ [DASHBOARD_MODE_STORAGE_KEY]: "weird" }).storage)).toBe("simple");
  });

  it("falls back to simple when storage throws", () => {
    const broken: StorageLike = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    };
    expect(readDashboardMode(broken)).toBe("simple");
  });
});

describe("writeDashboardMode", () => {
  it("persists the mode under the canonical key", () => {
    const { storage, data } = fakeStorage();
    writeDashboardMode("pro", storage);
    expect(data.get(DASHBOARD_MODE_STORAGE_KEY)).toBe("pro");
  });

  it("does not throw when storage is missing or broken", () => {
    expect(() => writeDashboardMode("pro", undefined)).not.toThrow();
    const broken: StorageLike = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    };
    expect(() => writeDashboardMode("simple", broken)).not.toThrow();
  });
});
```

- [ ] **Step 2: 行測試確認 fail**

Run: `npx vitest run src/dashboardMode.test.ts`
Expected: FAIL,`Failed to resolve import "./dashboardMode"`

- [ ] **Step 3: 實作** — 建立 `src/dashboardMode.ts`:

```ts
export type DashboardMode = "simple" | "pro";

export const DASHBOARD_MODE_STORAGE_KEY = "dashboard-mode";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function readDashboardMode(storage: StorageLike | undefined = defaultStorage()): DashboardMode {
  try {
    return storage?.getItem(DASHBOARD_MODE_STORAGE_KEY) === "pro" ? "pro" : "simple";
  } catch {
    return "simple";
  }
}

export function writeDashboardMode(mode: DashboardMode, storage: StorageLike | undefined = defaultStorage()): void {
  try {
    storage?.setItem(DASHBOARD_MODE_STORAGE_KEY, mode);
  } catch {
    // 私隱模式等寫入失敗:忽略,mode 只維持喺記憶體。
  }
}
```

- [ ] **Step 4: 行測試確認 pass**

Run: `npx vitest run src/dashboardMode.test.ts`
Expected: PASS,6 個 test 全過

- [ ] **Step 5: Commit**

```bash
git add src/dashboardMode.ts src/dashboardMode.test.ts
git commit -m "feat: add dashboard mode storage helpers"
```

---

### Task 2: `SimpleDashboard` — 極簡卡片 view

**Files:**
- Create: `src/pages/SimpleDashboard.tsx`
- Test: `src/pages/SimpleDashboard.test.tsx`
- Modify: `src/styles/dashboard.css`(append,唔改現有 rules)

**Interfaces:**
- Consumes: `BuyOpportunity`、`BuyPick` from `src/buyOpportunities.ts`(`primary: BuyPick`、`alternatives: BuyPick[]`;`BuyPick = { market, selection, line?, odds, chance, edge, bookmaker }`)
- Produces(Task 3 會用):
  - `SimpleDashboard(props: { opportunities: BuyOpportunity[]; generatedAt: string | null; dataFresh: boolean }): React.ReactElement`
  - CSS class:`simple-dashboard`、`simple-dashboard__header`、`simple-dashboard__sync`、`simple-dashboard__grid`、`simple-dashboard__empty`、`simple-card`、`simple-card__link`、`simple-card__meta`、`simple-card__picks`

注意:`formatSelection` / `formatOdds` / `formatDate` / `pickKey` 呢啲小 helper 喺 `SimpleDashboard.tsx` 內部自己寫一份(同 BuyDashboard 嗰份一樣),因為 BuyDashboard 唔准改、唔可以 export 出嚟。

- [ ] **Step 1: 寫 failing test** — 建立 `src/pages/SimpleDashboard.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuyOpportunity } from "../buyOpportunities";
import { SimpleDashboard } from "./SimpleDashboard";

const opportunities: BuyOpportunity[] = [
  {
    matchId: "match-1",
    homeTeam: "Home",
    awayTeam: "Away",
    homeTeamZh: "主隊",
    awayTeamZh: "客隊",
    commenceTime: "2026-07-17T12:00:00Z",
    league: "English Premier League",
    leagueZh: "英格蘭超級聯賽",
    primary: { market: "主客和", selection: "主隊", odds: 2.1, chance: 0.52, edge: 0.092, bookmaker: "Alpha" },
    alternatives: [
      { market: "大細波", selection: "大", line: 2.5, odds: 2, chance: 0.54, edge: 0.08, bookmaker: "Beta" },
    ],
  },
  {
    matchId: "match-2",
    homeTeam: "Second Home",
    awayTeam: "Second Away",
    commenceTime: "2026-07-18T12:00:00Z",
    league: "Liga MX",
    primary: { market: "角球", selection: "細角", line: 9.5, odds: 1.95, chance: 0.55, edge: 0.0725, bookmaker: "Gamma" },
    alternatives: [],
  },
];

describe("SimpleDashboard", () => {
  it("renders one card per qualifying match with every qualifying pick as its own row", () => {
    const markup = renderToStaticMarkup(<SimpleDashboard opportunities={opportunities} generatedAt="2026-07-16T12:34:00Z" dataFresh />);

    expect(markup.match(/<article/g) ?? []).toHaveLength(2);
    // match-1 有 2 個過關盤、match-2 有 1 個:合共 3 行,一行都唔多唔少
    expect(markup.match(/<li/g) ?? []).toHaveLength(3);
    expect(markup).toContain("主客和 · 主隊");
    expect(markup).toContain("大細波 · 大 2.5");
    expect(markup).toContain("角球 · 細角 9.5");
    expect(markup).toContain("2.10");
    expect(markup).toContain("1.95");
    expect(markup).toContain('href="#/fixtures/match-1"');
  });

  it("renders Chinese league and team names with English fallback, plus kickoff time", () => {
    const markup = renderToStaticMarkup(<SimpleDashboard opportunities={opportunities} generatedAt="now" dataFresh />);

    expect(markup).toContain("英格蘭超級聯賽");
    expect(markup).toContain("Liga MX");
    expect(markup).toContain("<h2>主隊 <span>vs</span> 客隊</h2>");
    expect(markup).toContain("<h2>Second Home <span>vs</span> Second Away</h2>");
    expect(markup).toContain('dateTime="2026-07-17T12:00:00Z"');
  });

  it("shows no detail numbers: no bookmaker, chance or edge anywhere", () => {
    const markup = renderToStaticMarkup(<SimpleDashboard opportunities={opportunities} generatedAt="now" dataFresh />);

    expect(markup).not.toContain("Alpha");
    expect(markup).not.toContain("52.00%");
    expect(markup).not.toContain("9.20%");
    expect(markup).not.toContain("KPI");
  });

  it("renders the minimal empty state without the all-fixtures link", () => {
    const markup = renderToStaticMarkup(<SimpleDashboard opportunities={[]} generatedAt="now" dataFresh />);

    expect(markup).toContain("暫時冇場次過關");
    expect(markup).not.toContain("#/fixtures");
  });

  it("hides all picks when data is stale", () => {
    const markup = renderToStaticMarkup(<SimpleDashboard opportunities={opportunities} generatedAt="now" dataFresh={false} />);

    expect(markup).toContain("資料未更新，暫停顯示買盤。");
    expect(markup).not.toContain("<article");
  });

  it("keeps the sync line and discloses when no sync has succeeded", () => {
    const markup = renderToStaticMarkup(
      <SimpleDashboard opportunities={[]} generatedAt={null} dataFresh={false} />,
    );

    expect(markup).toContain("同步時間");
    expect(markup).toContain("未有成功同步");
  });
});
```

- [ ] **Step 2: 行測試確認 fail**

Run: `npx vitest run src/pages/SimpleDashboard.test.tsx`
Expected: FAIL,`Failed to resolve import "./SimpleDashboard"`

- [ ] **Step 3: 實作** — 建立 `src/pages/SimpleDashboard.tsx`:

```tsx
import type { BuyOpportunity, BuyPick } from "../buyOpportunities";

export function SimpleDashboard(props: {
  opportunities: BuyOpportunity[];
  generatedAt: string | null;
  dataFresh: boolean;
}): React.ReactElement {
  const activeOpportunities = props.dataFresh ? props.opportunities : [];

  return (
    <section className="simple-dashboard" aria-labelledby="simple-dashboard-title">
      <header className="simple-dashboard__header">
        <h1 id="simple-dashboard-title">值得買</h1>
        <p className="simple-dashboard__sync">同步時間 {props.generatedAt ? <time dateTime={props.generatedAt}>{props.generatedAt}</time> : "未有成功同步"}</p>
      </header>

      {!props.dataFresh ? (
        <div className="simple-dashboard__empty" role="status">資料未更新，暫停顯示買盤。</div>
      ) : activeOpportunities.length === 0 ? (
        <div className="simple-dashboard__empty">暫時冇場次過關</div>
      ) : (
        <div className="simple-dashboard__grid">
          {activeOpportunities.map((opportunity) => (
            <SimpleCard key={opportunity.matchId} opportunity={opportunity} />
          ))}
        </div>
      )}
    </section>
  );
}

function SimpleCard({ opportunity }: { opportunity: BuyOpportunity }): React.ReactElement {
  const picks = [opportunity.primary, ...opportunity.alternatives];
  const league = opportunity.leagueZh ?? opportunity.league;

  return (
    <article className="simple-card">
      <a className="simple-card__link" href={`#/fixtures/${encodeURIComponent(opportunity.matchId)}`}>
        <p className="simple-card__meta">
          {league ? `${league} · ` : ""}<time dateTime={opportunity.commenceTime}>{formatDate(opportunity.commenceTime)}</time>
        </p>
        <h2>{opportunity.homeTeamZh ?? opportunity.homeTeam} <span>vs</span> {opportunity.awayTeamZh ?? opportunity.awayTeam}</h2>
        <ul className="simple-card__picks">
          {picks.map((pick) => (
            <li key={pickKey(pick)}>
              <span>{pick.market} · {formatSelection(pick)}</span>
              <strong>{formatOdds(pick.odds)}</strong>
            </li>
          ))}
        </ul>
      </a>
    </article>
  );
}

function formatSelection(pick: BuyPick): string {
  return pick.line === undefined ? pick.selection : `${pick.selection} ${formatLine(pick.line)}`;
}

function formatLine(line: number): string {
  return `${line > 0 ? "+" : ""}${Number.isInteger(line) ? line.toFixed(1) : line}`;
}

function formatOdds(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "—";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function pickKey(pick: BuyPick): string {
  return `${pick.market}|${pick.line ?? ""}|${pick.selection}|${pick.bookmaker}`;
}
```

- [ ] **Step 4: 行測試確認 pass**

Run: `npx vitest run src/pages/SimpleDashboard.test.tsx`
Expected: PASS,6 個 test 全過

- [ ] **Step 5: 加 CSS** — append 落 `src/styles/dashboard.css` 尾(現有 193 行全部唔郁):

```css
.simple-dashboard {
  display: grid;
  gap: 20px;
}

.simple-dashboard__header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
}

.simple-dashboard__header h1 {
  margin: 0;
}

.simple-dashboard__sync,
.simple-card__meta {
  color: var(--color-muted);
}

.simple-dashboard__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
  gap: 16px;
}

.simple-card {
  border: 1px solid color-mix(in srgb, var(--color-positive) 45%, transparent);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  overflow: hidden;
}

.simple-card__link {
  display: grid;
  gap: 10px;
  padding: 18px;
  color: inherit;
  text-decoration: none;
}

.simple-card__meta {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 500;
}

.simple-card h2 {
  margin: 0;
  font-size: 1.15rem;
}

.simple-card h2 span {
  color: var(--color-muted);
  font-weight: 500;
}

.simple-card__picks {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 10px 0 0;
  border-top: 1px solid color-mix(in srgb, var(--color-primary) 35%, transparent);
  list-style: none;
}

.simple-card__picks li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.simple-card__picks strong {
  color: var(--color-positive);
  font-size: 1.05rem;
}

.simple-dashboard__empty {
  border: 1px solid color-mix(in srgb, var(--color-primary) 35%, transparent);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  padding: 32px 20px;
  text-align: center;
}

@media (max-width: 720px) {
  .simple-dashboard__grid {
    grid-template-columns: 1fr;
  }

  .simple-dashboard__header {
    align-items: start;
    flex-direction: column;
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/pages/SimpleDashboard.tsx src/pages/SimpleDashboard.test.tsx src/styles/dashboard.css
git commit -m "feat: add minimal simple dashboard view"
```

---

### Task 3: `DashboardPage` — toggle wrapper

**Files:**
- Create: `src/pages/DashboardPage.tsx`
- Test: `src/pages/DashboardPage.test.tsx`
- Modify: `src/styles/dashboard.css`(append toggle styles)

**Interfaces:**
- Consumes:
  - `readDashboardMode(storage?: StorageLike): DashboardMode`、`writeDashboardMode(mode, storage?): void`、`type DashboardMode`、`type StorageLike` from `src/dashboardMode.ts`(Task 1)
  - `SimpleDashboard(props)` from `src/pages/SimpleDashboard.tsx`(Task 2)
  - `BuyDashboard(props)` from `src/pages/BuyDashboard.tsx`(唔改佢)
- Produces(Task 4 會用):
  - `DashboardPage(props: { opportunities: BuyOpportunity[]; generatedAt: string | null; dataFresh: boolean; storage?: StorageLike }): React.ReactElement`
  - CSS class:`dashboard-mode-bar`

設計說明:toggle 係一條右齊嘅模式欄,擺喺兩個 view 上面;專業 mode 會見到 BuyDashboard 自己嘅完整 header(標題 + 同步時間),極簡 mode 見到 SimpleDashboard 嘅精簡 header。`storage` prop 係 dependency injection,俾測試(node 冇 localStorage)可以模擬已儲存嘅模式;browser 入面唔傳就用預設 localStorage。

- [ ] **Step 1: 寫 failing test** — 建立 `src/pages/DashboardPage.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuyOpportunity } from "../buyOpportunities";
import { DASHBOARD_MODE_STORAGE_KEY, type StorageLike } from "../dashboardMode";
import { DashboardPage } from "./DashboardPage";

const opportunities: BuyOpportunity[] = [
  {
    matchId: "match-1",
    homeTeam: "Home",
    awayTeam: "Away",
    commenceTime: "2026-07-17T12:00:00Z",
    primary: { market: "主客和", selection: "主隊", odds: 2.1, chance: 0.52, edge: 0.092, bookmaker: "Alpha" },
    alternatives: [],
  },
];

function storageWith(value: string): StorageLike {
  return {
    getItem: (key) => (key === DASHBOARD_MODE_STORAGE_KEY ? value : null),
    setItem: () => {},
  };
}

describe("DashboardPage", () => {
  it("defaults to simple mode when nothing is stored", () => {
    const markup = renderToStaticMarkup(<DashboardPage opportunities={opportunities} generatedAt="now" dataFresh />);

    expect(markup).toContain("simple-dashboard");
    expect(markup).not.toContain("buy-dashboard__kpis");
    expect(markup).toMatch(/aria-pressed="true"[^>]*>極簡<\/button>/);
    expect(markup).toMatch(/aria-pressed="false"[^>]*>專業<\/button>/);
  });

  it("renders the pro dashboard when pro is stored", () => {
    const markup = renderToStaticMarkup(
      <DashboardPage opportunities={opportunities} generatedAt="now" dataFresh storage={storageWith("pro")} />,
    );

    expect(markup).toContain("buy-dashboard__kpis");
    expect(markup).toContain("值得買 Dashboard");
    expect(markup).not.toContain("simple-dashboard");
    expect(markup).toMatch(/aria-pressed="true"[^>]*>專業<\/button>/);
  });

  it("treats invalid stored values as simple", () => {
    const markup = renderToStaticMarkup(
      <DashboardPage opportunities={opportunities} generatedAt="now" dataFresh storage={storageWith("junk")} />,
    );

    expect(markup).toContain("simple-dashboard");
  });

  it("keeps the toggle available in the stale state", () => {
    const markup = renderToStaticMarkup(<DashboardPage opportunities={[]} generatedAt={null} dataFresh={false} />);

    expect(markup).toContain("dashboard-mode-bar");
    expect(markup).toContain("資料未更新，暫停顯示買盤。");
  });
});
```

- [ ] **Step 2: 行測試確認 fail**

Run: `npx vitest run src/pages/DashboardPage.test.tsx`
Expected: FAIL,`Failed to resolve import "./DashboardPage"`

- [ ] **Step 3: 實作** — 建立 `src/pages/DashboardPage.tsx`:

```tsx
import { useState } from "react";
import type { BuyOpportunity } from "../buyOpportunities";
import {
  readDashboardMode,
  writeDashboardMode,
  type DashboardMode,
  type StorageLike,
} from "../dashboardMode";
import { BuyDashboard } from "./BuyDashboard";
import { SimpleDashboard } from "./SimpleDashboard";

const MODE_ORDER = ["simple", "pro"] as const;
const MODE_LABELS: Record<DashboardMode, string> = { simple: "極簡", pro: "專業" };

export function DashboardPage(props: {
  opportunities: BuyOpportunity[];
  generatedAt: string | null;
  dataFresh: boolean;
  storage?: StorageLike;
}): React.ReactElement {
  const [mode, setMode] = useState<DashboardMode>(() => readDashboardMode(props.storage));

  function selectMode(next: DashboardMode): void {
    setMode(next);
    writeDashboardMode(next, props.storage);
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-mode-bar" role="group" aria-label="顯示模式">
        {MODE_ORDER.map((value) => (
          <button
            aria-pressed={mode === value}
            key={value}
            onClick={() => selectMode(value)}
            type="button"
          >
            {MODE_LABELS[value]}
          </button>
        ))}
      </div>
      {mode === "pro" ? (
        <BuyDashboard opportunities={props.opportunities} generatedAt={props.generatedAt} dataFresh={props.dataFresh} />
      ) : (
        <SimpleDashboard opportunities={props.opportunities} generatedAt={props.generatedAt} dataFresh={props.dataFresh} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: 行測試確認 pass**

Run: `npx vitest run src/pages/DashboardPage.test.tsx`
Expected: PASS,4 個 test 全過

- [ ] **Step 5: 加 toggle CSS** — append 落 `src/styles/dashboard.css` 尾:

```css
.dashboard-mode-bar {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-bottom: 16px;
}

.dashboard-mode-bar button {
  min-height: var(--touch-target);
  padding: 8px 14px;
  border: 1px solid var(--color-primary);
  border-radius: 999px;
  color: var(--color-text);
  background: transparent;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.dashboard-mode-bar button[aria-pressed="true"] {
  color: var(--color-bg);
  background: var(--color-primary);
}
```

- [ ] **Step 6: Commit**

```bash
git add src/pages/DashboardPage.tsx src/pages/DashboardPage.test.tsx src/styles/dashboard.css
git commit -m "feat: add simple/pro mode toggle wrapper"
```

---

### Task 4: 接入 `App.tsx` + 全套驗證

**Files:**
- Modify: `src/App.tsx`(import 一行 + dashboard 渲染一行;注意檔案係 CRLF 混合換行,Edit 要用實際換行)

**Interfaces:**
- Consumes: `DashboardPage(props)` from `src/pages/DashboardPage.tsx`(Task 3)
- Produces: 無新介面;`#/dashboard` 行為改變。

- [ ] **Step 1: 改 import** — `src/App.tsx` 第 25 行:

```ts
import { BuyDashboard } from "./pages/BuyDashboard";
```

改做:

```ts
import { DashboardPage } from "./pages/DashboardPage";
```

(先 grep 確認 `BuyDashboard` 喺 App.tsx 淨係出現喺呢兩處先好改。)

- [ ] **Step 2: 改 dashboard 渲染** — 第 443 行:

```tsx
<BuyDashboard opportunities={buyOpportunities} generatedAt={lastSuccessfulSync} dataFresh={opportunitiesTrusted} />
```

改做:

```tsx
<DashboardPage opportunities={buyOpportunities} generatedAt={lastSuccessfulSync} dataFresh={opportunitiesTrusted} />
```

- [ ] **Step 3: 行全套測試**

Run: `npm test`
Expected: 全綠,包括原有 `BuyDashboard.test.tsx`、`App.test.tsx` 冇改過都照過

如果 `App.test.tsx` 有斷言講 dashboard 直出 `BuyDashboard` 內容(例如「值得買 Dashboard」標題),而而家預設係極簡,可能要檢視 — 但 Global Constraint 係唔准改 `BuyDashboard.test.tsx`;`App.test.tsx` 如有需要可以改,將極簡預設嘅預期寫埋入去。改之前先睇清楚個 test 斷言咩。

- [ ] **Step 4: 行 build**

Run: `npm run build`
Expected: `tsc --noEmit` 無 error,vite build 成功

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: route dashboard through simple/pro mode page"
```
