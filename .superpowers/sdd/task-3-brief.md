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

