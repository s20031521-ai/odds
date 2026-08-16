# AI-SYSTEM-CONFIG — 玄學賭波（odds-tool）系統配置總覽

> **用途：** 俾任何 AI 助手（Claude、Codex、Kimi、GPT 等）快速理解成個系統嘅現況。
> 呢份文件根據 **2026-08-16** 嘅實際程式碼同 git 狀態整理，涵蓋 `MASTER-HANDBOOK-v1.2.6.md` 之後嘅最新改動。
>
> **衝突處理次序：** ① 現行程式碼 / production 行為 → ② 本文件 → ③ `docs/MASTER-HANDBOOK-v1.2.6.md` → ④ 其他歷史 handoff 文件。

---

## 1. 系統概述

| 項目 | 內容 |
|---|---|
| 系統名稱 | **玄學賭波**（repo 名 `odds`，package 名 `odds-value-analyzer`） |
| 用途 | 單一 owner 使用嘅足球賠率價值分析 PWA；AI 引擎計邊啲盤口「值博」，**唔落注、唔保證盈利** |
| 目前版本 | v1.2.6+（package.json `1.2.6`，之後有未打 version bump 嘅新 commit） |
| 程式基線 | `5e7975a`（master HEAD，2026-08：Cyber-Metric Dark 配色） |
| Repo | `https://github.com/s20031521-ai/odds.git`（branch: `master`） |
| Production | <https://odds.ballballchu.com.hk> |
| 本地路徑 | `C:\Users\Hugo\Documents\賭` |
| 語言 | UI / 文件用繁體中文（粵語書面語）；程式碼註釋中英混合 |

### Handbook v1.2.6 之後嘅重要改動（必讀）

1. **登入系統已移除**（commit `8b9cfbb`）— 改為單機單 owner 開放部署。冇咗 `POST /api/v1/auth/login`、`/api/v1/session`、CSRF 等；server 啟動時用 `resolveOwnerId` 解析唯一 owner，所有請求直接當係該 owner。
2. **注單支援更新同刪除**（commit `a17d6b5`）— 新增 `PATCH /api/v1/bets/:id` 同 `DELETE /api/v1/bets/:id`（handbook 寫「未有 PATCH/DELETE」已過時）。
3. **UI 大改：Obsidian Neon → Cyber-Metric Dark**（commit `a17d6b5`、`5e7975a`）— 霓虹紫紅 `#FF007A` 主色、青色 success accent、綠色代表正數／PNL。

---

## 2. 技術棧

| 層 | 技術 |
|---|---|
| Frontend | React 19 + TypeScript + Vite 6 + vite-plugin-pwa（`registerType: autoUpdate`） |
| Backend | Node.js raw `node:http`（**冇用 Express**），ESM（`"type": "module"`） |
| Database | PostgreSQL（`pg` 8.22），runtime source of truth |
| 測試 | Vitest（`src/**/*.test.ts(x)`）、`node --test`（server/scripts）、Playwright（UI） |
| Icons | lucide-react |
| 部署 | Docker Compose + Caddy + Cloudflare Tunnel（**零 published host ports**） |

---

## 3. 常用指令

```powershell
# 開發
npm run dev                 # Vite frontend，127.0.0.1:5173，/api proxy 去 8787
npm run server              # Node API server，127.0.0.1:8787

# 驗證（改完嘢一定要跑相關嗰啲）
npx tsc --noEmit            # typecheck
npm test                    # vitest
npm run build               # tsc + vite build
npm run server:self-test    # server 自檢
node --test server/domain/personal-bet-sample.test.mjs   # 注單邏輯
npm.cmd run test:ui:only    # Playwright（需先 build）

# 資料收集
npm run import:hkjc                     # HKJC 賠率/賽果匯入
npm run import:history -- --download E0 2425   # 下載歷史賽果 CSV（dc-v1 訓練數據）
npm run import:history -- --dir data/historical # 匯入 team_match_history（PostgreSQL-only）
node scripts/hdc-collector.mjs          # The Odds API（quota-aware）
node scripts/unified-sampler.mjs        # 記錄 unified-buyable-v1 觀察樣本
npm run monitor:odds:once               # 賠率監察（monitor.config.json）

# 資料庫
npm run db:migrate                      # 跑 migrations
npm run db:import:legacy -- --source-root .
npm run db:check:parity -- --source-root .
npm run check:data                      # read-only 完整性檢查
```

### 環境變數

| 變數 | 用途 |
|---|---|
| `DATABASE_URL` | PostgreSQL 連線字串（本地開發**只准**用 disposable DB，例如 `127.0.0.1:55432/odds_test`） |
| `ODDS_API_KEY` | The Odds API key，放 `.env.local`（**絕唔可以印出嚟或 commit**） |
| `PUBLIC_ORIGIN` | HTTPS origin 字串（本地都要 HTTPS） |
| `STORAGE_BACKEND=postgres` | collector 用 PostgreSQL 持久化；`NODE_ENV=production` 拒絕 file mode |
| `RUN_MIGRATIONS=false` | 停用 server 啟動自動 migration（Phase 2 容器用 one-shot job） |
| `TRUSTED_PROXY_CIDRS` | 邊啲 peer 可以俾 `X-Forwarded-For`（預設空＝唔信任何人） |

> ⚠️ 登入移除後，`SESSION_SECRET`／`OWNER_USERNAME` 相關流程可能已簡化；以 `server/entry.mjs` 同 `server/config.mjs` 為準。

---

## 4. 架構與資料流

### Production topology

```text
Browser → Cloudflare Edge → cloudflared (outbound tunnel) → caddy → api (Node) → postgres
collector（同 api 同一 image）──────────────────────────────┘
```

- Stack 喺 VM `/opt/odds-tool/`；`build/` 係 deploy context，**唔係 git checkout**。
- Services：`postgres`、`api`、`caddy`、`cloudflared`、`collector`。
- Secrets 只留喺 VM secrets 目錄，唔入 repo／log／chat／前端。

### 推介引擎資料流（唯一路徑）

```text
collector / PostgreSQL → server recommendation API
  → GET /api/v1/recommendations/current → App → TodayPage → PickCard
```

- 唯一「值博」引擎：`shared/unified-recommendations.mjs` 嘅 `evaluateUnifiedOdds`。
- Client 只係 presentation adapter，**唔准**加返 client-side selector 或另一套 edge 計算。

### 結果來源優先級（固定，唔准改）

`FOTMOB 40 > API-Football 30 > HKJC historic 20 > HKJC live 10 > legacy 0`

---

## 5. API 路由（現行，`server/app.mjs`）

| Route | 說明 |
|---|---|
| `GET /api/v1/odds/live` | 即時賠率（flat per-selection rows） |
| `GET /api/v1/results` | 賽果目錄 |
| `GET /api/v1/backtest` | 模型 readiness／已結算／pending snapshots |
| `GET /api/v1/recommendations/current` | 現行 unified 推介（still-fresh） |
| `GET /api/v1/predictions/observations?sampleId=<正整數>` | 單一機會樣本嘅完整審計時間線 |
| `POST /api/v1/predictions` | 寫入預測（body limit 1 MB） |
| `GET /api/v1/bets` | 列出 owner 注單（讀取時 lazy settle + 補 promote 舊注） |
| `POST /api/v1/bets` | 新增注單 |
| `PATCH /api/v1/bets/:id` | 更新注單（v1.2.6 後新增） |
| `DELETE /api/v1/bets/:id` | 刪除注單（v1.2.6 後新增） |
| `GET /internal/health/ready` | 內部 readiness；**Caddy 必須對外回 404** |

> 舊 auth 路由（`/api/v1/auth/*`、`/api/v1/session`）已移除；未知路由回 404、方法錯誤回 405。

### 前端路由（hash-based，`src/route.ts`）

| Hash | 頁面 | 檔案 |
|---|---|---|
| `#/today`（預設） | 今日推介 | `src/pages/TodayPage.tsx` |
| `#/fixtures` | 賽程（kickoff 排序） | `src/pages/FixturesPage.tsx` |
| `#/bets` | 個人注單 | `src/pages/BetsPage.tsx` |
| `#/performance` | 模型表現 | `src/pages/PerformancePage.tsx` |

---

## 6. 資料庫

- Migrations：`db/migrations/001_initial.sql` → `005_bet_slips.sql`（共 5 個）。
- 主要表：`results`、`prediction_snapshots`、`bet_slips`、`collector_state`、odds / opportunity 相關表。
- Repositories 喺 `server/db/`：`bet-`、`result-`、`odds-`、`snapshot-`、`opportunity-`、`fixture-`、`collector-state-repository.mjs`。

### 兩條唔可以混淆嘅產品線

| | 個人注單 | 模型推介／回測 |
|---|---|---|
| 資料 | `bet_slips` + snapshots（`source=personal-bet`、`strategy_version=personal-bet-v1`） | snapshots（`unified-buyable-v1`） |
| 畫面 | `#/bets` | `#/today`、`#/performance` |
| 結算 | 讀取 `GET /api/v1/bets` 時 lazy settle 對 `results` | backtest 按 snapshot-policy 結算 |
| 對模型 | 存成 sample，但**唔會**自動改權重／重訓／併入 readiness 四卡 | 現行模型表現口徑 |

### Identity 規則

- `unified-buyable-v1` identity = `fixtureId|market|selection|line|modelVersion|strategyVersion`；相同 fingerprint 延長觀察，輸入變咗開新 observation。
- Market vocabulary（`src/market.ts`）：`totals`、`corners`、`handicap`、`h2h`。
- snapshot-policy 用 **45 分鐘** freshness 門檻分 valid-current／legacy／invalid（`shared/snapshot-policy.mjs`）。

---

## 7. 紅線（唔可以違反）

1. **模型實驗已解禁（2026-08-16，ADR 0003）**：可以開發新預測引擎，但**舊四個模型**（`consensus-v1`、`hdc-loo-v2`、`totals-loo-v1`、`corner-loo-v1`）**保持原碼不動**；新數學只准用新 `modelVersion` 經 `evaluateUnifiedOdds` 出推薦。30 場 settled distinct matches 由「改模型門檻」變咗做「信任門檻」——未夠數嘅模型唔可以話準。3% edge threshold 仍係預設閘門，改佢要 owner 逐次批准，唔可以為出多啲 pick 而降門檻。
2. **Unified-only**：推介由 `evaluateUnifiedOdds` 決定；唔好從 git history 復活 `buyCandidates`、`buyOpportunities`、`picks`、`stakeDisplay`（ADR 0001）。
3. **冇 client-side LOO／snapshot runtime**（ADR 0002）；LOO 只係 model label。
4. **安全邊界**：唔公開 `/internal/*`、唔開 host port、唔印／commit secret、唔碰其他 VM stacks（`astra`、`store-network-dashboard`、`odds-tool-test`）。
5. **VM access**：未獲 owner 明示，唔刪 `hugo` login、唔關 SSH password auth。
6. **Archive immutable**：改 `data/*.jsonl`、`data/*.json`、`public/hkjc-odds.json` 前必須 SHA-256 前後比對。
7. **測試紀律**：新行為先寫會 fail 嘅 test；collector 用 `--self-test` 或 fixture DB tests，唔好用 live provider 做測試。
8. **瀏覽器啟動唔可以自動使 The Odds API 付費 quota**（quota < 50 拒絕使費係預期行為）。
9. Titan007 只係人工 cross-check，唔係 source of truth。
10. 角球讓球**有意未整合**；角球而家只有大細（totals）玩法。

---

## 8. 檔案地圖

| 要搵咩 | 去邊度 |
|---|---|
| App 組裝／路由 wiring | `src/App.tsx`、`src/route.ts`、`src/apiClient.ts` |
| 四個主頁 | `src/pages/{Today,Fixtures,Bets,Performance}Page.tsx` |
| 注單 UI | `src/components/BetForm.tsx`、`PickCard.tsx`、`AppShell.tsx` |
| 賽事搜尋／中文隊名 alias | `src/fixtureSearch.ts`、`src/teamAliases.ts` |
| Market vocabulary | `src/market.ts`、`src/readinessModels.ts` |
| Flat odds adapter | `src/liveOddsMapping.ts`（`normalizeLiveOddsPayload`） |
| API route table | `server/app.mjs` |
| Server 啟動／migration policy | `server/entry.mjs`、`server/db/migrate.mjs` |
| 注單持久化／結算 | `server/db/bet-repository.mjs`、`server/domain/personal-bet-sample.mjs` |
| 賽果／回測 | `server/db/result-repository.mjs`、`server/domain/backtest.mjs` |
| 推介引擎 | `shared/unified-recommendations.mjs` |
| 歷史賽果匯入（`dc-v1` 訓練數據，ADR 0003） | `scripts/import-historical-scores.mjs`、`scripts/lib/football-data-csv.mjs`、`db/migrations/006_team_match_history.sql` |
| 部署 | `deploy/`、`docs/runbooks/production-deployment.md` |
| 領域詞彙（粵語） | `CONTEXT.md`（**必讀**，定義咗「推薦」「玩法」「讓球」「盤口」等用語） |
| 完整接手手冊 | `docs/MASTER-HANDBOOK-v1.2.6.md` |

> Root `server.mjs` 係 legacy reference，唔好由佢開始改。`BuyDashboard.tsx` 唔係主路徑，改／刪前要 owner 授權。

---

## 9. Git / Issue 工作流

- Issues 用 GitHub Issues + `gh` CLI 管理（見 `docs/agents/issue-tracker.md`）。
- Triage labels：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。
- 接手時**保留**既有 dirty / untracked 檔案，除非 owner 明確話點處理。
- **絕唔可以 commit**：`.ssh-key`、`deploy-now.ps1`、`.env.local`、任何含 secret 嘅檔案。
- Windows 打 deploy archive 要防 CRLF：
  `git -c core.autocrlf=false -c core.eol=lf archive --format=tar.gz -o odds-deploy.tar.gz HEAD`

---

## 10. 已知限制（2026-08 現況）

- 讓球盤未強制有 line；冇 line 時只用比分主客 fallback 結算（唔係精準亞洲盤）。
- 個人真錢注會入 snapshot sample，但**刻意唔**併入 readiness 四卡、唔自動 retrain。
- 「我有買」儲存後未變「已記」（UX polish 未做）。
- `deploy-now.ps1` 未去 secret 化，唔可以 commit。
- PWA / Service Worker 會令舊 client 卡住，白屏要喺受影響 browser 實測（`registration.update()` / unregister SW / 清 Cache Storage）。
- `oddsApi`、`handicap`、`asianTotals` 模組暫保留（collector 仍經 Vite 載入 parser），唔好順手重構。

---

## 11. 詞彙速查（同 owner 溝通必用，詳見 `CONTEXT.md`）

| 用語 | 意思 | 唔好講 |
|---|---|---|
| 推薦 | AI 計出嚟買得過嘅選擇 | opportunity / value bet |
| AI | 入面嘅預測引擎 | model / prediction engine |
| 玩法 | 主客和、讓球、角球等分類 | market type |
| 讓球 | 有盤口數字嘅玩法（-0.5、+1） | handicap / Asian handicap |
| 盤口 | 讓球嘅數字 | line |
| 賠率 | 倍率數字（1.85、2.10） | odds / price |
| 賽程 | 對賽隊伍＋聯賽＋開波時間 | fixture / match |
| 後補 | 自己 mark 咗買咗咩嘅記錄功能 | bet log |
| HDC | The Odds API | — |
| HKJC | 香港賽馬會足球賠率 | Jockey Club |
| snapshot | 賽前 capture 嘅預測記錄（backtest 用） | capture / record |

---

## 12. 深入閱讀索引

| 需要 | 文件 |
|---|---|
| v1.2.6 完整接手手冊 | `docs/MASTER-HANDBOOK-v1.2.6.md` |
| Unified-only 決策 | `docs/adr/0001-sole-recommendation-engine-is-unified.md` |
| LOO 移除決策 | `docs/adr/0002-delete-off-path-loo-and-orphan-client-modules.md` |
| 部署／rollback／secret rotation | `docs/runbooks/production-deployment.md` |
| 本地 PostgreSQL 開發 | `docs/runbooks/local-postgres-development.md` |
| Legacy 匯入／parity | `docs/runbooks/legacy-migration.md` |
| 領域詞彙 | `CONTEXT.md`、`docs/agents/domain.md` |

---

*本文件由 Kimi 於 2026-08-16 根據 repo 實際狀態（master HEAD `5e7975a`）生成。重大改動後請一併更新本文件。*
