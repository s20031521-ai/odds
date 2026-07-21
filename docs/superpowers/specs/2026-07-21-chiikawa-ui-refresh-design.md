# Chiikawa UI Refresh — 設計規格

日期：2026-07-21
狀態：待用戶審閱

## 背景

Odds Tool（本地足球賠率分析 dashboard，Vite + React + TS）而家係深色交易台風格（`tokens.css`：深藍底 `#11182b`）。用戶想將成個 app 嘅 UI 轉做**沉浸式輕鬆 Chiikawa 風格**，主角用 **Chiikawa（吉伊卡哇）** 同 **飛鼠（Momonga）**。

## 目標

- 成個 app（登入頁、值得買、全部賽事、完場紀錄、模型健康）統一轉為柔和 pastel、圓潤、可愛嘅視覺語言
- 加入 Chiikawa + Momonga 插畫裝飾同得意微文案（廣東話）
- **數據可讀性不妥協**：賠率數字、表格、升跌標示保持清晰，可愛元素只係裝飾層
- 零邏輯改動：只改樣式同加展示元件，現有測試全部照過

## 素材來源與版權

- 圖片由 chiikawa-wallpaper.com / chiikawawallpaper.com 下載，兩站均標明「免費、僅供個人用途」
- 本項目係本地個人工具，屬個人用途；圖片**唔可以**隨項目對外發佈或商用
- 下載 6–8 張，以 Chiikawa 及 Momonga 為主，存於 `public/chiikawa/`，本地引用（唔好 hotlink）

素材分工（暫定，按下載到嘅實際圖調整）：

| 用途 | 角色 | 備註 |
|---|---|---|
| 頁面角落常駐小裝飾 | Chiikawa | 細尺寸，半透明或細細粒放角落 |
| Loading 狀態 | Momonga | 配「等緊數據嚟…」 |
| 空白 / 無數據狀態 | Chiikawa | 配得意微文案 |
| 登入頁迎接 | Chiikawa + Momonga 合照 | 柔和背景 |
| 錯誤 / 警告提示 | Momonga | 細圖示級 |

## 視覺系統

### 色板（改寫 `src/styles/tokens.css`）

- `--color-bg`：奶油白 `#FFF8F0`
- `--color-surface`：純白帶暖 `#FFFEFC`（卡片）
- `--color-primary`：奶藍 `#8FC1E9`（按鈕、連結、active nav）
- `--color-accent-pink`：淡粉 `#FFD9E0`（裝飾、tag 底）
- `--color-accent-yellow`：淡黃 `#FFF1C9`（highlight、警告底色）
- `--color-positive`（升 / 值博）：薄荷綠 `#7FCFA9`
- `--color-negative`（跌）：蜜桃粉 `#F2A0A0`
- `--color-warning`：蜜糖黃 `#E8B45A`
- `--color-text`：深可可 `#4A3F3F`（唔用死黑）
- `--color-muted`：灰杏 `#A89B91`
- `--radius-card`：16px → 24px（大卡片 28px）
- 陰影：軟綿雙層（例如 `0 2px 8px rgba(74,63,63,.06), 0 8px 24px rgba(74,63,63,.05)`）

### 字體

- 標題：圓潤字體（Google Font "Baloo 2"，fallback 系統 rounded）；中文用系統圓體 fallback（"PingFang TC", "Microsoft JhengHei"）
- 數字 / 賠率：保持而家嘅清晰排版，只調顏色同間距，**唔轉花巧字體**

### 點綴元素

- 少量 SVG 裝飾：櫻花花瓣、星星、雲朵，放頁面邊緣 / 卡片角落，透明度低，唔搶焦點
- Hover 微動效：卡片輕微上浮 + 陰影加深（`transform: translateY(-2px)`，150ms ease）
- 按鈕：大圓角（pill 形）、pastel 底、按下輕微回彈

### 微文案（廣東話，輕鬆語氣）

- Loading：「等緊數據嚟…」
- 無心水盤：「今日暫時冇心水盤，飲杯茶先～」
- 數據警告：保留原 warning 內容（資訊唔改），只改外觀；語氣詞只加喺裝飾性文案，**唔改動任何數據 / 風險提示嘅實質內容**

## 實施範圍

### 改動檔案

1. `src/styles/tokens.css` — 新色板、圓角、陰影 tokens
2. `src/styles.css` + `src/styles/layout.css` + `src/styles/dashboard.css` — 按新 tokens 調整（淺色底之後文字 / 邊框對比要逐處檢查）
3. 新檔 `src/components/Kawaii.tsx` — 裝飾元件：`<Mascot variant="chiikawa|momonga" pose="corner|loading|empty|login" />` + SVG 花瓣 / 星星裝飾
4. 各頁面掛裝飾：
   - `LoginPage.tsx` — 迎接插畫 + pastel 背景
   - `AppShell.tsx` — 角落常駐 Chiikawa 小裝飾、nav active 狀態轉 pastel pill
   - `DashboardPage.tsx` / `SimpleDashboard.tsx` / `BuyDashboard.tsx` — loading / 空白狀態換 Mascot + 微文案
   - `AllFixtures.tsx` — 同上
5. `public/chiikawa/` — 下載嘅圖（6–8 張，壓縮到合理大小）

### 唔做嘅嘢（YAGNI）

- 唔改任何數據邏輯、API、路由
- 唔加 dark mode toggle（今次一次性轉淺色 Chiikawa 主題）
- 唔做動畫場景 / 互動遊戲化
- 唔改測試斷言以外嘅測試檔；如快照或 class 相關測試因樣式改名受影響，逐個修

## 測試與驗證

- `npm test` 全綠
- `npm run build` 成功
- 目測三個主要頁面 + 登入頁：數字對比度喺淺色底下仍然清晰（WCAG AA 為目標）
- 確認圖片全部本地引用，離線可用

## 風險

- 淺色化之後某啲原本為深底設計嘅顏色（例如 `--color-positive` 舊薄荷）對比唔夠 — 逐頁目測檢查
- 下載嘅圖尺寸不一 — 用 CSS `object-fit` 統一，必要時壓縮
- 版權：僅限本地個人用途，README 加一句註明 `public/chiikawa/` 素材來源及限制
