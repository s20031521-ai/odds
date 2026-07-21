# HANDOFF — Today-first UI Phase A（今日首頁）

日期：2026-07-21
版本：v1.1.0
狀態：✅ 已完成 + 已部署 production

---

## 1. 一句講晒

成個 app 由「模型健康 dashboard」改造成「今日首頁」：開 app 5 秒內知今日買咩。Phase A 交付咗全新 TodayPage（`#/` 主路由），用 SDD（subagent-driven-development）13 個 task 完成，全部 review clean，ff merge 落 master，已部署 production。

## 2. 背景：brainstorm 結論

- **問題**：舊 UI 資訊太雜，用家開 app 唔知今日應該買咩，要周圍撳先搵到 picks。
- **目標**：開 app 5 秒內答到「今日買咩」。
- **設計**：每場一張 PickCard，三行講晒（邊場／買咩／點解）。
- **範圍**：成個 app 資訊架構重做，但分三期落，Phase A 先做「今日」頁。

## 3. Spec / Plan

- Spec：`docs/superpowers/specs/2026-07-21-today-first-ui-redesign-design.md`（commit `8c2fb71`）
- Plan：`docs/superpowers/plans/2026-07-21-today-first-ui-phase-a-today-page.md`（commit `5b2ab7b`）

## 4. Owner 決策記錄（重要，之後唔好反口）

1. 舊「模型健康」頁內容 → **直接刪除，唔搬遷**（Phase B 執行）。
2. PickCard helpers 同 SimpleDashboard 暫時有重複 code → **批准保留（2A）**，Phase C 刪 SimpleDashboard 時一併收。
3. 路由：`#/` = TodayPage（新首頁）；舊 dashboard 暫時留喺 alias 路由，Phase C 刪。

## 5. SDD 執行過程

- Branch：`today-first-phase-a`，13 個 commits（`4684a69`…`e837c02`）。
- 每個 task 由 implementer subagent 做 → reviewer subagent review → clean 先繼續。
- Final review：ready-to-merge。
- 最後一個 commit `e837c02`：fix `onShowAll`（「顯示全部」撳完冇反應嘅 bug）。
- ff merge 落 master：`5b2ab7b..e837c02`，branch 已刪。
- 完整 SDD 記錄：`.superpowers/sdd/progress.md`。

## 6. 交付物

- `src/pages/TodayPage.tsx` — 今日首頁主件
- `src/components/PickCard.tsx` — 三行式推薦卡
- `src/components/FreshnessBar.tsx` — 數據新鮮度條
- `src/components/EmptyState.tsx` — 今日無賽事／無推薦嘅空態
- `src/utils/stakeDisplay.ts` — 注碼顯示格式化
- `src/styles/today.css` — 新頁樣式
- `src/App.tsx` — route 改動（`#/` → TodayPage）
- 測試：35 files / 226 tests（Vitest）+ Playwright 56/56

## 7. 部署記錄

- Bundle：`index-BYUf2jMY.js`（production 同本地 build 逐字相同，已核對 hash）
- DB 備份：`pre-deploy-20260721-093231.dump`（deploy 前喺 VM 做咗）
- Rollback tag：已做
- Smoke test 全綠：HTTP 200 / API 401 auth / 404 / HSTS header / tunnel 4 connections 正常
- Collector 部署後正常

## 8. Deferred minors（已知小事，唔阻用，留返之後執）

1. PickCard 某啲位仲顯示 raw ISO 時間（賠率「同步於」），未格式化。
2. 數據 stale 時 upcoming 場次仲會顯示（應該隱藏或降級）。
3. simple / pro 兩個 mode 嘅 stale 文案唔一致。
4. 測試用 `FUTURE_KICKOFF = 2030`，到時會變 past，要改用動態日期。
5. `stakeDisplay` test 入面有個註解會令人混淆，要执返清楚。

## 9. 之後嘅路（Phase B / C）

- **Phase B**：單場分析頁 `#/analysis?match=`（撳 PickCard 入去睇詳細分析）；執行決策 1（刪舊「模型健康」頁內容）；PickCard link 由指舊頁改指 analysis。
- **Phase C**：賽程頁分組 / filter / 搜尋 / 狀態點；紀錄頁 readiness 進度條；執行決策 2（刪 SimpleDashboard，收埋重複 helpers）。

---

詳細系統狀態以 `docs/MASTER-HANDOFF-v1.1.0.md` 為準。
