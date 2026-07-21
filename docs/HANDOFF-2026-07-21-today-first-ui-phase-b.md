# HANDOFF — Today-first UI Phase B（單場分析頁）

日期：2026-07-21
版本：v1.1.1
狀態：✅ 已完成 + 已部署 production

---

## 1. 一句講晒

`#/analysis?match=<matchId>` 單場分析頁實裝完成：撳今日頁嘅卡或者賽程頁嘅場次，就入到一頁睇晒嗰場波四個市場（主客和 / 大細波 / 角球 / 亞洲讓球）嘅模型機率 vs 莊家隱含機率、edge、Kelly 建議注碼、現時賠率。舊「模型表現分析」頁按 owner 決策**直接刪除**。SDD 8 個 task 完成，全部 review clean，ff merge 落 master（`f37ffd5..b03ac8f`），已部署 production。

## 2. Spec / Plan

- Spec：`docs/superpowers/specs/2026-07-21-today-first-ui-redesign-design.md` §2.4（commit `8c2fb71`，Phase A 時已存在）
- Plan：`docs/superpowers/plans/2026-07-21-today-first-ui-phase-b-match-analysis.md`（commit `f37ffd5`）

## 3. 交付物

| 動作 | 檔案 |
|---|---|
| 新開 | `src/route.ts` 加 `analysisMatchIdFromHash`（query parser）；`src/matchDetails.ts`（純函數 `buildMatchMarketDetails`：按 matchId 由 h2h rows + 三種市場卡組裝四市場詳情 + header metadata）；`src/components/MarketDetailCard.tsx`（ok / insufficient「資料不足，唔買」/ empty「呢個市場冇盤」三態卡）；`src/pages/MatchAnalysisPage.tsx`（picker / 搵唔到 / 完整三態）；`src/styles/match.css`（全用 tokens variables） |
| 改造 | `src/App.tsx`（接新頁 + 刪舊分析頁全部內容 + fixtures 卡 link 改指 analysis + live odds auto-load gate 加 analysis 頁）；`src/components/PickCard.tsx`（「睇單場分析 →」改指 `#/analysis?match=`）；`src/main.tsx`（import match.css） |
| 測試 | 新增 19 個 Vitest（route +3、matchDetails +9、MarketDetailCard +4、MatchAnalysisPage +3，總數 226 → **245**）；Playwright 新開 `tests/ui/analysis.spec.ts` 5 tests（picker／四市場卡／轉場／搵唔到／today→analysis 流程）+ 更新 `dashboard.spec.ts` fixtures 卡斷言（總數 56 → **76**，4 viewports） |

## 4. 舊「模型表現分析」頁刪除清單（owner 2026-07-21 決策：直接刪，唔搬遷）

- 成段 analysis section JSX（readiness 面板、模型版本、預測方向、機率校準）+ `模型表現分析` heading
- `ModelReadiness` type、`readiness` / `analysisMarket` state、8 個分析專用 memo
- `PerformanceBar`、`Stat` components
- `marketDisplay.ts` 嘅 4 個 import（`calibrationBuckets` / `currentModelRows` / `predictionDistribution` / `summarizePerformanceRows`）
- **保留**：`loadBacktest` + `snapshotQuality` / `qualityWarning`（history 頁仲用）；`FixtureDetail` + `#/fixtures/<id>` deep link 全鏈（pro dashboard 仲用）；`marketDisplay.ts` 嘅 dead exports 連測試（模型檔唔准改，留 Phase C 清理）；舊 analysis CSS（`styles.css` 一帶，留 Phase C）

## 5. SDD 過程 + 中途捉到嘅真 bug

- Branch `today-first-phase-b`，7 commits（`5a1dff3`…`b03ac8f`），8 個 task 每個有 implementer + 獨立 reviewer，final whole-branch review 判 ready-to-merge。
- **Plan gap 變真 bug（e2e 捉到）**：cold visit `#/analysis` 時 live odds auto-load gate 只包 today/fixtures 頁 → 分析頁永遠冇數據（picker 空、`?match=` 顯示「搵唔到呢場波」）。12 個新 e2e 即紅。Controller 批准最小修復：one-shot auto-load + HDC interval 兩個 gate 各加 `page === "analysis"`（+4/-4），修復後 76/76 全綠。教訓：**新頁面要檢查數據 auto-load gate 有冇包佢**。
- 完整記錄：`.superpowers/sdd/progress.md` + `task-*-brief/report.md`。

## 6. 部署記錄（2026-07-21 晚）

- Bundle：`index-BW9hE076.js`（production 同本地 build 逐字相同）
- DB 備份：`pre-deploy-20260721-122827.dump`
- Rollback tags：api + caddy `:rollback` 已做（部署前）
- 純前端改動，淨 rebuild caddy；冇 DB migration；api / collector / cloudflared 冇郁
- Smoke 全綠：200 / 401 / 404 / HSTS / 內部 readiness / tunnel 4 connections / collector quota 406（> 50 線）

## 7. Deferred minors（final review triage，全部唔阻 merge，留 Phase C／之後）

1. `src/matchDetails.test.ts` factory 用 `as HandicapCard["bestSide"]` 假 cast「大」（type lie，測試專用）。
2. `matchDetails.ts` totals/corners header fallback 路徑冇直接單測（handicap 路徑有，邏輯同一 `find`）。
3. `match.css` `.market-detail-card__selection` 嘅 `color` rule 冗餘（卡面已設同色）。
4. `match.css` hardcode `padding: 16px`（tokens 冇 spacing token，合理權宜）。
5. Picker link 冇垂直置中（cosmetic）；`leagueZh ?? league` 靠 operator precedence（plan verbatim）。
6. `App.tsx` `clearBacktestResponseState({ readiness: [], ... })` 遷就簽名 — Phase C 連 marketDisplay dead exports 一併簡化。
7. HDC interval gate 受 `analysisTab` 白名單限制 — 已查證永不 block（值永遠係四個市場之一），同 today/fixtures 一致，非問題。
8. `tests/ui/dashboard.spec.ts:44` tablet-landscape 間歇 flaky（timing race，全量約 1/3 機率；單獨跑穩定綠；冇加 retry）— Phase C 拆細或加 retry。
9. `MarketDetailCard` stake 為 0 照出「建議注碼 $0」（plan-mandated，同 PickCard 一致）。

## 8. 之後嘅路（Phase C）

賽程頁分組（今日／聽日／之後按日子）+ 聯賽 filter chips + 隊名搜尋 + 「有貨」狀態點；紀錄頁四模型 readiness 進度條（X / 30 settled）；**刪除退役中嘅 `SimpleDashboard.tsx` 連 test**（順手收埋 PickCard helper 重複 drift surface）；可順手處理：舊 analysis CSS 清理、marketDisplay dead exports、Phase A/B deferred minors。Spec §2.3 / §2.5。

---

詳細系統狀態以 `docs/MASTER-HANDOFF-v1.1.1.md` 為準。
