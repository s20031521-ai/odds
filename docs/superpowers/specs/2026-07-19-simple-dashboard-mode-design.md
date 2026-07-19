# 極簡 / 專業雙模式 Dashboard 設計

日期:2026-07-19
狀態:待實作

## 目標

Dashboard(`#/dashboard`)變成雙模式:

- **極簡 mode(預設)**:一眼睇到邊場波買得過。每張卡係一場波,卡入面直接列晒嗰場所有過關投注項目,冇任何其他數字。
- **專業 mode**:保留而家嘅完整畫面(KPI、市場篩選、莊家/機會率/Edge 明細),一個字嘅邏輯都唔改。

## 背景

現有 `src/pages/BuyDashboard.tsx` 已經只顯示達到 3% edge 門檻嘅場次(`BuyOpportunity`,`primary` + `alternatives` 全部係過關買盤),但每張卡資訊量重:KPI 行、市場篩選掣、每盤嘅莊家/賠率/機會率/Edge 明細表。用戶想要一個「一睇就知邊場買得過」嘅極簡版面做主畫面。

## 架構(方案 A:同頁 toggle,兩個 component)

- 新增 `src/pages/SimpleDashboard.tsx`:極簡卡片列表。
- 現有 `src/pages/BuyDashboard.tsx` 原封不動,作為專業 mode 嘅 view。
- Dashboard route 嘅父層(App.tsx 渲染 dashboard 嘅位置)包一個 mode state + toggle,按 mode 渲染 `SimpleDashboard` 或 `BuyDashboard`。
- 兩個 view 接收相同 props(`opportunities`、`generatedAt`、`dataFresh`),資料來源同邏輯完全唔變。

## 極簡卡片規格

每張卡(一場波)由上至下:

1. 細字灰色一行:聯賽名(`leagueZh ?? league`,有先顯示)+ 開賽時間(`formatDate(commenceTime)`)
2. 隊名,最大字:`主隊 vs 客隊`(`homeTeamZh ?? homeTeam` / `awayTeamZh ?? awayTeam`)
3. 分隔線
4. 每行一個過關投注項目:`市場 · 選項(含讓球線)@ 賠率`,例如 `主勝 @ 2.10`、`大 2.5 @ 1.95`

行為規則:

- 卡上每一行都係過咗 3% edge 嘅盤(`primary` + `alternatives` 全列出);唔過關嘅項目唔會出現。3 個過關就 3 行,1 個就 1 行。
- 冇 KPI 行、冇市場篩選掣、冇莊家/機會率/Edge 明細 — 呢啲只喺專業 mode 見。
- 排序跟現有 `opportunities` 陣列次序,唔改邏輯。
- 撳張卡照舊行去 `#/fixtures/:matchId`(保留現有連結行為)。
- 空狀態:淨係「暫時冇場次過關」一句,冇「查看全部賽事」連結。

## Toggle

- 擺喺 dashboard 標題隔籬,兩粒制:「極簡 | 專業」,`aria-pressed` 標示現時模式。
- 預設「極簡」。
- 選擇寫入 `localStorage`(key:`dashboard-mode`),load 時讀返;無效值當「極簡」。
- 任何狀態(包括 stale、空狀態)都撳得,即時切換,唔使 reload。
- 手機版跟現有 layout 縮排。

## 狀態處理

- **資料未更新(`dataFresh === false`)**:兩個 mode 都暫停顯示買盤,出「資料未更新,暫停顯示買盤」。安全規矩唔放寬。
- **同步時間**:極簡版保留標題區一行細字「同步時間 …」。
- 錯誤/警告 banner(`dataWarning`)由 `AppShell` 處理,唔變。

## 安全規矩(唔會改動)

- 3% edge 門檻唔會因為要出 pick 而降低。
- 「買得過」嘅定義完全沿用現有 `buyOpportunities` 邏輯,本設計只改 presentation。

## 測試

- 新 `src/pages/SimpleDashboard.test.tsx`:
  - 過關項目數量 = 顯示行數(3 個顯示 3 行、1 個顯示 1 行,`primary` + `alternatives` 齊出)
  - 冇過關場次 → 空狀態「暫時冇場次過關」
  - `dataFresh === false` → 唔出買盤,出暫停訊息
  - 聯賽/開賽時間/隊名正確渲染
- Toggle 測試(App 或新 wrapper 層):
  - 預設極簡
  - 撳「專業」轉畫面,撳「極簡」轉返
  - localStorage 記住選擇(模擬再 load)
- 現有 `BuyDashboard.test.tsx` 原封不動,繼續 pass。
- 收工前:`npm test` + `npm run build` 全綠。

## 範圍外(YAGNI)

- 唔改 history / analysis / fixtures 版。
- 唔加紅綠燈、唔加灰階顯示唔過關場次。
- 唔改 collector、API、edge 計法。
