# HANDOFF — Today-first UI Phase C（賽程＋紀錄執整）

日期：2026-07-22
版本：v1.2.0
狀態：✅ 已完成 + merged master（`b9e943c..ed0c8ed`，8 commits）+ **已部署 production（2026-07-22 凌晨）** — rebuild api + caddy 兩個 image，bundle `index-jmHUUAaH.js`，備份 `pre-deploy-20260721-165125.dump`，smoke 全綠。部署中伏一次：git archive 喺 Windows 輸出 CRLF 令 api entrypoint shebang 失效（`exec ... no such file or directory` 不停 restart），改用 `git -c core.autocrlf=false -c core.eol=lf archive` 重打包後順利 — 教訓已寫入 MASTER-HANDOFF §9.4。

---

## 1. 一句講晒

賽程頁 h2h tab 換咗一行式 fixture row（今日/聽日分組標題、聯賽 chips + 隊名搜尋 toolbar、「有貨」mint 點、日內按開賽時間排序）；紀錄頁加咗四模型 readiness 進度條（`X/30 場`）+「等緊開賽」pending 卡（server `/api/v1/backtest` 新 `pending` 陣列供數）+「已完場」分組連賽前快照 `<details>`；順手做埋 owner-approved cleanup：刪 `SimpleDashboard.tsx`、`marketDisplay.ts` dead exports、舊 analysis CSS（11 files +10/−559）。Merged result 全綠：Vitest 233/233、tsc 0 errors、server node:test 9/9、Playwright 84/84 ×2。

## 2. Spec / Plan

- Spec：`docs/superpowers/specs/2026-07-21-today-first-ui-redesign-design.md` §2.3（賽程）/ §2.5（紀錄）（Phase A 時已存在）
- Branch 8 commits：`b9e943c`…`ed0c8ed`（server pending `dda793f` → client plumbing `ca0fff6` → 賽程 `93d1999` / `52a3067` / `be63f00` → 紀錄 `e7df062` → cleanup `b2d24ed` → mocks/e2e `ed0c8ed`）

## 3. 交付物（按範圍）

### 3.1 Server（`dda793f`）

- `server/domain/backtest.mjs` `buildBacktest` return 加 `pending`：未結算 valid-current snapshot 行 `{ id, matchId, market, prediction, line, odds, chance, edge, commenceTime, savedAt, modelVersion, source, status }`（null-able 欄位填 null；status ∈ upcoming/settling/overdue/unknown，180-min 結算寬限；按開賽時間升序）。**冇新 endpoint** — `/api/v1/backtest` response 擴展。

### 3.2 Client plumbing（`ca0fff6`）

- `BacktestResponse.pending`；`ModelReadiness` / `PendingEntry` types + `isModelReadiness` / `isPendingEntry` guards；`readiness` / `pendingEntries` state；`ResultEntry` 加 optional `edge` / `savedAt`；error path 清晒所有 response-owned state；history 頁而家都 auto-load live odds（pending 行先 join 到隊名）。

### 3.3 賽程頁（h2h tab）（`93d1999` / `52a3067` / `be63f00`）

- `src/dashboard.ts` 新 `formatFixtureDayHeading`：今日/聽日前綴按 HK 曆日（`formatFixtureDateHeading` 唔郁，locked test 照舊）。
- 一行式 `.fixture-row`（時間｜對賽｜聯賽｜有貨點｜pick label）取代 h2h tab 嘅三欄卡；`.fixture-card` 其他 tab 保留唔郁。
- 有貨 dot `.fixture-row__buy-dot`（mint `--color-positive`），由 `buyMatchIds` 供（derived from `buyOpportunities`，數據唔可信時 fail-closed）。
- 日內按 commenceTime 排序：display-layer memo `fixtureDayGroupsByTime`（`sortFixturesByBestEdge` 唔郁）。
- Toolbar：聯賽 chips 多選 `.fixture-chip` + 隊名搜尋 `.fixture-search`（中英 case-insensitive）；filter memo `visibleFixtureDayGroups`；空 filter 結果有 empty state；預設 no-op 全部顯示。

### 3.4 紀錄頁（`e7df062`）

- 四模型 readiness 進度條 `.model-readiness`：`READINESS_TARGET = 30`；主客和/consensus-v1、大細波/totals-loo-v1、角球/corner-loo-v1、亞洲讓球/hdc-loo-v2，各顯示 `X/30 場`。
- 每個市場兩組：「等緊開賽」（`PendingCard` `<details>`：隊名經 `fixturesByMatchId` 由 fixtures join，搵唔到 fallback raw matchId；盤口/賠率/模型機率/Edge/模型/快照時間）+「已完場」（原有卡 + `<details className="other-lines">` 賽前快照 block，`hasPredictionSnapshot` gate）。
- Locked 保留：`.empty-state[role="alert"]` error branch、`role="status"` loading branch、`完場對比` h1、`.sample-warning`。

### 3.5 Cleanup（`b2d24ed`，11 files +10/−559，全部 owner-approved）

- 刪 `src/pages/SimpleDashboard.tsx` + test（退役多時，冇任何 import）。
- 刪 `src/marketDisplay.ts` dead exports：PerformanceRow、PerformanceSummary、selectDistinctPerformanceRows、summarizePerformanceRows、currentModelRows、predictionDistribution、calibrationBuckets + private settlementProfit / normalizeDecimal / comparePerformanceRepresentatives / compareFiniteNumbers（連對應測試）；其他全部保留。
- 刪 `src/styles.css` 舊 analysis CSS ~160 行：`.analysis-performance`、`.performance-market-*`、`.model-summary-*`、`.readiness-head`、`.health-tags`、`.performance-detail-grid`、`.performance-bar*`（+ 兩個 dead @media rules + 一行 dead selector）；`.sample-warning` 保留（live）。
- 順手修：`stakeDisplay.test.ts` 過時註解更正；`PickCard` 同步時間改用 `formatKickoff`（唔再 raw ISO，dynamic test assertion）；`TodayPage` 喺 `dataFresh` false 時收埋即將開賽 section（連測試）；`dashboard.spec.ts` flaky 修復（one-shot `expectDashboardColumns` 前等齊 2 個 `.dashboard-card`）。

### 3.6 Mocks / e2e（`ed0c8ed`）

- `entry()` / `total()` 加 optional `league` param；h2h/total mock entries 帶 Premier League / Serie A；`/api/v1/backtest` mock 回 1 settled row + 4 readiness rows + 1 pending row（之前係空陣列）。
- 兩個新 Playwright tests（fixtures toolbar filter + buy dots；history readiness + groups）→ 全 suite 84/84 ×2。

## 4. 關鍵決策 / adjudicated deviations

1. `buyMatchIds` 放喺 `buyOpportunities` 之後（TDZ 限制）。
2. Buy-dot e2e count 係 2 唔係 1：match-boundary 個 case totals edge 啱啱 0.030，inclusive threshold 過關 — 同現有 2 卡 buy dashboard 一致。
3. Tablet responsive-nav test 加咗一行 settle-wait（頁面轉場 race，被豐富咗嘅 mock 暴露）— 唯一非預期 test 改動，additive。

## 5. 測試證據

Merged result 全綠：**Vitest 233/233**、**tsc 0 errors**、**server node:test 9/9**、**Playwright 84/84 ×2**（4 viewports 全量跑咗兩次）。

## 6. Deferred minors（final review triage，全部唔阻 merge）

1. Server `pending` 嘅 "unknown" status / fallback / grace-boundary 路徑冇測試。
2. `PendingEntry.status` 冇渲染上 PendingCard（contract 暫時 write-only）。
3. `READINESS_MODELS` client 端 hardcode 咗 server 模型 registry（兩邊要同步改）。
4. `buildPendingRows` 重複計 settled/commenceByMatch（同 summarizeReadiness dup）。
5. `formatTimeOnly` 重複 pad 邏輯。
6. `fixturesByMatchId` 淨包 h2h — 非 h2h pending 行顯示 raw matchId。
7. 聯賽 chip stale selection 冇 prune（揀咗嘅聯賽消失仲留喺 selection）。
8. `isPendingEntry` 對 numeric fields 檢查寬鬆（plan-mandated）。

## 7. 部署 notes（已執行，2026-07-22 凌晨）

- 今次 **server code 有 diff**（`server/domain/backtest.mjs`）→ rebuild 咗 **api + caddy 兩個 image**（之前 Phase A/B 純前端淨 rebuild caddy）。
- 實際部署紀錄：pg_dump 備份 `pre-deploy-20260721-165125.dump`（VM 時鐘 UTC）→ rollback tags（api + caddy）→ `git archive` tarball 同步 → build → `up -d --no-deps api/caddy` → smoke → collector recreate（佢共用 api image）。
- ⚠️ 中伏位：第一次 build 後 api 不停 restart（`exec /usr/local/bin/api-entrypoint.sh: no such file or directory`）— 查實係 Windows `git archive` 跟 `core.autocrlf=true` 將成個 tarball 轉咗 CRLF，entrypoint shebang 變 `#!/bin/sh\r`。用 `git -c core.autocrlf=false -c core.eol=lf archive` 重打包 + 重新同步 + rebuild 後即 healthy。**以後打包一定要用呢個指令。**
- Smoke 結果：internal `api ready 200 / caddy internal 404 / session 200`；public `root 200 / results 401 / internal 404 / HSTS ≥1`；tunnel `Registered tunnel connection` ×4；collector quota 388（>50）；collector 重啟後即寫咗批新盤（92 HAD / 92 HIL / 21 CHL / 58 HDC + 582 result comparisons）。
- Bundle：image 內 `/srv/index.html` 同 public 派嘅都係 `index-jmHUUAaH.js`（hash 核對一致；上一版 `index-BW9hE076.js`）。askpass 兩邊已刪。

---

詳細系統狀態以 `docs/MASTER-HANDOFF-v1.2.0.md` 為準。
