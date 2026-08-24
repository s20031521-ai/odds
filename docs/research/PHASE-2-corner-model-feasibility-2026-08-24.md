# Phase 2 研究報告:角球專用模型可行性分析

**日期:** 2026-08-24
**狀態:** ❌ 已有結果(2026-08-24):離線唔通過上影子門檻(dc 同聯賽均值打和),步驟 5–6 唔做 — 詳見 `PHASE-2-corner-results-2026-08-24.md`(內含 dc 引擎 level-drift bug 重大發現)
**目的:** 角球係你第二常玩嘅玩法,亦係 corner-loo-v1 蝕 -41.7% 嘅戰場。問題唔係「角球冇價值」,而係「用入球市場嗰套邏輯生套落角球」。本報告評估起一個真正嘅角球預測模型可唔可行。

---

## 1. 點解角球要獨立模型

- 角球同入球嘅相關性好弱(文獻大約 0.2–0.3)— 入球模型推導唔出角球分佈。
- 角球有自己嘅驅動因素:球風(邊路/傳中比重)、比賽狀態(落後一方尾段狂攻)、場地同裁判尺度。
- corner-loo-v1 嘅死因唔係角球本身,而係佢根本唔係角球模型 — 佢係「莊家分歧偵測器」,仲要喺錯價最多嘅市場度做。

## 2. 數據可行性(本地實查)

### 2.1 有咩數據

| 數據 | 狀態 | 位置 |
|---|---|---|
| 每場主/客角球(HC/AC) | **有**,五聯賽 × 七季(2019/20–2025/26),35 個 CSV | `data/historical/*.csv` 欄位 `HC`,`AC` |
| 射門(HS/AS)、射正(HST/AST) | 有,可作輔助特徵 | 同上 |
| 每場估計樣本 | 五聯賽 × 每季 306–380 場 × 7 季 ≈ **每聯賽 ~2,300 場** | 實數以匯入為準 |
| 角球歷史賠率 | **CSV 冇**(得入球市場嘅收盤價) | 見 §4 限制 |
| Live 角球賠率 | 有:HDC `alternate_totals_corners` + HKJC | 現有 collector |

### 2.2 缺口

- `team_match_history` schema(migration 006)**冇角球欄** → 需要 additive migration 008(`home_corners`、`away_corners`,nullable,同 007 xG 欄同一做法),加匯入腳本更新。呢個係半日嘅工。
- dc 引擎(`scripts/lib/dixon-coles.mjs`)嘅 `fitDixonColes` 已支援 `response` 參數(比數/xG),加一個 `corners` response 係自然延伸 — 架構可以重用。

## 3. 模型設計

### 3.1 基本形狀

同 Dixon-Coles 同構,但 response 係角球:

- 每隊兩個評分:**角球產出率**(攻)同**被角球率**(守)
- 主場修正、時間衰減 xi(要重新 tune,角球嘅衰減可能同入球唔同)
- 主客角球先當獨立 Poisson(入波嗰套 rho 低比分修正對角球未必適用 — 角球基數大,~10/場,Poisson 近似好好多)

總角球 = 主隊預期角球 + 客隊預期角球 → 直接出大細盤概率。

### 3.2 改進方向(第二版先考慮)

- 用 HST/AST(射正)做輔助特徵 — 射正多 → 對手門將撲救出底線多
- 比賽狀態調整(落後方尾段角球激增)— 臨場先有用,賽前模型可以唔做

### 3.3 驗證設計

- Walk-forward 同 Phase 1 同一切割(訓練 19/20–23/24,驗證 24/25,holdout 25/26)
- 度量:總角球嘅 log-loss / RPS、大細盤概率校準
- **基線問題見 §4** — 冇 Pinnacle 角球收盤做對手

## 4. 重大限制:冇歷史角球賠率做 ROI 基準

入球市場可以用 Pinnacle 收盤做「可唔可以贏市場」嘅離線驗證;**角球冇呢個條件**。後果:

1. 離線只可以驗證「模型預測角球數準唔準」(校準、log-loss),**唔可以離線驗證 ROI**。
2. ROI 證據只能靠**影子模式向前收集**(live 報價 vs 模型概率),即係要儲幾個月先夠 30 場。
3. 所以角球模型嘅時間線係:離線驗證預測質素 → 上影子 → 儲證據 → 先知有冇得投注。

**誠實講法:** 角球係「長線投資」Phase,唔係快贏。如果目標係短期內恢復有質素嘅推薦,Phase 1(blend)+ Phase 3(報價閘門)優先。

## 5. Live 收集嘅前置條件

而家 HDC 角球收集受 `data/priority-teams.json` gate 限制(慳 quota),而且每場每輪 1 credit。要影子收集角球證據:

- 五大聯賽應該入 priority list 或開 `HDC_CORNER_ALL=1`(會增加 quota 消耗,要估算月度成本先,需 owner 批准)
- dc-shadow 嘅 `SUPPORTED_MARKETS` 唔包角球 → 要新嘅 corner shadow builder(新 `modelVersion`,例如 `corner-poisson-v1`)

## 6. 同 corner-loo-v1 嘅關係

- corner-loo-v1 **繼續 suspended**,觀察繼續收集(研究用途)。
- 新角球模型絕唔可以重用佢嘅 LOO 邏輯;佢留低嘅 164 個推薦係反面教材,用嚟驗證 Phase 3 嘅報價閘門。
- 新模型上影子之前,**Phase 3 嘅報價質素閘門應該先上** — 否則新模型嘅影子證據都會被錯價污染。

## 7. 實作計劃

| 步驟 | 內容 | 涉及檔案 |
|---|---|---|
| 1 | Migration 008:`home_corners`/`away_corners`(additive,nullable) | `db/migrations/008_team_match_history_corners.sql`(新) |
| 2 | 匯入 HC/AC 入 team_match_history(idempotent) | `scripts/import-historical-scores.mjs`、`scripts/lib/football-data-csv.mjs` |
| 3 | dc 引擎加 `response: "corners"` | `scripts/lib/dixon-coles.mjs`(additive) |
| 4 | 離線 walk-forward:校準/log-loss/RPS + xi tuning | `scripts/dc-corners-backtest.mjs`(新) |
| 5 | Corner shadow builder(新 modelVersion) | `scripts/lib/dc-shadow.mjs` 延伸或新檔 |
| 6 | 評估 quota 成本後決定角球收集範圍 | `deploy/compose.yaml` env、priority list |

每步保持細、可獨立回滾;離線實驗(1–4)唔掂嘅話,5–6 唔做。

## 8. 通過/不通過嘅判定(預先登記)

**通過(上影子):**
- 總角球 log-loss 明顯好過聯賽均值基線
- 大細盤校準合理(唔持續高估/低估)
- 唔同聯賽之間表現穩定

**不通過(停止):**
- 模型同簡單基線(每隊歷史均值)打和 → 角球可預測性太低,放棄

## 9. 時間線預期

- 離線部分(步驟 1–4):數日工作量,完全本地,唔使等 Phase 0
- 影子證據:數月起跳(30+ 場先達初步門檻),同歐洲球季同步
- 最快有「可信角球推薦」:現實啲講係 **2026–27 球季中段**
