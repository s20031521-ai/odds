# HANDOFF — 投注績效（個人注單）決策報告

| 欄位 | 內容 |
|------|------|
| 日期 | 2026-07-26 |
| Branch | `master`（決策文件；**尚未實作**） |
| 方式 | `/grilling`（一問一答） |
| 狀態 | **決策已對齊 · 未寫 code / 未 migration** |
| 相關 | 現有「模型表現」`#/performance` ≠ 本功能；勿撈亂 |

---

## 1. 一句講晒

做 **個人投注績效／注單帳**：單位係「一場 + 一盤口 + 一揀邊」。  
三個入口（今日卡、賽程、績效頁手動），資料 **Postgres + per 登入用戶**，結算 **自動**；UI v1 只顯示列表 + 中率，**唔 show 損益**，但 DB 背後要計齊半中／半錯金額。

---

## 2. 問題與產品邊界

### 要解決
- 用戶想記錄「我有買」邊啲推薦／場次，之後睇個人命中率。
- 入口要貼近操作：今日推薦卡、賽程表、以及事後手動補入。
- 手動入要能 **link 返** 系統入面出現過嘅賽程／fixture record。

### 明確唔係
| 唔係 | 原因 |
|------|------|
| 現有「模型表現」backtest 頁 | 嗰個係 **模型** 統計，唔係個人注碼帳 |
| 只改 client localStorage | 用戶選咗 server；要多裝置／auth |
| v1 顯示金額損益／ROI | 用戶明確唔想畫面顯示損益 |

---

## 3. Grilling 決策紀錄

| # | 問題 | 決定 |
|---|------|------|
| 1 | 最小單位 | **A. 一場 + 一盤口 + 一揀邊** |
| 2 | 必填欄位 | 對賽識別 · 盤口 · 揀邊 · **賠率** · **stake（必填）** |
| 3 | 儲存 | **Server + Postgres**，**per 登入用戶** |
| 4 | 結算 | **自動**對 server 已有賽果／settlement 邏輯 |
| 5 | 賽程「我有買」 | **開小表單**：揀盤口 + 揀邊 + 賠率 + stake |
| 6 | 列表放邊 | **新 nav 頁**（建議文案：「注單」或「績效」；與「表現」分開） |
| 7 | 今日卡「我有買」 | **預填小表單**：盤口／揀邊／隊名由卡帶入；`bestQuote` 預填賠率；必填 stake |
| 8 | Link 強度 | 存 **`fixtureId` / `matchId`**；可跳轉／顯示同場；**唔強制**必須有系統 fixture |
| 9 | 用戶範圍 | **Per session 登入用戶**（`user_id`） |
| 10 | v1 UI 內容 | **注單列表 + 場數／中率**；**唔顯示損益** |
| 11 | 中率規則 | 見 §4 |

---

## 4. 中率 vs 背後損益（重要）

| 層 | 規則 |
|----|------|
| **UI 中率** | 半中 → **當中**；半錯 → **當錯** |
| **UI 中率分母** | 只計已結算；**走盤唔入分母**；另顯示「走 n」 |
| **DB／server 損益** | 按完整 settlement 計金額（半中／半錯用半注邏輯）；**v1 畫面唔 render 損益**，但要 **可重算、可查** |

建議 settlement enum 同現有系統對齊：  
`win` | `half-win` | `push` | `half-loss` | `loss` | `void` | `pending`（未結算）

**UI 命中計數（示意）：**
```
中場數 = count(win) + count(half-win)
錯場數 = count(loss) + count(half-loss)
中率   = 中場數 / (中場數 + 錯場數)   // push 唔入
```

**背後損益（示意，實作時用同一套亞洲結算）：**
```
win       → +stake * (odds - 1)
half-win  → +stake * (odds - 1) / 2
push      → 0
half-loss → -stake / 2
loss      → -stake
```
（具體公式以 server 既有 `settlement` / Asian line 實作為準，避免再分叉。）

---

## 5. 三個入口行為

### 5.1 今日卡（`PickCard` / `BuyableOpportunity`）
- 掣文案建議：**「我有買」**
- 撳 → modal／sheet：
  - 唯讀或預填：隊名、盤口、揀邊、`sampleId`、`fixtureId`、預設賠率（`bestQuote.odds`）
  - 可改：賠率
  - 必填：stake
- 存成功：掣可變「已記」或列表有一筆；允許同一卡再記第二注？**未決——建議 v1 允許同 key 多筆（不同 stake/odds），或 unique 約束之後再 grill。**

### 5.2 賽程表（`FixturesPage`）
- 每場掣：**「我有買」**
- 撳 → 小表單：
  - 預填：隊名、`matchId`／`fixtureId`（若有）、開賽
  - 用戶揀：盤口、揀邊、賠率、stake
- 存成功後可從績效頁認到同一 `matchId`／`fixtureId`

### 5.3 績效頁手動入
- 「新增注單」：
  - 可 **搜／揀** 已知 fixture（link）
  - 或純手動：打隊名文字 + 盤口等（`fixtureId` 可 null）
- 有 link 嘅先享受自動結算；無 link 要人手結算或之後補 link（**v1 可規定：無 link 暫時只 pending，或允許人手標——未決，建議 v1：無 fixture link 則 settlement 人手或保持 pending**）

**建議補一刀（若確認前未反對即採納）：**  
無 `fixtureId`/`matchId` 嘅手動注 → v1 **只允許 pending／人手標中錯**；有 link 先自動結算。

---

## 6. 資料模型（概念稿 · 實作可微調）

### 6.1 表建議名：`user_bets`（或 `bet_slips`）

| 欄 | 說明 |
|----|------|
| `id` | PK |
| `user_id` | 登入用戶（auth） |
| `fixture_id` | nullable UUID，link fixtures |
| `match_id` | nullable text，provider／顯示用 |
| `sample_id` | nullable，今日卡來源 opportunity |
| `home_team` / `away_team`（+ zh） | 顯示用快照，防 fixture 改名 |
| `commence_time` | 可空 |
| `market` | `h2h` \| `totals` \| `corners` \| `handicap` |
| `selection` | `home` \| `draw` \| `away` \| `over` \| `under` |
| `line` | nullable |
| `odds` | decimal，必填 |
| `stake` | decimal，必填 |
| `settlement` | 見 §4 |
| `settled_at` | nullable |
| `unit_profit` 或 `profit_amount` | **背後計算結果**，UI v1 唔顯示 |
| `source` | `today_card` \| `fixtures` \| `manual` |
| `created_at` / `updated_at` | |

Index 建議：`(user_id, created_at desc)`、`(user_id, fixture_id)`、`(user_id, settlement)`。

### 6.2 API（概念）
- `GET /api/v1/bets` — 當前用戶列表 + summary（場數、中、錯、走、中率；**唔回 profit 給前端亦可，或回但前端唔 render**）
- `POST /api/v1/bets` — 建立
- `PATCH /api/v1/bets/:id` — 改 stake/odds（可選 v1）
- `DELETE /api/v1/bets/:id` — 刪（可選 v1）
- 結算：寫入 path 或 cron／喺 `GET` 時 lazy settle 未結算且已有賽果嘅注

---

## 7. UI／路由

| 項目 | 建議 |
|------|------|
| Nav | 今日 · 賽程 · **注單**（或績效）· 表現（模型） |
| Route | `#/bets` 或 `#/ledger` |
| 今日 | `PickCard` 加掣 |
| 賽程 | 每 row 加掣 |
| 共用 | 同一 `BetForm` 元件（prefill 來源不同） |

---

## 8. 驗收準則（實作後）

1. 登入用戶 A 嘅注，用戶 B **睇唔到**。  
2. 今日卡可一掣開表單，預填盤口／揀邊／賠率，填 stake 可存。  
3. 賽程「我有買」可開表單，選盤口後可存，並帶 `matchId`／`fixtureId`。  
4. 績效頁可列表、可手動新增（可選 fixture link）。  
5. 有 link + 有賽果 → settlement 自動更新；半中 UI 算中、半錯算錯；走唔入中率。  
6. DB 有正確金額損益欄（或可重算）；**UI 無損益數字**。  
7. 唔改壞現有 unified 推薦引擎（ADR 0001）。  
8. migration + API tests + 基本 UI／unit tests。

---

## 9. 風險與未決

| 風險／未決 | 建議預設 |
|------------|----------|
| 同一卡／同一 key 可否多注 | v1 **允許**多筆 |
| 無 fixture link 嘅自動結算 | v1 **唔自動**；人手或 pending |
| 半中 UI 當中是否改權重中率 | **唔改**；只影響標籤分桶 |
| 結算同 backtest 算法分叉 | 重用 server settlement 模組；勿 client 自計 |
| Nav 文案「注單」vs「績效」 | 實作前定一：**建議「注單」**（表現＝模型） |
| 與架構 #4 identity | 注單 key 盡量用 canonical market/selection |

---

## 10. 建議實作順序（PR 切法）

1. **DB migration** + repository + domain settle hook  
2. **API** CRUD（最少 create + list + summary）  
3. **共用 `BetForm`**  
4. **今日卡入口**  
5. **賽程入口**  
6. **新頁 `#/bets` 列表 + 手動入 + 中率**  
7. Deploy（記得 entrypoint LF）

流程上可用：`/to-spec` → `/to-tickets` → `/implement`，或細就直接 implement。

---

## 11. 共享理解（一句）

> **個人注單**（場+盤+邊+賠率+stake），Postgres per user，三入口（今日預填／賽程表單／績效手動可 link fixture）；自動結算；**UI 中率把半中當中、半錯當錯、走另計且唔入分母**；**金額損益只存 DB 唔上畫面**；新 nav 與模型「表現」分開。

---

## 12. 下一步

- [ ] 用戶確認本報告（或改 nav 名／多注規則）  
- [ ] 開 spec 或直接 implement PR1 migration  
- [ ] 完成後另寫 `HANDOFF-…-bet-performance-shipped.md`

---

*決策來源：2026-07-25/26 grilling session · 本文件路徑：`docs/HANDOFF-2026-07-26-bet-performance-decision.md`*
