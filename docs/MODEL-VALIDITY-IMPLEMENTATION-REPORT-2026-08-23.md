# 玄學賭波：AI 有效度與系統可靠性實作報告

**日期：** 2026-08-23  
**狀態：** 待批准實作  
**環境：** Production PostgreSQL，只讀診斷  
**目的：** 將「系統運作差」轉化為可執行、可測試、可回滾嘅工程工作。

## 1. 執行摘要

現階段不應將玄學賭波任何現行 AI 視為已證明可用於真實下注。

- `corner-loo-v1` 係唯一達到 30 場初步信任門檻嘅現行 AI，但實際表現明顯失效：33 場獨立賽程、164 個推薦、ROI 約 **-41.7%**。
- `consensus-v1`、`hdc-loo-v2`、`totals-loo-v1` 分別只有 10、1、0 場已結算獨立賽程，全部未能驗證。
- 角球 AI 報出嘅 edge 冇正向排序能力：edge 越大，實際結果反而越差。
- HDC 同 HKJC 嘅同一場賽程經常被拆成不同 `fixtureId`，令跨來源比較失效。
- 表現頁混合不同 `strategyVersion`，並以未考慮賠率嘅「整體準確率」作主指標，會誇大或錯誤描述 AI 有效度。
- Production collector、資料庫狀態欄位及 integrity checker 存在版本／語義漂移，令健康訊號不可信。

本報告建議先停止有害推薦，再修復數據身份、評估語義及營運可信度，最後才用全新 out-of-sample 數據重新驗證 AI。

## 2. 不變約束

實作必須遵守現有決策：

1. ADR 0001：所有推薦仍只可經 `evaluateUnifiedOdds`／統一推薦管道輸出，不新增 frontend 計算捷徑。
2. ADR 0003：現有四個 AI 數學保持不變；新算法必須用新 `modelVersion`。
3. 3% edge threshold 保持不變，除非 owner 逐項明確批准。
4. 舊 snapshot／result archive 不重寫、不回填虛構欄位。
5. 30 場只係最低樣本門檻，不等於 AI 自動合格；有效度仍須通過 ROI、校準及穩健性門檻。

## 3. Production 基線

診斷時間為 2026-08-23 18:15 HKT 左右。固定 cutoff 嘅只讀有效度檢查連續執行兩次，結果一致。

| 現行 AI | 玩法 | 已結算獨立賽程 | 推薦單位 | ROI | 判定 |
|---|---|---:|---:|---:|---|
| `corner-loo-v1` | 角球 | 33 | 164 | -41.7% | 有足夠初步證據判定失效 |
| `consensus-v1` | 主客和 | 10 | 10 | +32.0% | 樣本不足；盈利集中於單一和局推薦 |
| `hdc-loo-v2` | 讓球 | 1 | 1 | +108.0% | 樣本不足 |
| `totals-loo-v1` | 大細波 | 0 | 0 | N/A | 未能驗證 |

### 3.1 角球 AI 詳細證據

- 平均預測命中率：22.3%。
- 實際命中率：15.2%。
- 預期命中 36.63 個，實際 25 個；標準化差異約 `z = -2.32`。
- 以賽程作 cluster bootstrap 嘅 ROI 95% 區間：約 **-68.9% 至 -11.7%**。
- 每場產生 1 至 13 個推薦，中位數為 5；164 個推薦只來自 33 場，不能當成 164 個獨立證據。

| 角球分組 | 推薦數 | 實際命中率 | ROI |
|---|---:|---:|---:|
| `over` | 100 | 8.0% | -75.4% |
| `under` | 64 | 26.6% | +10.9% |
| 賠率 10 倍以上 | 34 | 0% | -100% |
| edge 3–5% | 33 | 33.3% | -6.9% |
| edge 20% 以上 | 20 | 0% | -100% |

高 edge 組比低 edge 組更差，表示 `edge` 目前唔具備推薦排序能力。`under` 嘅正數結果係事後分組、樣本亦細，不可直接抽出上線，否則屬於同一批數據上揀贏家。

### 3.2 影子 AI／歷史 walk-forward

五大聯賽共約 10,951 場 walk-forward 預測，所有訓練資料均早於被預測比賽：

| 策略 | ROI |
|---|---:|
| dc-v1 主客和 | -9.66% |
| dc/blend 主客和 | -11.26% |
| dc-v1 大細波 | -2.07% |
| dc/blend 大細波 | -2.04% |
| dc-v1 讓球 | -4.02% |

主客和 Brier：dc-v1 `0.5942`，Pinnacle 收盤 `0.5777`；較低為佳。xG 版本改善至約 `0.5899`，但仍未超越市場。因此 dc／xG 只可繼續影子收集，不可升格為推薦 AI。

> **勘誤(2026-08-24,見 `research/PHASE-1-results-2026-08-24.md` §2.1):** 上文「Pinnacle 收盤 `0.5777`」同 §3.2 表嘅 ROI 數字,實際係對住 **pre-closing** 價(PSH/PSD/PSA)計算;真收盤(PSCH 等)去水 Brier 係 `0.5760`,基準更強。所有結論方向不變。另外,25/26 季起 Pinnacle 欄位受污染(覆蓋 ~50%),之後研究預設用 AvgC* 做收盤基準。

## 4. 已確認根因

### 4.1 P0 — 角球 AI 將高賠率異常誤判為高 edge

現行 LOO 方法以其他 bookmaker 同一盤口嘅去水機率作為目標 bookmaker 勝率。Production 結果顯示，異常高賠率產生嘅大 edge 並冇兌現，尤其 `over`、Betfair／Superbet 及 10 倍以上區段。

呢個結果未證明某一 bookmaker 數據必然錯誤，但足以證明現有 AI 對價格異常、長冷門及 bookmaker disagreement 缺乏有效保護。

### 4.2 P0 — 跨來源賽程身份拆分

同一場比賽、相同開賽時間，HDC 同 HKJC 仍被分成不同 `fixtureId`。已重現例子包括：

- Daejeon Citizen vs Gangwon FC：隊名及開賽時間完全相同，但聯賽為 `K League 1`／`Korean Division 1`。
- FC Machida Zelvia vs Urawa Red Diamonds：HKJC 使用 `Machida Zelvia`／`Urawa Reds`。
- Gwangju FC vs Incheon United：HKJC 使用 `Incheon Utd`。

`server/db/fixture-repository.mjs` 對聯賽採 exact canonical match，而現有 canonical map 只覆蓋少量聯賽。結果係 HKJC 價格無法同 HDC bookmaker 群組比較。

### 4.3 P1 — 表現頁評估語義錯誤

- `src/pages/PerformancePage.tsx` 嘅 overall accuracy 使用所有 backtest rows，混入 legacy 及影子策略。
- `src/App.tsx` 嘅玩法統計只按 `market + modelVersion` 過濾，沒有按 `strategyVersion` 隔離。
- 命中率沒有同賠率損益平衡點比較；長冷門推薦會令單一「準確率」失去意義。
- Readiness 顯示獨立賽程數，但表現結果以 opportunity 為一單位；畫面未清楚交代兩個分母。
- 畫面沒有 ROI、ROI range／信賴區間、預測對實際校準、edge 分組單調性。

### 4.4 P1 — 營運健康訊號漂移

- DB 一度顯示 quota 剩餘 433、門檻 5，但同時保存 `quota-reserve` blocked 狀態。
- Running collector 仍硬編碼 `MIN_QUOTA = 50`，而舊狀態欄位未被清理或持續更新。
- Integrity checker 回報 18,835 個 future inputs，但直接以 PostgreSQL timestamp 精度比較係 0；主因係 JavaScript `Date.parse(Date)` 路徑遺失毫秒。
- 1 個 personal bet 被錯誤當成 post-kick 推薦；3 個 shadow snapshot identity 被錯誤當成重複。
- Production working tree／container 行為未能由單一 clean commit 完整重現。

## 5. 實作方案

### Workstream A — 即時風險閘門（P0）

**目標：** 阻止已知失效 AI 繼續被當成可下注推薦，同時保留 snapshot 收集作研究。

實作：

1. 新增 server-side trust policy；以 `strategyVersion + market + modelVersion` 決定 `active`、`shadow`、`suspended`。
2. 將 `unified-buyable-v1 + corners + corner-loo-v1` 設為 `suspended`。
3. Suspended AI 繼續保存 observations，但 `GET /api/v1/recommendations/current` 不回傳推薦。
4. API readiness／表現頁顯示「已暫停：實際 ROI 顯著低於 0」，而唔係只顯示 33/30 完成。
5. 不改 `corner-loo-v1` 數學、不刪除歷史數據、不降低／提高 3% threshold。

預計涉及：

- `server/domain/model-trust.mjs`（新增）
- `server/app.mjs`
- `src/apiClient.ts`
- `src/pages/TodayPage.tsx`
- `src/pages/PerformancePage.tsx`

驗收：

- Suspended AI 不會出現在 current recommendations。
- 同一 AI observations 繼續寫入及結算。
- 其他 AI 行為不變。
- API/UI 明確區分「冇推薦」與「AI 被暫停」。

### Workstream B — 修復賽程身份（P0）

**目標：** 同一場 HDC／HKJC 賽程必須落入同一 `fixtureId`；未知配對仍 fail-closed。

實作：

1. 將 team alias 與 league alias 由程式常數提升為明確、可測試嘅 canonical registry。
2. 加入已確認 aliases：`Utd/United`、`Reds/Red Diamonds`、`K League 1/Korean Division 1`、`J League/Japanese Division 1` 等。
3. 保留主客方向、性別標記及 ±10 分鐘限制。
4. 加入 read-only candidate audit，列出相同 kickoff、近似隊名但不同 `fixtureId` 嘅賽程。
5. 對已存在嘅錯配資料另寫經批准 migration；migration 必須先輸出 dry-run mapping，不直接自動合併。

預計涉及：

- `server/domain/fixture-aliases.mjs`（新增）
- `server/db/fixture-repository.mjs`
- `scripts/audit-fixture-splits.mjs`（新增）
- fixture repository tests
- 如獲批准：新增一個 forward-only DB migration

驗收：

- 三個已重現日／韓賽程全部合併。
- `Manchester` 仍不可匹配 `Manchester United`。
- 男／女足仍不可合併。
- Ambiguous candidate 保持拒絕並有 audit row。
- Sampler 可在同一 fixture 同時見到 HKJC 與 HDC bookmakers。

### Workstream C — 重建有效度評估面（P1）

**目標：** 畫面回答「呢個 AI 值唔值得信」，而唔係只報一個命中率。

實作：

1. 所有現行卡及 overall 只接受 `strategyVersion === unified-buyable-v1`。
2. 影子、legacy、personal bet 各自獨立顯示，禁止混合。
3. 同時顯示：
   - 已結算獨立賽程；
   - 推薦單位數；
   - 實際命中率；
   - 平均損益平衡命中率；
   - ROI lower/upper；
   - cluster bootstrap 95% ROI 區間；
   - predicted vs actual calibration；
   - edge bucket ROI／單調性。
4. Readiness 狀態改為兩段：`sample-ready` 與 `performance-trusted`。
5. 只有樣本達標且 ROI 區間／校準規則通過先可顯示 `performance-trusted`。

預計涉及：

- `server/domain/backtest.mjs`
- `src/apiClient.ts`
- `src/performanceMetrics.ts`
- `src/App.tsx`
- `src/pages/PerformancePage.tsx`

驗收：

- 角球顯示 33 場／164 推薦，而唔係將兩者混為一談。
- Overall 不含 legacy／shadow／personal bet。
- ROI 無價格時顯示 N/A，唔顯示 0%。
- 固定 production fixture 可重現 -41.7% ROI 與負 ROI 區間。

### Workstream D — 修復營運可信度（P1）

**目標：** 系統狀態、integrity command 同實際 collector 行為一致。

實作：

1. `HDC_MIN_QUOTA` 成為唯一 quota reserve source；移除硬編碼 50。
2. 每次 state save 都重新計算 blocked flag／reason，唔保留失效欄位。
3. Integrity analyzer 先將 PostgreSQL `Date` 正規化為 ISO，再比較毫秒。
4. `personal-bet-v1` 不套用推薦嘅 post-kick invariant。
5. Snapshot duplicate identity 支援所有 opportunity-shaped shadow strategies。
6. 部署 image 加入 commit SHA／build timestamp，啟動時輸出但不包含 secret。
7. Production deploy 必須由 clean、已提交檔案建立；禁止以長期 dirty working tree 作版本來源。

預計涉及：

- `scripts/hdc-collector.mjs`
- `scripts/check-data-integrity.mjs`
- `deploy/compose.yaml`
- `deploy/api.Dockerfile`
- `deploy/collector-entrypoint.sh`
- 對應 unit／PostgreSQL tests

驗收：

- quota 433／reserve 5 時不得顯示 quota blocked。
- 真實 future inputs 為 0 時 integrity 必須 green。
- 人手後補不會被當成 post-kick AI 推薦。
- 真正 post-kick unified observation 仍會令檢查失敗。

### Workstream E — 新 AI 驗證流程（P2）

**目標：** 防止再用「30 場」或單次 ROI 當成已證明有效。

實作：

1. 保持 dc／xG／market-sharp 為 shadow。
2. 為每個 `market + modelVersion + strategyVersion` 保存固定評估卡：Brier、log-loss、ROI、校準、edge monotonicity、最大回撤。
3. 調參資料、validation、final holdout 按時間切割；final holdout 一次性開封。
4. 所有 bookmaker／方向／賠率範圍限制必須預先登記，禁止睇結果後抽取 `under` 贏家。
5. 與簡單基線比較：Pinnacle／市場去水概率、永不下注、現行 consensus。

建議升格門檻：

- 至少 30 場先顯示 preliminary；正式信任應累積更多獨立賽程。
- Holdout ROI 點估計大於 0，且區間不應顯示明顯負期望。
- 校準不應持續高估；edge bucket 應有合理單調性。
- 預測分數至少不差過指定市場基線。
- 結果需跨聯賽／時間段穩健，而唔係靠單一方向或一注長冷門。

## 6. 建議提交次序

每一步保持細、可獨立回滾：

1. `test: reproduce suspended corner model trust verdict`
2. `feat: add server-side model trust policy`
3. `test: reproduce cross-provider fixture splits`
4. `fix: canonicalize approved team and league aliases`
5. `feat: audit unresolved cross-provider fixture candidates`
6. `test: isolate performance rows by strategy version`
7. `feat: report independent matches, ROI intervals and calibration`
8. `fix: align collector quota state with runtime policy`
9. `fix: remove integrity checker timestamp and identity false positives`
10. `chore: stamp production images with reproducible build metadata`

任何歷史 fixture 合併 migration 必須獨立 commit，並先備份 PostgreSQL。

## 7. 測試與回饋迴圈

### 7.1 模型有效度紅燈

建立固定 production-derived fixture，斷言：

- 四個現行 AI 目前整體 verdict 為 `not-trusted`；
- `corner-loo-v1` 為 `suspended`；
- 33 場／164 推薦／約 -41.7% ROI 不會因 UI 聚合改動而漂移。

### 7.2 Fixture matching

最少包括：

- Daejeon／Gangwon 跨聯賽名稱成功合併；
- Machida／Urawa aliases 成功合併；
- Gwangju／Incheon aliases 成功合併；
- women vs men、Manchester vs Manchester United 保持不合併；
- 多候選保持 ambiguous。

### 7.3 全套驗證

```text
npm test
npm run build
node scripts/unified-sampler.mjs --self-test
node scripts/hdc-collector.mjs --self-test
node scripts/hkjc-import.mjs --self-test
node scripts/check-data-integrity.mjs --database
npm run test:ui
```

Production smoke 另需驗證：

- API、Caddy、PostgreSQL healthy；
- HKJC／HDC freshness 真實；
- current recommendations 不包含 suspended AI；
- 表現頁分母、ROI、策略版本正確；
- 無任何 paid provider call 由 browser 發出。

## 8. 部署與回滾

部署順序：

1. 修復 integrity checker 與測試環境，先恢復可信 feedback loop。
2. 上線 model trust policy，立即停止角球推薦。
3. 上線 fixture alias 修復；先 dry-run audit，後做有限 migration。
4. 上線表現頁新指標。
5. 最後處理新 AI 實驗，唔同營運修復混合部署。

回滾：

- 每次 deploy 前建立 image tag 及 `pg_dump`。
- Trust policy 可回滾 code，但不得刪除期間收集嘅 observations。
- Fixture migration 必須有 inverse mapping；如 parity 不符，回復 DB backup。
- 新 UI fields 必須 additive，舊 frontend 可安全忽略。

## 9. 完成定義

本輪修復只有在以下全部成立先算完成：

- `corner-loo-v1` 不再輸出可下注推薦，但仍收集影子證據。
- 已確認跨來源賽程全部正確共用 `fixtureId`。
- 表現頁不再混合策略，並同時呈現獨立賽程、推薦數、ROI 及不確定性。
- Integrity checker 對 production 真實數據為 green，且保留捕捉真污染能力。
- Collector quota／freshness／blocked 狀態與實際行為一致。
- Production image 可追溯至 clean commit。
- 所有現行及影子 AI 均維持 `not-trusted`，直至新 holdout 證據通過預先定義門檻。

## 10. 額外安全事項

本機 `deploy-now.ps1` 含明文管理員憑證。實作前應：

1. 更換相關密碼；
2. 從 script 移除明文；
3. 改用互動式 sudo、短期 askpass 或受權限保護嘅 secret file；
4. 確認該檔案及歷史版本沒有進入 Git／部署 artifact。

本事項獨立於 AI 有效度，但屬 P0 安全風險。
