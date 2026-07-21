# Task 3 Report — `MarketDetailCard` 元件 + `match.css`

## 做咗咩

- **Step 1**: 建立 `src/components/MarketDetailCard.test.tsx`（內容逐字跟 brief，4 個 test：ok 卡面、負 edge、empty、insufficient）。
- **Step 2**: 跑測試確認 fail — `Error: Cannot find module './MarketDetailCard'`（TDD 紅燈確認）。
- **Step 3**: 建立 `src/components/MarketDetailCard.tsx`（內容逐字跟 brief），consume `MarketDetail` from `src/matchDetails.ts`（只 import，冇修改）。
- **Step 4**: 建立 `src/styles/match.css`：
  - `.market-detail-grid`（1 欄，`min-width: 720px` 起 2 欄，gap 0.75rem）— 跟 brief 逐字。
  - `.market-detail-card` — 以 `today.css` `.pick-card` 為模板：`background: var(--color-surface)`、`border: 1px solid var(--color-border)`、`border-radius: var(--radius-card)`、`box-shadow: var(--shadow-soft)`，加 `padding: 16px` 同 `color: var(--color-text)`。
  - `.market-detail-card__selection` / `__odds` / `__bookmaker` — 跟 `.pick-card` 對應 class 嘅 variable 命名（`--color-text`、`--color-primary-text`、`--color-muted`）。
  - `.market-detail-card--empty` — 同卡面，文字 `var(--color-muted)`。
  - 全部顏色/圓角/陰影只用 `tokens.css` 現有 variables，冇發明新色系。
- **Step 4 (import)**: `src/main.tsx` 喺 `import "./styles/today.css";`（line 9）後加 `import "./styles/match.css";`（Edit 工具，冇碰其他行）。
- **Step 5**: 測試 pass + tsc clean（見下）。
- **Step 6**: Commit `0297650` — 只 add brief 指定嘅 4 個檔。

## Test 結果（逐字摘要）

```
 ✓ src/components/MarketDetailCard.test.tsx (4 tests) 6ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
```

全套測試（regression check，brief 冇要求但 self-review 跑咗）：

```
 Test Files  37 passed (37)
      Tests  242 passed (242)
```

## tsc 結果

`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` → exit code 0，冇 error。

## Commit

- Hash: `0297650fb5d0517087cfd824cdcfd982df611430`
- Message: `feat: MarketDetailCard component with match styles`
- Branch: `today-first-phase-b`
- Files: `src/components/MarketDetailCard.tsx`、`src/components/MarketDetailCard.test.tsx`、`src/styles/match.css`、`src/main.tsx`（4 files changed, 140 insertions(+)）

## Self-review

- [x] Test 同 component 代碼逐字跟 brief。
- [x] TDD 流程：先 fail（module not found）→ 實裝 → pass。
- [x] CSS 只用 `tokens.css` variables，卡面視覺跟 `.pick-card` 模板。
- [x] `main.tsx` 只加一行 import，其他行未動（CRLF 行尾冇被攪亂，commit 顯示 `1 +`）。
- [x] 紅線檔全部未掂：commit `--stat` 確認冇 `src/odds.ts`、`src/pages/BuyDashboard.tsx`、`src/matchDetails.ts`。
- [x] YAGNI：冇加 brief 以外嘅 props/狀態/樣式 class（`market-detail-grid` 係 brief 指定畀 Task 4 用）。
- [x] Commit 前工作區已有嘅 `.superpowers/sdd/*` 修改（progress.md、task-2-* 等）係既有改動，唔屬於我呢個 task，冇被加入 commit。

## Concerns

冇。唯一小觀察：git 提示新檔 LF→CRLF 轉換警告，屬正常（`.gitattributes` / autocrlf 處理），唔影響內容。
