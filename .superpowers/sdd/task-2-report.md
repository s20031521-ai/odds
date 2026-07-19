# Task 2 Report — `SimpleDashboard` 極簡卡片 view

**Status:** DONE_WITH_CONCERNS(一處 brief 內部矛盾,已按 TDD 原則處理,詳見下文)
**Branch:** `feature/simple-dashboard-mode`
**Commit:** `e20e54b` — `feat: add minimal simple dashboard view`

## 做咗咩

1. **Step 1 — failing test**:逐字建立 `src/pages/SimpleDashboard.test.tsx`(6 個 test,同 brief 一字不差)。
2. **Step 2 — 確認 fail**:
   `node node_modules/vitest/vitest.mjs run src/pages/SimpleDashboard.test.tsx`
   → FAIL,`Cannot find module './SimpleDashboard'`(同 brief 預期嘅 resolve error 等價)。
3. **Step 3 — 實作**:建立 `src/pages/SimpleDashboard.tsx`,結構、props、CSS class 全部按 brief(`simple-dashboard`、`simple-dashboard__header`、`__sync`、`__grid`、`__empty`、`simple-card`、`simple-card__link`、`__meta`、`__picks` 齊晒)。helper(`formatSelection` / `formatOdds` / `formatDate` / `pickKey`)喺檔案內部自己寫,冇掂 `BuyDashboard.tsx`。
4. **Step 4 — 確認 pass**:同一指令 → **6/6 passed**。
5. **Step 5 — CSS**:用 `cat >>` append 落 `src/styles/dashboard.css` 尾。`git diff --stat` 顯示 **98 insertions, 0 deletions**,原有 193 行一字未郁(193 → 291 行)。
6. **Step 6 — Commit**:`e20e54b`,淨係 add 咗 brief 指定嘅三個檔案。

## 額外驗證

- 全套測試:`node node_modules/vitest/vitest.mjs run` → **27 files / 179 tests 全過**(包括現有 `BuyDashboard.test.tsx` 9 個,無 regression)。
- 類型檢查:`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` → 通過(`React.ReactElement` 無 import 都用得,同 BuyDashboard 一樣,因 @types/react 有全局 namespace)。

## ⚠️ Concern:Brief 內部矛盾,偏離咗一處實作 code

Brief 嘅測試同實作 code **互相矛盾,兩者唔可以同時逐字照用**:

- 測試(brief line 58–59)期望:`大細波 · 大 2.5` 同 `角球 · 細角 9.5` —— **無 `+` 號**。
- 但 brief 嘅 `formatLine`(同 BuyDashboard 嗰份一樣)係 `` `${line > 0 ? "+" : ""}...` `` —— 會輸出 `大 +2.5` / `細角 +9.5`,測試必 fail。

**處理方式(按 TDD 原則,test 係 executable spec):**
- 測試檔 **逐字保留,一字未改**。
- `SimpleDashboard.tsx` 嘅 `formatLine` 拎走咗 `line > 0 ? "+" : ""` 前綴,改為:
  ```ts
  function formatLine(line: number): string {
    return `${Number.isInteger(line) ? line.toFixed(1) : line}`;
  }
  ```
- 影響:極簡模式下,line 顯示為 `2.5` / `9.5` 而唔係 `+2.5` / `+9.5`。淨係影響 SimpleDashboard 內部顯示;`BuyDashboard.tsx` 完全無郁,Task 3 依賴嘅 props signature 同 CSS class 全部不受影響。
- 如果 parent 認為應該反過來(實作保留 `+`、改測試),改動範圍好細,話我知即改。

## Self-review checklist

- [x] 測試先寫、確認 fail、再實作、確認 pass(TDD 次序)
- [x] `BuyDashboard.tsx` / `BuyDashboard.test.tsx` 無掂過(`git show --stat HEAD` 得三個檔案)
- [x] `dashboard.css` 純 append,0 deletions
- [x] 無 bookmaker / chance / edge / KPI 喺極簡 view 輸出(test 3 把關)
- [x] stale 時隱藏所有 card;`generatedAt=null` 顯示「未有成功同步」
- [x] 全套測試 + tsc 通過
- [x] vitest 用 `node node_modules/vitest/vitest.mjs`(npx 唔喺 PATH)
