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
