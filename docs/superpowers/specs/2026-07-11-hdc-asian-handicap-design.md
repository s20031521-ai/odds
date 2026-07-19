# HDC 亞洲讓球設計

**日期：** 2026-07-11

## 目標

只加入 HDC 亞洲讓球，不加入 HHA。以 The Odds API `spreads` 全市場為主資料，用 leave-one-out 共識評估每間 bookmaker 的可買價格；HKJC 不再是入場條件，只在同場同盤時特別標示及一同競逐最佳價格。

## 範圍

- HKJC importer 載入 `HDC` pool。
- The Odds API request 加入 `spreads`，解析 bookmaker handicap point 與 decimal odds。
- Dashboard 新增「亞洲讓球」分頁。
- 每個 The Odds API 賽事及盤口獨立比較；少過兩間獨立 bookmaker 時顯示 `資料不足，唔買`。
- HKJC 同場同盤時顯示綠框／`HKJC 同盤`，但沒有 HKJC 亦可產生買入。
- 保存 HDC snapshot，包含方向、line、odds、chance、edge、modelVersion、source。
- History 使用現有 backend `/api/backtest`，按 Asian handicap 規則結算。

## 不做

- HHA 讓球主客和。
- xG、傷停、陣容或自建球隊實力模型。
- 用不同 handicap line 強行換算或比較。
- 新 dependency。

## 資料模型

HDC entry 沿用 totals market 的最小形狀：

- `matchId`
- `homeTeam` / `awayTeam`（顯示名稱）
- `homeTeamEn` / `awayTeamEn`（跨來源配對）
- `commenceTime`
- `bookmaker`
- `line`：以主隊角度表示，例如 `-1.75`。
- `homeOdds` / `awayOdds`

HKJC `-1.5/-2.0` 正規化為 `-1.75`；`0.0/+0.5` 正規化為 `+0.25`。The Odds API `spreads` point 亦正規化成主隊 line。

## 判斷

1. The Odds API entries 按賽事及 normalized line 分組；同場不同 line 不混合。
2. 每個候選 bookmaker 以其餘 bookmaker 的同盤主／客價格去水，再平均成 leave-one-out 公平概率。
3. 對候選 bookmaker 的主／客價格分別計 `edge = odds × leave-one-out probability - 1`。
4. 全組選最高 edge 的 bookmaker、方向及實際價格；`edge >= settings.edgeThreshold` 才顯示買入，否則 `唔買`。
5. 少過兩間獨立 bookmaker 無法 leave-one-out，顯示 `資料不足，唔買`。
6. HKJC 以開賽時間（±10 分鐘）及正規化英文主／客隊名配對；只有相同 line 才加入候選價格並顯示 `HKJC 同盤`。配對失敗不影響外圍市場分析。
7. Dashboard 顯示買入方向、bookmaker、實際 odds、市場概率；snapshot 保存實際選中的 bookmaker。

## 結算

- 主隊投注：比較 `homeGoals - awayGoals + line`。
- 客隊投注：使用相反 handicap。
- 四分之一盤拆成相鄰兩個半盤，沿用現有 `win / half-win / push / half-loss / loss` settlement。
- 冇賽前 snapshot 繼續顯示 `待對比`。

## 錯誤處理

- 無效 line、缺 odds、odds <= 1：丟棄該 entry。
- HKJC 賽事或盤口配對失敗：只取消 HKJC 標記，外圍市場繼續分析。
- 外圍同盤少過兩間 bookmaker：不估算，顯示資料不足。
- The Odds API 無 `spreads`：其他市場照常載入，HDC 保持空白。

## 驗收

- HKJC HDC importer self-test 覆蓋 quarter-line parsing。
- The Odds API parser test 覆蓋 home/away point normalization。
- HDC value test 覆蓋 leave-one-out、最高可買價格、同盤限制及 3% threshold。
- Browser smoke 覆蓋無 HKJC 仍有外圍卡片，以及 HKJC 同盤特別標記。
- Settlement test 覆蓋 whole、half、quarter handicap。
- Snapshot/backtest test 覆蓋 HDC immutable settlement。
- `npm test -- --run`、`npm run build`、三個 self-test、live import、browser smoke 全過。
