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

