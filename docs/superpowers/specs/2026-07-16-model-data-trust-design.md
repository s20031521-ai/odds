# Odds Tool Batch 2：模型數據可信度設計

日期：2026-07-16

## 目標與邊界

令 current-model readiness、hit rate、ROI、calibration 同樣本數只使用可證明為開賽前、欄位完整、盤口合法嘅 snapshots；保留所有原始 archive 作 audit，不刪除、不回填、不重寫歷史資料。今批同時收緊跨 provider fixture matching，避免錯誤合併污染結算。

今批不改 3% edge threshold、不調模型參數、不製造 picks、不呼叫付費 Odds API，亦不處理下一批嘅 CORS、request size、認證或 concurrent archive writes。

## 方案比較

### A. 讀取時分類，寫入時拒絕（採用）

新 snapshots 在 browser storage 與後端寫入入口按同一規則驗證；舊 archive 每次讀取時分類為 `valid-current`、`legacy` 或 `invalid`。統計只接收 `valid-current`，但 raw rows 同分類原因仍保留供 audit。

優點：不改 archive、可逆、即時阻止新污染、容易用針對性測試證明。代價：前後端各有一個細小 validator，需要 contract tests 防止規則漂移。

### B. 一次性 migration 修補舊 archive

替舊 rows 補 `commenceTime`、odds 或 modelVersion，再重寫 JSONL。

不採用：無可靠來源證明缺失值，回填會製造虛假證據，亦破壞 immutable archive。

### C. 建立全新 v2 archive，只看新數據

舊 archive 完全封存，所有統計由空白重新開始。

不採用：隔離最乾淨，但會令現有可驗證 current rows 一併失效，並增加兩套 archive／API 路徑嘅營運負擔。

## Snapshot 分類與驗證

### `valid-current`

必須同時符合：

- `matchId`、`market`、`prediction`、`savedAt`、`commenceTime`、`modelVersion` 為非空字串。
- `modelVersion` 不可為 `legacy-v0`。
- `savedAt` 與 `commenceTime` 可解析，且 `savedAt < commenceTime`。
- `odds` 為有限數字且大於 1。
- `chance` 為有限數字且介乎 0 至 1（包含端點）。
- `edge` 如有提供，必須為有限數字。
- 大細波、角球、亞洲讓球必須有有限 `line`，而且為 0.25 嘅整數倍。
- prediction 不可為空、`唔買` 或「沒有賽前 snapshot」類 placeholder。

### `legacy`

缺少 `modelVersion` 或明確標示 `legacy-v0`。legacy rows 只可出現在 raw/all audit view，不得進入 current readiness、hit rate、ROI 或 calibration。

### `invalid`

聲稱屬於 current model，但未通過任何 `valid-current` 規則。API 回傳穩定 reason code，例如 `missing-commence-time`、`post-kickoff`、`invalid-odds`、`invalid-chance`、`missing-line`；不修改原 row。

後端 `POST /api/predictions` 只持久化 `valid-current`。如一批全部無效，回 400；部分有效則保存有效 rows，並回傳 rejected 數量及按 reason 分組嘅拒絕摘要。browser local storage 使用相同規則，不保存後端必然拒絕嘅 row。

## Backtest、readiness 與 UI 資料流

1. 後端讀取 UI/background snapshots 後保持 immutable merge。
2. 每個 snapshot 先分類；只有 `valid-current` 進入 settlement、readiness 同 current-model summaries。
3. API 另外回傳 `snapshotQuality`：raw、valid-current、legacy、invalid 數量及 invalid reasons。
4. History `comparable` 同 Analysis 只使用 `valid-current` rows；`all` view 可保留 raw result rows，但 invalid snapshot 不可偽裝成可比較 prediction。
5. UI readiness 顯示 quality 摘要，令使用者見到有幾多 legacy／invalid rows 被隔離。

183 個現有 snapshots 會原封不動留在檔案內；缺少 `commenceTime` 嘅 180 rows 必須全部無法進入 current-model 統計。

## Distinct-match 統計與 ROI

所有模型表現統計先按 `market + modelVersion + matchId` 去重。同一場同一模型有多條盤口時，只揀一條代表 pick：

1. 有效且 `edge` 最大；
2. edge 相同時取最早 `savedAt`；
3. 再相同時用 line／snapshot identity 作穩定排序。

`matches`、`finished`、win/loss/push、hit rate、calibration 都以代表 pick 計算，避免同一場多線放大樣本。ROI 只用代表 pick 中 `odds > 1` 且已 settlement 嘅 rows；UI 同時顯示 distinct settled matches 同 priced matches。半贏、半輸、走盤沿用現有 profit 規則。

## Fixture matching

保留 10 分鐘 kickoff tolerance，但移除任意 substring matching：

- 正規化重音、大小寫、標點及純 club suffix（FC、AFC、CF、BK、IF、SK）。
- 性別標記（Women、W、Ladies、女足）必須保留並一致；女足不可同男足合併。
- suffix 移除後必須 exact canonical match；`Manchester` 不可匹配 `Manchester United`。
- 現有 `Djurgardens`／`Djurgårdens IF`、`Halmstads`／`Halmstads BK` 必須繼續匹配。
- 如將來需要非 exact provider aliases，使用明確 alias table，唔恢復模糊 substring。

錯誤合併比未合併危險，因此未知 alias 採取 fail-closed。

## 錯誤處理與兼容

- archive parse 或原始 result 行為今批不改。
- 新增 API fields 只係 additive，現有前端 consumers 不會因缺欄位崩潰。
- invalid row 保留 reason，但不得 settle、不得計 current stats。
- 缺 `matchId` 嘅 rows 不可用 index 偽裝成 distinct match；歸類 invalid。

## 測試與驗收

按 TDD 每項先建立失敗測試：

- 前端 storage 與後端入口：缺時間、post-kickoff、odds 0/1、chance 超界、缺 line、非 quarter-line、合法 1X2／亞洲盤。
- backtest：legacy/invalid 隔離、183/180 現況分類、readiness 不受污染、reason counts。
- 統計：同場多線只計一個 match；最高 edge 選擇；priced-only ROI；half-win／half-loss／push。
- fixture matching：women vs men、Manchester vs Manchester United 不匹配；accent/suffix aliases 與 10 分鐘 tolerance 繼續匹配。
- contract：前後端對同一組 fixtures 得到相同 accept/reject 結果。

完成門檻：新增針對性測試、全套 Vitest、4 個 self-tests、`check:data`、production build 全部通過；黑箱確認 Analysis 顯示隔離摘要，而 current stats 不包含 legacy/invalid rows。

## 實作次序

1. Snapshot policy 與前後端寫入驗證。
2. Backtest read-time classification、quality summary、current-only readiness。
3. Distinct-match representative selection 與 priced-only performance。
4. Fixture canonical matching。
5. UI quality audit summary、完整回歸及黑箱驗證。
