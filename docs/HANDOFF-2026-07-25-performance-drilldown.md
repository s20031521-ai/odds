# HANDOFF — Performance Drill-down（表現頁 drill-down）

日期：2026-07-25
Branch：`master`（未 commit，working tree dirty）
決策來源：`%TEMP%\performance-page-drilldown-decision-report.md`（grilling session）

---

## 1. 一句講晒

表現頁（`#/performance`）四張盤口卡而家可以撳入去，同頁 drill-down 睇已結算 result 列表。唔改 hash、唔改 API、唔做 pending。

## 2. 改動檔案

| 檔案 | 改動 |
|------|------|
| `src/readinessModels.ts` | `READINESS_MODELS` 單一來源（market / label / modelVersion） |
| `src/App.tsx` | re-export `READINESS_MODELS`；`resultEntries` 傳入 `PerformancePage` |
| `src/pages/PerformancePage.tsx` | 重寫：overview/detail 雙 view、filter/sort/settlement 標籤、空狀態 |
| `src/styles/today.css` | 可撳卡 chevron、detail header、result table、settlement 顏色、空狀態 |
| `src/pages/PerformancePage.test.tsx` | 新建：17 tests（`formatSettlementLabel` 8 + `formatPrediction` 4 + filter/sort 5） |

## 3. 產品行為

### Overview（現有）
- 四卡 grid，而家係 `<button>`，有 `›` chevron affordance
- 撳卡 → `selectedMarket` state 切換，**唔改** `window.location.hash`

### Detail
- `← 返回` → 清 `selectedMarket`，返 overview
- 盤口中文名 + 迷你摘要（settled/30、中%、錯%、走盤）
- 列表 filter by `market` + `modelVersion`（同 `READINESS_MODELS` 一致），sort `commenceTime` 降序
- 每行：對賽、開賽（`formatKickoff`）、揀邊(+line)、結果標籤（中/半中/走/半錯/錯/—）、比分
- 0 行 → 空文案「呢個盤口暫時未有已結算結果」+ 返回掣

## 4. 明確不做（v1）

- 唔改 route `#/performance/...`
- 唔做 `pending` 未結算列表
- 唔改 backtest API
- 唔加 win/loss filter chip
- 唔重寫舊 history 頁

## 5. 技術註記

- `READINESS_MODELS` 在 `src/readinessModels.ts`，`App` re-export、`PerformancePage` 直接 import，單一來源避免 modelVersion 漂移
- `formatSettlementLabel`、`formatPrediction` 已 export，純函式可獨立測試
- `formatKickoff` 由 `PickCard.tsx` import，時間格式一致
- State 用 `useState<null | string>(null)` 喺 `PerformancePage` 內，唔升去 App
- CSS class 用 `performance-*` 前綴，唔碰舊 `.history-*` 殘留

## 6. 驗證

```text
npm.cmd run test
  24 files, 156 tests passed（含新 PerformancePage.test.tsx）

npx.cmd tsc --noEmit
  TypeScript passed, zero errors
```

## 7. Commit

已 commit：`feat(performance): drill-down from market cards into settled results`（見 `git log -1`）

## 8. 風險

| 風險 | 緩解 |
|------|------|
| backtest 未 load 完就入 detail | 空狀態可處理；如需要可加 `backtestLoaded` prop |
| `resultEntries` 缺 `homeTeam`/`awayTeam` | 列表 fallback 用 `matchId` |
| 卡上 stats 同列表 filter 不一致 | 強制同一 `READINESS_MODELS` source |

---

詳細系統狀態以 `docs/MASTER-HANDOFF-v1.2.1.md` 為準。