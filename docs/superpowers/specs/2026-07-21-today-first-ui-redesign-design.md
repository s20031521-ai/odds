# Today-First UI Redesign — 設計規格

> 日期：2026-07-21
> 狀態：已獲 owner 分節確認（資訊架構 / hero 細節 / 三頁細節 / 技術做法）
> 語言：廣東話交接文件；程式碼註解用英文
> 前置：`docs/MASTER-HANDOFF-v1.0.2.md`（紅線 §10 全部適用）

---

## 1. 問題同目標

**問題**：成個系統 UI 唔 friendly — 核心係「資訊太雜，打開 app 一眼睇唔到重點」，要自己喺一堆數字入面搵答案。

**目標**：打開 app 5 秒內知道「今日有冇值得買嘅盤」— 有就即見邊場、買邊邊、賠率幾多；冇就一句講明原因。

**非目標**：
- 唔改任何模型、揀選規則、常數（`BUY_EDGE_THRESHOLD` 0.03、Kelly 參數等全部凍結）
- 唔改 `BuyDashboard.tsx` / `BuyDashboard.test.tsx`（紅線 #2）
- 唔加新 API、唔郁 server、唔郁 DB
- 唔加新外部資源（離線紅線保持）

**成功標準**：
- 首頁第一屏（任何 viewport）直接顯示「今日結論」，唔使 scroll、唔使諗
- 冇貨時有一句人話解釋原因（三種情況分開講）
- 由首頁到單場完整分析最多兩撳

---

## 2. 資訊架構

### 2.1 導航

| 新 label | route | 職責 |
|---|---|---|
| 今日 | `#/today`（新開） | 答案優先首頁 |
| 賽程 | `#/fixtures`（保留） | 全部賽程 list |
| 分析 | `#/analysis`（保留，加 `?match=<matchId>`） | 單場深入詳情 |
| 紀錄 | `#/history`（保留） | 歷史盤 + 模型 readiness |

- 舊 `#/dashboard` **redirect** 去 `#/today`，舊書籤/PWA 入口唔會死。
- nav label 改名：`今日 / 賽程 / 分析 / 紀錄`。要檢查 Playwright 現有 spec 有冇斷言舊 label。
- 右上「今日 / 專業」toggle 保留：「今日」係新預設；「專業」顯示 `BuyDashboard.tsx` 原封視圖。`localStorage dashboard-mode` 機制沿用。

### 2.2 今日（首頁）三層結構

由上至下：

1. **新鮮度條**（置頂幼 bar）
   - 新鮮：「賠率更新於 X 分鐘前」，薄荷綠
   - 唔新鮮（跟現行 `dataFresh` 45 min 邏輯）：蜜糖黃警告 + hero 區整體轉「冇貨（數據舊）」狀態 — 跟現行 `!dataFresh → 全部丟棄` 邏輯，唔會俾舊數據呃落注

2. **今日結論（hero 區）**
   - 有貨 → 精選盤卡列表（見 §3）
   - 冇貨 → EmptyState（見 §3.3）

3. **即將開賽**：未來 3–5 場一行過（時間 + 對賽 + logo），撳去賽程頁

### 2.3 賽程頁（改造 `AllFixtures.tsx`）

- 按日期分組：今日 / 聽日 / 之後按日子
- 每場一行：時間、聯賽、對賽（隊名 + logo）
- **狀態點**：該場有盤過檻 → 薄荷綠細 dot + 「有貨」；冇就乜都唔顯示
- 工具列：聯賽 filter（chips 多選）+ 隊名搜尋
- 撳一場 → `#/analysis?match=<matchId>`

### 2.4 分析頁（重做成單場詳情容器）

- **冇揀場**：chiikawa-empty + 「由今日或賽程揀一場波」+ 今日有貨場次快捷入口
- **揀咗場**：場次 header（對賽、開賽、聯賽 + 「轉場」撳掣）→ 四張市場卡：
  - 主客和 / 大細 / 角球 / 亞洲讓球
  - 每張卡：模型機率 vs 莊家隱含機率（一句人話對比，例「模型估 58%，莊家開 51%」）、edge、Kelly stake、現時賠率
  - 該市場冇數據 → 卡照出，顯示「呢個市場冇盤」（唔好靜靜雞消失）

### 2.5 紀錄頁

- 頂部：**四模型 readiness 進度條** — 每模型一行：名 + `X / 30 settled` + 進度條（純展示，守模型凍結紅線）
- 下面分兩組：「等緊開賽」（unsettled）/「已完場」（settled，顯示中/唔中）；每行可撳開睇當時 snapshot
- 數據照用 `/api/v1/backtest`，唔加新 API

### 2.6 跨頁流

- 今日 →（撳卡「睇單場分析」）→ 分析嗰場
- 賽程 →（撳場）→ 分析嗰場
- 分析 →（「轉場」）→ 唔離頁換場

---

## 3. 首頁 hero 細節

### 3.1 精選盤卡（摺起狀態，三行）

```text
┌─────────────────────────────────────┐
│ ⚽ 曼城 vs 阿仙奴        今晚 20:00  │  ← 隊名 + logo + 開賽
│ 買：大 2.5                           │  ← 邊邊 + 盤口
│ 賠率 1.95                     [詳情▾] │  ← 大字賠率
└─────────────────────────────────────┘
```

### 3.2 撳開「詳情」**原地展開**（唔跳頁，owner 已 confirm）

- edge 幾多 %
- 模型機率 vs 莊家隱含機率（一句人話）
- Kelly 建議注碼（bankroll % / 金額，跟現行 analyzer 設定：bankroll 1000 / fractionalKelly 0.25 / cap 2%）
- 「睇單場分析 →」link
- 數據時間戳：「呢個盤 X 分鐘前更新」

### 3.3 冇貨狀態（EmptyState，三種原因，廣東話口語，owner 已 confirm）

| 情況 | mascot | 文案 |
|---|---|---|
| 數據太舊 | momonga-alert | 「數據舊咗，唔好住落注 — 更新緊」 |
| 有賽事但冇盤過檻 | chiikawa-empty | 「今日 X 場波，但冇盤值博 — 慳返啖」 |
| 根本冇賽事 | chiikawa-empty | 「今日冇波睇，聽日先嚟過」 |

### 3.4 排序同數量

- 排序：沿用 `selectBuyOpportunities` output（primary edge 降序、每 market+line 留 best）— **UI 層唔改揀選規則**
- 上限 5 張；多過 5 張顯示「仲有 X 個盤 →」撳去專業模式睇晒（新舊模式之橋）

---

## 4. 技術做法

### 4.1 檔案分工

| 動作 | 檔案 |
|---|---|
| 新開 | `src/today/TodayPage.tsx`、`src/today/PickCard.tsx`、`src/today/FreshnessBar.tsx`、`src/today/EmptyState.tsx`、`src/match/MatchAnalysisPage.tsx`、`src/match/MarketDetailCard.tsx` |
| 改造 | `src/AllFixtures.tsx`（賽程頁）、紀錄頁（readiness 進度條 + 分組；對應檔名 plan 階段喺 `src/` 確認）、`src/App.tsx`（路由 + nav labels）、`src/route.ts`（`#/today` + `#/dashboard` redirect） |
| 原封不動 | `BuyDashboard.tsx` + test；所有模型檔（`odds.ts` / `totals.ts` / `asianTotals.ts` / `corners.ts` / `handicap.ts` / `buyCandidates.ts` / `buyOpportunities.ts` / `marketCalibration.ts` / `picks.ts`） |
| 退役 | `SimpleDashboard.tsx` 連專屬測試（helper 重複 drift surface 順手消滅） |

### 4.2 數據流

- 全部 client-side：`buildBuyCandidates` → `selectBuyOpportunities` output 直接餵 `TodayPage`
- 新鮮度：現行 `dataHealth.ts` / `dataFresh` 邏輯
- 單場詳情：live odds + models 按 matchId 過濾
- **冇新 API、冇 server 改動、冇 DB 改動** → 部署淨 rebuild caddy image

### 4.3 樣式

- 新元件只用 `tokens.css` CSS variables（pastel 色板延續）
- 幾何唔變：`--touch-target` 44px、dashboard grid 列數、nav breakpoints
- className 只加唔改名
- mascot 重用現有 `<Mascot>` poses，唔加新素材；`<KawaiiDecor />` 可重用

### 4.4 紅線 checklist

- [ ] 模型/常數/3% 門檻唔郁（淨 UI 層）
- [ ] `BuyDashboard.tsx` / `.test.tsx` 唔郁
- [ ] Chiikawa 鎖死字串：凡 SSR 測試逐字斷言嘅字串，改文案前搵出對應測試同步改（plan 階段逐個列出；參考 `docs/superpowers/plans/2026-07-21-chiikawa-ui-refresh.md` Global Constraints）
- [ ] 離線零外部資源保持
- [ ] Archives immutable；secrets 唔入 repo/chat

---

## 5. 測試策略（TDD：RED → GREEN）

1. **Vitest**（每新元件一個 test file）：
   - `PickCard`：摺起三行 / 展開顯示 edge + stake + link
   - `EmptyState`：三種原因各自文案 + mascot pose
   - `FreshnessBar`：新鮮 / 唔新鮮兩態
   - `MarketDetailCard`：有數據 / 「呢個市場冇盤」
   - 路由：`#/dashboard` → `#/today` redirect
   - 賽程頁：分組 / filter / 搜尋 / 狀態點
   - 紀錄頁：readiness 進度條 X/30
2. **Playwright**（`tests/ui/today.spec.ts` 新開，4 viewports）：
   - 有貨顯示卡、冇貨三種狀態、撳卡原地展開、跳單場分析
   - 現有 `dashboard.spec.ts`（斷言專業模式 DOM）保留；檢查 nav label 改名有冇掃到
   - `mockApi` 嘅 `addInitScript` 顯式模式寫入（§8.2 教訓）繼續用；新 spec 若要斷言「今日」模式 DOM，要顯式寫返 simple/預設模式，唔好靠順序
3. **回歸保證**：現有 196 Vitest 全綠先好 merge；`tsc --noEmit` + `vite build` 通過；Playwright 32+ 全綠先部署
4. **部署**（跟 `docs/runbooks/production-deployment.md`）：pg_dump 備份 → tag rollback → rebuild caddy → smoke → 驗證用乾淨 browser profile（stale SW 教訓 §11.3 #6）

---

## 6. 分期建議（寫 plan 時參考）

1. **Phase A — 今日首頁**：TodayPage 三層 + PickCard + EmptyState + FreshnessBar + 路由/toggle wiring（最大價值，可先獨立部署）
2. **Phase B — 單場分析**：MatchAnalysisPage + MarketDetailCard + `?match=` 參數 + 賽程/今日跳轉
3. **Phase C — 賽程 + 紀錄執整**：分組/filter/搜尋/狀態點 + readiness 進度條 + SimpleDashboard 退役清理

每 phase 可以獨立 TDD + 獨立部署（純前端，每次淨 rebuild caddy）。

---

*文件完。下一步：owner 過目 → writing-plans 出 implementation plan。*
