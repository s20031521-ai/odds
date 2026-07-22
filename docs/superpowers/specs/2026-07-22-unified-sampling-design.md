# SPEC — Unified Buyable Odds v1

> 日期：2026-07-22
> 狀態：已批准、按 `unified-buyable-v1` 實施
> 策略目的：保存所有曾達到 3% Edge 的可買報價，並由 server 提供當前及歷史狀態。

## 1. 資料來源與責任

HKJC、The Odds API 都是 bookmaker/provider adapter；API-Football 補充角球及賽果。Collector 只負責把原始 live odds、真正 `observedAt`、provider、外部賽事 ID 及結果寫入 PostgreSQL。Provider metadata 保留作 audit，不參與 opportunity identity。

每五分鐘的 supervisor iteration 固定為：

```text
The Odds API / HDC ingest（每輪嘗試）
→ HKJC ingest（每第三輪嘗試）
→ unified sampler（每輪必定嘗試一次）
→ sleep 300 秒
```

每個 command 獨立處理錯誤；任何 provider 失敗都不可跳過 sampler。HDC 不再自行啟動 HKJC，亦不再寫舊 HDC／totals recommendation snapshot。Sampler 只讀 PostgreSQL，不會新增任何外部 API call，並以 advisory lock `unified-buyable-sampler` 防止多 instance 重複運行。

## 2. Fixture 與 opportunity identity

來源中立 fixture registry 用內部 `fixtureId` 連結多個 `(provider, externalMatchId)` alias。先重用 alias；新 alias 只在主客方向相同、正規化隊名相同、開賽時間相差不超過 10 分鐘及聯賽相容時自動合併。多於一個候選時拒絕合併並寫 audit。

一個 opportunity 的完整 identity 是：

```text
fixtureId|market|selection|line|modelVersion|strategyVersion
```

`strategyVersion` 固定為 `unified-buyable-v1`。舊 snapshot 不改寫；資料庫 `strategy_version IS NULL` 對外讀作 `legacy-v0`，亦不計入新策略 readiness。

## 3. 分析、freshness 與 observation

純分析核心執行：

```text
normalize → fixture match → canonical bookmaker dedupe → freshness
→ 四個既有模型 → 3% gate → opportunity / quote output
```

- Edge threshold 固定 `0.03`；模型參數及版本不變。
- 報價只在 `observedAt <= evaluatedAt`、相差不超過 45 分鐘及未開賽時有效。
- 同一 bookmaker 經多個 provider 重複時取真正 `observedAt` 最新者；同時刻按固定 provider tie-break，HKJC native 優先於轉售資料。
- H2H 共用 consensus；handicap、totals、corners 使用逐 bookmaker leave-one-out chance。
- `minimumBuyOdds = ceil(((1 + 0.03) / chance) × 100) / 100`。

每個 `BuyableQuote` 保存 bookmaker、provider、odds、chance、edge、minimumBuyOdds、observedAt。Snapshot 保存完整分析 inputs；公開 UI 預設只顯示合資格 quotes。

Opportunity 首次有任何 bookmaker 達標時建立一次，之後不刪除。每次真正 inputs、peer odds、model probability、observedAt 或合資格集合改變，寫一個新 fingerprint observation；完全相同重跑只延長 `lastEvaluatedAt`。後來沒有可買報價亦寫空 observation，用來表示機會消失及 closing 狀態。Observation history 不設 TTL。

## 4. Server-authoritative API 與畫面

以下 endpoint 均需登入，並以 `Cache-Control: no-store` 回傳：

- `GET /api/v1/recommendations/current`：只回傳 server 已保存、最新 observation 非空、未開賽且 quote 仍在 45 分鐘 freshness 內的 opportunities；包含 quote range、best quote、每莊 minimum buy odds 及 evaluation time。
- `GET /api/v1/predictions/observations?sampleId=<positive integer>`：按需要載入 sample 完整 observation timeline、inputs 及 buyable quotes。
- `GET /api/v1/backtest`：包含 strategy version、sample ID、first/last qualified time、return range、closing benchmark 及 observation summary。
- `GET /api/v1/odds/live`：保留 provider 與真正 observed time，供 audit／賽事分析。

舊 `POST /api/v1/predictions` 只保留 legacy compatibility，必須拒絕 `unified-buyable-v1`。Browser 不可寫新策略。

Today 顯示 exact selection/line、最近合資格價範圍、best quote、bookmaker 數量及時間；展開後才顯示逐莊 threshold、edge、provider、observedAt。不同 line 不可直接比較。專業模式只由外層加入 range panel，`src/pages/BuyDashboard.tsx` 維持零修改。

## 5. Readiness、回報與 closing

- Readiness 只計 `unified-buyable-v1`，每個已結算 `fixtureId + market` 最多一次；observation、bookmaker 或多條 line 不會增加場數。
- Opportunity 表現仍按 selection/line 分開，每個 opportunity 權重一單位。
- 每個 opportunity 以所有曾合資格價格計算最低至最高單位回報，整體顯示 lower/upper ROI range。
- Closing benchmark 是開賽前最後一次 sampler evaluation 的最佳合資格價；該次空 observation 顯示 `N/A`，但 sample/readiness 保留。
- `push` 算已結算但不算 win/loss；`void`、`unsettleable` 不計 readiness。

## 6. 結算與 terminal lifecycle

Result resolver 先經 fixture aliases 找一次賽果，再結算同場所有 selection/line。H2H、handicap、totals、corners 均以法定 90 分鐘計算，支援 win、loss、half-win、half-loss、push、void。

結果優先次序維持 MASTER HANDOFF：FOTMOB 40 > API-Football 30 > HKJC historic 20 > live 10 > legacy 0。明確取消／作廢標記 `void`。延期後七日內如識別到新 kickoff，registry 更新後繼續追蹤；由現行 kickoff 起七日仍沒有可用結果則標記 `unsettleable`，兩種 terminal state 均不再重試。

## 7. Integrity、parity 與運行驗證

`node scripts/check-data-integrity.mjs --database` 除 legacy archive 規則外，亦檢查：

- 同一 sample 重複 observation fingerprint；
- input `observedAt` 晚於 evaluation time；
- kickoff 或之後才建立的 recommendation observation。

PostgreSQL parity 顯式回報 strategy rows、`legacy-v0`／`unified-buyable-v1` 數量及 observation rows。Sampler 純函數／fingerprint smoke test：

```powershell
node scripts/unified-sampler.mjs --self-test
```

完整發布前仍需執行 Vitest、build、server/collector self-tests、PostgreSQL-backed tests、integrity/parity 及 Playwright；先備份 `git archive` 與 `pg_dump`。本規格不授權 production deploy。

## 8. 不變紅線

- 不增加 odds provider、dependency、secret 或付費 API call。
- 不改模型參數、模型版本、3% threshold 或結果來源優先次序。
- 不改寫 legacy snapshot／archive。
- 不修改 `src/pages/BuyDashboard.tsx`。
- Deployment shell 維持 portable `/bin/sh` 與 LF line endings。
