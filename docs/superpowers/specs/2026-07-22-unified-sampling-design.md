# SPEC — 統一採樣（Unified Sampling / Option B）

> 日期：2026-07-22
> 狀態：待 owner 批
> 背景文件：`docs/HANDOFF-2026-07-22-post-kickoff-gate.md` §5-6、`MASTER-HANDOFF-v1.2.0.md` §11.2
> 一句講晒：**推薦層早已跨莊（`groupByFixture`），呢個 phase 補齊下游 — 採樣同結算管道，令「畫面出嘅每個值得買建議都自動變 sample」。**

---

## 1. 問題

Owner 嘅目標：「最值得買嘅建議」，唔係「最值得喺 HKJC 買嘅建議」。現狀三個結構性缺口：

1. **主客和／角球冇自動採樣路徑** — `hdc-collector` 淨寫亞洲讓球＋大細波；`hkjc-import` 完全唔寫 snapshot。主客和／角球嘅 sample 全靠 owner 登入開 app（client effect）先記到。
2. **採樣範圍 vs 顯示範圍唔一致** — `toSnapshot` 主客和／角球淨記 `hkjc-` 場，但 UI 顯示跨莊 pick（實例：Larne「買主勝 @16.00」出咗街但冇記錄）。
3. **國際盤場缺主客和／角球結果行** — `scoreRows` 硬編碼淨寫亞洲讓球＋大細波結果；冇結果嘅 snapshot 注定永遠唔 settle（實例：3 條 12/7–13/7 死 pending）。

## 2. 目標

- 四個市場 × 兩個來源（HKJC / the-odds-api）嘅「買」pick 全部**自動、server-side**落 snapshot，唔再依賴 owner 開 app。
- 所有落咗嘅 snapshot 喺對應來源嘅結果覆蓋入面**一定 settle 到**（唔再製造死 pending）。
- 30 場 readiness 成為「最值得買策略（跨莊）」嘅真實樣本，而唔係「HKJC 限定」嘅樣本。

## 3. 非目標（紅線，寫死）

- ❌ 唔郁模型參數：weights、`recentWeight`、Kelly、stake cap、`BUY_EDGE_THRESHOLD = 0.03`、模型版本字串（`consensus-v1` / `totals-loo-v1` / `corner-loo-v1` / `hdc-loo-v2`）。
- ❌ 唔郁 `BuyDashboard.tsx` / `BuyDashboard.test.tsx`。
- ❌ 唔做 canonical match identity（Option A  Deferred；`groupByFixture` 而家夠用）。
- ❌ 唔郁 result priority（FOTMOB 40 > API-Football 30 > HKJC historic 20 > live 10 > legacy 0）。
- ❌ 唔郁 snapshot immutability（identity `matchId|market|line|modelVersion`，first-wins）。
- ❌ 唔加新付費 API call 類型（主客和用嘅 h2h 賠率本來就喺 25 分鐘窗口拎緊；角球結果 backfill 行 API-Football 現有每日 90-call budget）。
- ❌ 模型版本字串**唔升** — 採樣範圍擴大係管道修正，唔係模型變更（見 §9 開放問題 O1，要 owner 確認）。

## 4. 現狀關鍵事實（實作時嘅 anchor）

- `src/fixtureMatch.ts` `groupByFixture`：隊名正規化 + 開賽 ±10 min 跨來源分组；組內有 HKJC 行就用 `hkjc-` matchId 做 key，否則用第一個 entry 嘅 id（the-odds-api 場 = hex id）。
- Client snapshot（`src/App.tsx` `collectPredictionSnapshots` + `toSnapshot`）：主客和 `consensus-v1` 無 line、無 edge（得 prediction/chance/odds）；大細波 `totals-loo-v1`、角球 `corner-loo-v1`、亞洲讓球 `hdc-loo-v2` 有 line/edge/odds/bookmaker。
- 主客和 label：snapshot prediction ∈ `主勝|和局|客勝`（`src/odds.ts` outcomeLabels）；結果 actual 同樣 `主勝|和局|客勝`（`hkjc-import` `actualHad`，和局唔係「和」）；`backtest.mjs` `normalize()` 兩邊都接。
- `hdc-collector` `collectOdds` 已經喺 25 分鐘窗口拎 `h2h,spreads,totals`（US 區）+ `alternate_totals_corners`（EU 區，逐場），並經 Vite SSR load `src/oddsApi.ts`、`src/handicap.ts`。
- `hkjc-import` 而家**冇** Vite SSR load 任何 `src/` 模型代碼（呢點同 hdc-collector 唔同，係 item C 嘅主要新 coupling）。
- Snapshot 寫入：server `snapshot-repository.insertBatch` 分類（invalid drop 計數、valid-current/legacy insert、`ON CONFLICT (identity_key) DO NOTHING`）。
- 3 條 12/7–13/7 死 pending 係歷史遷留，**唔喺呢個 phase 清**（見 §9 O3）。

## 5. 改動（Stage 1 — 核心，一次部署）

### A. `hdc-collector.mjs` `scoreRows` 加主客和結果行

- 每個 completed event 而家出 2 行（`亞洲讓球`、`大細波`），加多 1 行：
  `{ id: `${event.id}-odds-had-result`, market: "主客和", actual: actualHadLabel(home, away) }`
- `actualHadLabel(home, away)`：`home > away → "主勝"`、`home < away → "客勝"`、`home === away → "和局"`（同 `hkjc-import` `actualHad` 嘅 label 完全一致；抽出共用或喺 collector 內複製細 helper + test 鎖 label）。
- 結果經現有 `store.saveResults` → priority upsert（the-odds-api scores 嘅 priority 沿用現行 source 規則，唔郁 priority table）。

### B. `src/App.tsx` `toSnapshot` 取消 hkjc-only 限制

- 而家：`(market !== "亞洲讓球" && market !== "大細波" && !matchId.startsWith("hkjc-")) || ...` → return []。
- 改做：所有市場任何來源都記（保留「唔買唔記」+「賽後唔記」兩條）。
- Client 路徑保留做 fallback（first-wins 唔會撞重複）；唔刪。

### C. `hkjc-import.mjs` server-side 自動 snapshot（主客和 + 角球）

- 每次 import 成功寫完 live odds 後：
  1. Vite SSR load `src/odds.ts`（`analyzeEntries`）、`src/picks.ts`（`bestH2hPick`）、`src/corners.ts`（corner cards builder）— 跟 `hdc-collector` 嘅 SSR pattern。
  2. 用啱啱 import 嘅 HKJC h2h entries 組 `ManualEntry[]`（bookmaker `"HKJC"`），`analyzeEntries` → 逐 fixture `bestH2hPick(rows, 0.03)`；label 係「買 …」就落 snapshot：prediction = label 去「買 」前綴、chance = fairProbability、odds = best.odds、無 line/edge、`modelVersion: "consensus-v1"`、`source: "hkjc-import:market-consensus"`、`savedAt` = 而家、`commenceTime` 賽前先記。
  3. 用 HKJC corner entries 起 corner cards，買大角/買細角 → snapshot：`corner-loo-v1`、`source: "hkjc-import:leave-one-out"`、帶 line/chance/edge/odds/bookmaker。
- `store.saveSnapshots`（postgres sink 已有）；idempotent — 每 15 分鐘重跑靠 identity first-wins。
- 時滯說明（寫入文件）：pick 喺兩次 import 之間出現又消失會 miss — 可接受，唔加輪詢密度。

### D. `hdc-collector.mjs` 加主客和 snapshot

- `collectOdds` 入面，`h2hEntries` 已經有；SSR 加 load `src/odds.ts` + `src/picks.ts`：
  - `analyzeEntries(h2hEntries 轉 ManualEntry[], { edgeThreshold: 0.03, ...analyzerDefaults })` → `groupByFixture` 自动跨莊 pool → 逐 fixture `bestH2hPick` → 「買」就 snapshot：`modelVersion: "consensus-v1"`、`source: `background:${sport}:market-consensus``、prediction/chance/odds 同 client 形狀（無 line/edge）。
- 注意：`analyzeEntries` 嘅 settings 需要 bankroll/kelly 等 — stake 喺 server 唔用，填 repo defaults（1000/0.25/0.02/0.03，同 `App.tsx` 一致），並喺 test 鎖死「stake 唔影響 snapshot 內容」。

### E. 邊界案例（Stage 1 就要處理）

- **延期/取消**：the-odds-api `completed=false` 或冇 scores → 冇結果行 → pending 留低（沿用現行 overdue 行為；唔新增清理邏輯）。
- **first-wins 撞 key**：client 同 server 同一場先後記 → 第一個為準（既有語義，唔郁）。
- **單莊組**：`groupByFixture` 淨係一個 bookmaker 時 consensus = 自身去水後機率，edge ≈ 0 → 唔會出「買」→ 唔記（唔使特別處理，test 鎖住行為）。
- **label 一致性**：主客和 actual/prediction 一定要 `主勝|和局|客勝`；test 逐字鎖。
- **賽後先跑到嘅 import/collector**：`savedAt >= commenceTime` 會俾 policy 分類 invalid `post-kickoff` 並 drop — server 端記之前自己都 check 一次（慳 DB 寫入 + rejected 計數乾淨）。

## 6. 改動（Stage 2 — 延伸，可同批可分批）

### F. 國際盤角球採樣 + 結果

- `hdc-collector`：用已拎嘅 `alternate_totals_corners`（EU 區）entries 起 corner cards（SSR `src/corners.ts`），「買」→ snapshot `corner-loo-v1`（hex matchId）。
- `hkjc-import` `fetchApiFootballCornerOdds` / `fetchApiFootballCornerResults`：wanted set 由「`hkjc-` 場」擴到「任何有角球 snapshot 嘅場」；hex 場嘅英文名 + 開賽時間由 collector state `events` 提供（matching 邏輯不變：English names + kickoff ±10 min）。
- 風險：API-Football 每日 90-call budget；六角場會增加 call 數 — 加 budget 守衛嘅 test，超支行為 = 當日 skip（現有行為）。

## 7. 測試計劃（TDD，全部 RED 先）

| 層 | 測試 |
|---|---|
| `hdc-collector --self-test` + node:test | scoreRows 出 3 行（主客和 label 逐字）；主客和 snapshot 形狀同 client 一致；賽後唔記；quota<50 唔記 |
| `hkjc-import --self-test` + node:test | 主客和「買」→ snapshot `consensus-v1`；角球「買大角/細角」→ snapshot `corner-loo-v1`；唔買唔記；idempotent（跑兩次唔dup） |
| disposable DB（`scripts/*-pg.test.mjs` pattern） | insertBatch 兩路徑撞 key first-wins；settlement：hex 主客和 snapshot × scoreRows 結果行 → settled |
| Vitest | `toSnapshot` 放寬後：hex 主客和/角球記到；賽後/唔買照舊唔記 |
| Playwright | 預期零改動（mock 唔經新路徑）；跑一次確認 |
| Parity | `check-postgres-parity.mjs` 照跑（archives 唔郁） |

## 8. 部署計劃

- server + client 都有改動 → **rebuild api + caddy 兩個 image**（跟 v1.2.0 流程：`git -c core.autocrlf=false -c core.eol=lf archive`、pg_dump、tag rollback、smoke）。
- Stage 2 若分批：第二次部署淨 api（collector/server 改動）。
- 上線後觀察 48 小時：`prediction_snapshots` 新增速率、死 pending 有冇再生、API-Football budget、The Odds API quota 燃燒率（預期：零新增付費 call）。

## 9. 開放問題（要 owner 答）

- **O1（重要）**：採樣範圍擴大後，`consensus-v1` / `corner-loo-v1` 嘅 30 場樣本會變「混莊」。兩個取態：(a) 版本字串唔變，當管道修正（spec 預設）；(b) 升做 `consensus-v2` / `corner-loo-v2`，舊 sample 歸檔重新儲 — 更誠實但 readiness 歸零重嚟。**建議 (a)**，因為模型計算本身冇變，變嘅只係「邊啲 pick 被記錄」。
- **O2**：Fenerbahce 嗰 1 場已 settled sample 保留照計（HKJC 場，新舊規則都記到）— 唔使郁。
- **O3**：3 條死 pending（12/7–13/7）留唔留？建議另開細 task 加「過期 X 日標記 archived」或者手動清，唔阻呢個 phase。

## 10. 驗收標準

1. 唔使開 app，HKJC 場主客和/角球「買」pick 喺 15 分鐘內自動出現喺紀錄頁「等緊開賽」。
2. 國際盤主客和「買」pick 喺開賽前 25 分鐘窗口內自動落 snapshot，完場後 settle。
3. 四個市場 readiness 開始自然增長；冇新死 pending（有結果覆蓋嘅場先記到）。
4. 全部測試綠：Vitest、tsc、server node:test、scripts self-test、disposable DB tests、Playwright 84/84。
5. The Odds API quota 燃燒率冇明顯上升。

---

*Spec 完。批咗之後按 superpowers SDD：plan → tasks → TDD 實作 → review → 部署 → 寫 dated handoff。*
