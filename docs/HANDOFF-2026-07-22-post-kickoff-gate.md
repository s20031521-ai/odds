# HANDOFF — 開賽後買盤 gate（post-kickoff gate）

> 日期：2026-07-22（凌晨）
> 範圍：純前端修正，兩個 commits，兩次部署（都係淨 rebuild caddy）
> 狀態：**已部署 production**，bundle `index-BQuUTJ1Q.js`

---

## 1. 背景（點解有呢個修正）

Owner 喺 2026-07-22 約 01:30（香港時間）喺 fixtures 頁見到阿侯斯 vs 列治普斯納（歐冠外圍賽，01:00 開賽）嘅大細卡出「**買細 @ HKJC 2.30，Edge 21.12%**」，但紀錄頁搵唔到對應 snapshot。

排查結論：**系統行為正確，UX 誤導**。

- 個 30 場 sample 只計**賽前**落咗 immutable snapshot 嘅「買」盤（`toSnapshot` 喺 `src/App.tsx`，`commenceTime <= now` 直接唔記；`shared/snapshot-policy.mjs` 都會將 `savedAt >= commenceTime` 分類做 invalid `post-kickoff`）。呢個係防事後孔明嘅刻意設計。
- 但 market card **冇開賽 gate**：HKJC 每 15 分鐘更新、數據 45 分鐘新鮮期內，開賽後張卡仲會攞住最後一口賽前價照樣計照樣出「買」CTA，睇落同有效建議一模一样。
- 補充：成個系統**冇接 HKJC 即場（in-play）盤**；開賽後顯示嘅係賽前 closing odds，唔係即場價。模型機率亦係賽前估算，唔知比分 — 就算接到即場價，用賽前機率計即場 edge 都係假 edge。即場投注係另一個策略，要做係新模型（新 modelVersion、獨立儲 30 場），唔可以溝入現行 sample。

## 2. 改動

新 helper **`src/kickoffGate.ts`**：

- `isPostKickoff(commenceTime, now = Date.now())` — parse 唔到時間當未開賽（fail-open 顯示原 label）
- `gatePickLabel(pickLabel, commenceTime, now)` — **開賽後任何 pick label 一律變「已開賽」**（`POST_KICKOFF_LABEL`）；唔只「買」開頭（第二輪擴闊：「唔買」「資料不足，唔買」開賽後同樣係舊判斷）
- 開賽後 label 唔再以「買」開頭 → 所有用之處自動落返 neutral 灰色樣式，**冇新 CSS**

接線四個顯示位（全部喺 `src/App.tsx` 同 components，**`BuyDashboard.tsx` 紅線冇郁**）：

| 位置 | 做法 |
|---|---|
| 賽程頁 h2h 行 pick（`fixture-row__pick`） | `gatePickLabel(bestPick.label, fixture.commenceTime)` |
| 亞洲讓球 market card | map 改 block body，`gatePickLabel(card.pickLabel, card.commenceTime)`；Edge badge 跟 gated label |
| 大細／角球 `MarketCardGroup`（主盤 + 其他盤口） | 同上；other lines 用 `gatePickLabel(line.pickLabel, line.commenceTime)` |
| 分析頁 `MarketDetailCard` | 加 optional `postKickoff` prop；`ok` 態收埋「買：」同「建議注碼」顯示「已開賽」（保留 odds/模型機率/Edge 做參考）；`insufficient` 態開賽後 note 改顯示「已開賽」；`MatchAnalysisPage` 用 `isPostKickoff(header.commenceTime)` 傳入 |

今日頁（`TodayPage` / `PickCard`）本身食 `buyOpportunities`，一早 gate 咗 `kickoff 未來`，唔使郁。

## 3. TDD 過程

- RED 1：`src/kickoffGate.test.ts`（module 未存在 → import error）
- RED 2：`MarketDetailCard.test.tsx` postKickoff 兩個 render test（fail：仲出緊「買：」）
- RED 3：`App.test.tsx` source-assertion（repo 對 App.tsx 嘅既定測試 pattern）+ `MatchAnalysisPage.test.tsx` 開賽後全頁「已開賽」
- GREEN 後第二輪（owner 實測發現「唔買」冇變）：改測試期望 neutral label 開賽後都變「已開賽」→ 再 RED → 放寬 `gatePickLabel` + `MarketDetailCard` insufficient 態 → GREEN

## 4. 驗證同部署

| 項目 | 結果 |
|---|---|
| Vitest | **246/246**（233 基線 + 13 新） |
| `tsc --noEmit` | 0 errors |
| `vite build` | 通過 |
| Playwright | 84/84（mock 用 2030 未來開賽，唔受 gate 影響） |
| Commits | `55e931b`（buy CTA gate）→ `9504963`（擴闊到所有 pick label） |
| 第一次部署 | bundle `index-Cp7i2YwH.js`，備份 `pre-deploy-20260721-182949.dump`，caddy rollback tag |
| 第二次部署 | bundle `index-BQuUTJ1Q.js`，備份 `pre-deploy-20260721-183954.dump`，rollback tag 更新指向前一版 |
| Smoke（兩次都綠） | internal 200/404/200；public 200/401/404/HSTS；tunnel ×4；bundle grep 到「已開賽」 |

部署注意：owner 提供咗 sudo 密碼做 askpass（用畢兩邊 `rm`）；跟 v1.2.0 教訓用 `git -c core.autocrlf=false -c core.eol=lf archive` 打包 + `od -c` 驗 shebang LF；備份要 `sudo docker exec ... | sudo tee`（hugo 寫唔入 `/opt/odds-tool/backups`）。

## 5. 部署後發現嘅後續事項（deferred）

1. **3 條永遠唔會 settle 嘅 pending**：紀錄頁大細波 tab 有 3 條 12/7–13/7 嘅 the-odds-api snapshot（Edge 38.51% / 34.84% / 3.14%），結果追蹤窗口係開賽後 3 日（`dueScoreSports`），佢哋喺 7-19 file→Postgres 遷移期間過咗窗口，永遠坐喺「等緊開賽」，唔會計入 30 場。屬遷移時機犧牲品，唔係新 bug。可考慮日後加清理或標記。
2. **Quota 兩個數對唔上**：VM collector state 記 `quotaRemaining: 373`，本機 `.env.local` 條 key 直查 The Odds API 得 177 — 大機會**本機同 production 係兩條唔同 key**。Kimi 嘅 quota 監察 widget task 讀本機 key，可能唔反映 production 水位。Owner 已知，換 key 時一併校準。
3. **`BuyDashboard.tsx`（專業模式）冇 gate**：紅線唔准改，所以專業版 dashboard 開賽後理論上仲會出「買」label。要改要 owner 明確豁免。
4. **Client snapshot POST 係 fire-and-forget**：`void apiClient.savePredictions(...)` 回應（包括 server rejected 原因）完全唔睇，靜默失敗冇人知。今次排查確認唔係出事原因（owner 係賽後先見到張卡），但係潛在盲點。
5. **Stale SW**：owner 部署後要 hard refresh 先見新版；已知歷史教訓（§11.3 #6）。

---

*文件完。MASTER-HANDOFF §12 已加呢輪嘅行。*
