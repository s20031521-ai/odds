# 玄學賭波

足球賠率分析 dashboard，提供 AI 推薦值博機會，由 HDC 同 HKJC 兩個 source 收集賠率 data，支援讓球同角球玩法。

## Language

### 你既用語（同 AI 溝通用）

**玄學賭波**：
成個系統既叫法，係一個足球賠率分析工具。
_Avoid_: odds dashboard, value analyzer

**推薦**：
AI 計出嚟買得過既選擇。
_Avoid_: opportunity, value bet, buyable

**AI**：
入面個預測引擎，計邊啲盤口值得買。
_Avoid_: model, prediction engine

**玩法**：
賭波既類型分類，包括主客和、讓球、角球等。
_Avoid_: market type, betting market

**讓球**：
你最常玩既玩法，有盤口數字（例如 -0.5、+1）。
_Avoid_: handicap, Asian handicap

**角球**：
你第二常玩既玩法，賭角球總數。
_Avoid_: corners

**盤口**：
讓球盤入面個數字，例如 -0.5、+1。
_Avoid_: line, handicap line

**賠率**：
每個盤口既倍率數字，例如 1.85、2.10。
_Avoid_: odds, price

**賽程**：
對賽隊伍、聯賽、開波時間既組合資料。
_Avoid_: fixture, match

**聯賽**：
比賽所屬既聯賽，例如英超、西甲。
_Avoid_: league, competition

**後補**：
你自己 mark 返落咗咩注既記錄功能。
_Avoid_: bet log, bet tracking

**Chiikawa**：
Dashboard UI 用既卡通公仔角色。
_Avoid_: mascot, kawaii characters

### 系統內部概念

**HDC**：
The Odds API，其中一個賠率 data source。
_Avoid_: odds API provider

**HKJC**：
香港賽馬會足球賠率，另一個 data source。
_Avoid_: Jockey Club

**snapshot**：
賽前 capture 低既預測記錄，用嚟做 backtest 驗證 AI 準確度。
_Avoid_: capture, record

**snapshot-policy**：
決定一個 snapshot 係 valid-current、legacy 定 invalid 既分類規則，用 45 分鐘做 freshness 門檻。
_Avoid_: data freshness rule

**backend**：
server 端，Node.js HTTP server + PostgreSQL。
_Avoid_: server side

**frontend**：
React + Vite dashboard，支援 PWA 離線使用。
_Avoid_: client, UI
