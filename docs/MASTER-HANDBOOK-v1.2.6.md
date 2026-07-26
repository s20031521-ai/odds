# MASTER HANDBOOK — odds-tool v1.2.6

> **俾下一位接手開發者／AI：呢份係現行系統嘅唯一入口。** 先讀本文件；只喺需要歷史背景、已判定決策或完整操作步驟時先跟文末索引深入。
>
> **版本：** v1.2.6
>
> **程式基線：** `368dab1`（個人注單提升為 sample + lazy 結算）
>
> **文件日期：** 2026-07-27
> **Production：** <https://odds.ballballchu.com.hk>

---

## 1. 文件地位與閱讀規則

本文件取代 `MASTER-HANDOFF-v1.2.1.md` 成為接手入口；舊 master、dated handoff、spec 和 plan 都保留作歷史證據，**唔係現行操作指示**。唯一例外係本版本之後產生嘅 dated handoff：它可暫時記錄新現況，直至 handbook 升版回填。

如內容有衝突，按以下次序判斷：

1. production 行為、現行程式碼和已接受 ADR；
2. 本版本之後產生嘅 dated handoff；
3. 本 handbook；
4. 較舊 master handoff、dated handoff、spec、plan。

重大改動完成後，要一併更新本 handbook、寫 dated handoff，並將 package version、tag 和本文程式基線保持一致。

---

## 2. 五分鐘上手

### 系統係乜

`odds-tool` 係單一 owner 使用嘅足球賠率價值分析 PWA。前端係 React 19 + TypeScript + Vite；API 用 raw `node:http`；runtime source of truth 係 PostgreSQL。Production 經 Cloudflare Tunnel 對外，冇公開 host port。

現行導航：**今日｜賽程｜注單｜表現**。

- `#/today`：server-authoritative 推介及即將開賽資料。
- `#/fixtures`：按開賽時間排序嘅賽程；可手動記錄「我有買」。
- `#/bets`：個人真錢注單、摘要及結算狀態。
- `#/performance`：模型 snapshot 嘅 readiness／已結算／未結算，不係個人注單報表。

### 先做嘅 read-only 檢查

```powershell
git status --short
git log -8 --oneline
npx tsc --noEmit
npm run test
node --test server/domain/personal-bet-sample.test.mjs
```

接手時保留既有 dirty / untracked 檔案，除非 owner 明確指定處理範圍。尤其唔好 commit `.ssh-key`、`deploy-now.ps1` 或任何含 secret 嘅本地檔案。

### Production 快速 smoke

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://odds.ballballchu.com.hk/                    # 200
curl -s -o /dev/null -w "%{http_code}\n" https://odds.ballballchu.com.hk/api/v1/bets        # 401（未登入正常）
curl -s -o /dev/null -w "%{http_code}\n" https://odds.ballballchu.com.hk/internal/health/ready # 404
```

HTTP 200 唔代表新版本已上線：部署後亦要確認新 bundle／畫面版本，並在真實 browser 驗證，避免 stale Service Worker 掩蓋問題。

---

## 3. 產品邊界：兩條不可混淆嘅線

| | 個人注單 | 模型推介／回測 |
|---|---|---|
| 主資料 | `bet_slips` + `prediction_snapshots`（`source=personal-bet`） | `prediction_snapshots`（`unified-buyable-v1`） |
| 用途 | 真錢帳、日後可分析嘅實際投注紀錄 | server 推介、模型 readiness、回測 |
| 畫面 | `#/bets` | `#/performance`、今日推介 |
| 結算 | `GET /api/v1/bets` lazy 以 `results` 對 pending 注單結算 | backtest 對符合 policy 嘅 snapshot 結算 |
| 對模型影響 | 會存成 sample，**但唔會**自動改權重、重訓，或併入 readiness 四卡 | 係現行模型表現口徑 |

### 個人注單（v1.2.2–v1.2.6）

三個入口都用共用 `BetForm`：今日卡 `PickCard`、賽程 row、`#/bets` 手動新增。每次建立注單：

1. 寫入 `bet_slips`，隔離至登入 owner；
2. 建立 `prediction_snapshots` sample（`source=personal-bet`、`strategy_version=personal-bet-v1`）；
3. 將 snapshot `sample_id` 回寫至注單；
4. 之後讀取 bets 時，補 promote 舊注，並把有 `match_id` 嘅 pending 注單對 `results` lazy settle。

`BetForm` 可搜未完場及已完場賽事；已完場空搜尋只顯示最近三日而且有模型結算嘅項目，文字搜尋會查完整 results 目錄，並支援中英隊名 alias。讓球冇 line 時暫以比分主客（moneyline-style）fallback 結算；呢個係已知限制，唔好誤當精準亞洲盤結算。

### 模型推介

現行「值得買」唯一引擎係 `shared/unified-recommendations.mjs` 嘅 `evaluateUnifiedOdds`：

```text
collector / PostgreSQL → server recommendation API
  → GET /api/v1/recommendations/current → App → TodayPage → PickCard
```

Client 只係 presentation adapter。唔好重新引入 client-side selector、client localStorage snapshot settle，或另一套 edge／stake 計算。

---

## 4. 核心架構與資料流

### Production topology

```text
Browser
  → Cloudflare Edge
  → cloudflared（outbound tunnel）
  → caddy
  → api（Node）
  → postgres

collector（同 api image） ────────────────┘
```

- 只有 Cloudflare Tunnel 對外；**零 published host ports**。
- stack 位於 VM `/opt/odds-tool/`；`build/` 係 deploy context，唔係 git checkout，唔可以依賴 `git pull`。
- service：`postgres`、`api`、`caddy`、`cloudflared`、`collector`。
- API／collector 經 secrets 讀 credential，再降權為 uid 1000；secrets 只可留喺 VM secrets 目錄，唔可入 repo、CLI args、log、chat 或前端。

### Runtime data ownership

| 資料 | 權威來源 | 主要位置 |
|---|---|---|
| 推介 | unified evaluator + PostgreSQL | `shared/unified-recommendations.mjs`、server recommendation route |
| live odds | PostgreSQL collector output | `GET /api/v1/odds/live` |
| 賽果 | PostgreSQL；高 priority source 才可覆蓋 | `results`、`server/db/result-repository.mjs` |
| 模型 snapshot | PostgreSQL | `prediction_snapshots` |
| 個人下注 | PostgreSQL owner-scoped 資料 | `bet_slips`、`server/db/bet-repository.mjs` |

結果 priority 固定：FOTMOB 40 > API-Football 30 > HKJC historic 20 > HKJC live 10 > legacy 0。唔好降低或重排。

### API 路由（現行）

| Route | 身份／用途 |
|---|---|
| `POST /api/v1/auth/login` | public；login throttling |
| `GET /api/v1/session` | public；登入狀態和 CSRF token |
| `POST /api/v1/auth/logout` | session + CSRF + exact Origin |
| `GET /api/v1/odds/live` | session；live odds |
| `GET /api/v1/results` | session；results catalog |
| `GET /api/v1/backtest` | session；readiness、已結算與 pending 模型 snapshots |
| `GET /api/v1/recommendations/current` | session；現行 unified 推介 |
| `GET` / `POST /api/v1/bets` | session；owner-scoped list／create，POST 需要 CSRF |
| `/internal/health/ready` | api network 內可用；Caddy 必須回 404 |

`bet_slips` 目前只支援 list/create；PATCH、DELETE、手動沒有 fixture link 嘅中錯標記，均未實作。

### Identity、market 與前端資料格式

- `src/market.ts` 係 controlled market vocabulary：`totals`、`corners`、`handicap`、`h2h`。`MARKET_LABELS` 和 `canonicalMarket()` 要同 server identity mapping 對齊。
- API 邊界部分可保留 `string` 市場值，避免 server 擴充 market 時炸 client；controlled state／已知 model 才用 `MarketKey`。
- `/api/v1/odds/live` 係 flat per-selection rows。前端 consumer 要經 `src/liveOddsMapping.ts` `normalizeLiveOddsPayload`，唔可假設 nested odds。
- 即將開賽／賽程係 kickoff order；唔可以用舊 edge-sort 或舊 client LOO pipeline 排序。

---

## 5. 不可違反紅線與已接受決策

1. **模型凍結。** 唔改模型 weights、Kelly、ROI 定義、3% edge threshold，亦唔可為咗出更多 picks 而降低門檻。readiness target 係每個 `market + modelVersion + matchId` 30 個 settled distinct matches。
2. **Unified-only。** 推介由 `evaluateUnifiedOdds` 決定。ADR 0001 已刪除 shadow client engine；唔好從 git history 復活 `buyCandidates`、`buyOpportunities`、`picks` 或 `stakeDisplay`。
3. **冇 client-side LOO／snapshot runtime。** ADR 0002 已刪 client LOO analyzers、`marketDisplay` 和 localStorage client settle。LOO 名稱可以係 model label，唔代表有 live client LOO math。
4. **安全邊界。** 唔公開 `/internal/*`，唔公開 host port，唔印／commit secret，唔碰其他 VM stacks（`astra`、`store-network-dashboard`、`odds-tool-test`）。
5. **VM access。** 未獲 owner 明示，唔刪 `hugo` login、唔關 SSH password auth、唔 rotate 其密碼。
6. **Archive immutable。** 改 `data/*.jsonl`、`data/*.json` 或 `public/hkjc-odds.json` 前必須做 SHA-256 前後比較。呢啲係 audit baseline，唔係 runtime 編輯目標。
7. **測試紀律。** 新行為先加會失敗嘅 test；collector 驗證用 `--self-test` 或 fixture-driven DB tests，唔好以 live provider 當測試。

ADR 有衝突時，先明確標示衝突，再請 owner 重新決策；唔可以靜默繞過。

---

## 6. 檔案地圖

| 區域 | 先睇邊度 |
|---|---|
| App orchestration、auth state、route wiring | `src/App.tsx`、`src/route.ts`、`src/apiClient.ts` |
| 今日／賽程／注單／表現 UI | `src/pages/TodayPage.tsx`、`FixturesPage.tsx`、`BetsPage.tsx`、`PerformancePage.tsx` |
| 注單 UI | `src/components/BetForm.tsx`、`PickCard.tsx`、`AppShell.tsx` |
| 賽事搜尋與中文 alias | `src/fixtureSearch.ts`、`src/teamAliases.ts` |
| market vocabulary | `src/market.ts`、`src/readinessModels.ts` |
| flat odds consumer adapter | `src/liveOddsMapping.ts` |
| API route table | `server/app.mjs` |
| server startup／migration policy | `server/entry.mjs`、`server/db/migrate.mjs` |
| 注單 persistence／結算 | `server/db/bet-repository.mjs`、`server/domain/personal-bet-sample.mjs` |
| result lookup／settlement | `server/db/result-repository.mjs`、`server/domain/backtest.mjs` |
| unified recommendation engine | `shared/unified-recommendations.mjs` |
| database migrations | `db/migrations/001_initial.sql` 至 `005_bet_slips.sql` |
| deployment boundary | `deploy/`、`docs/runbooks/production-deployment.md` |

Root `server.mjs` 係 legacy reference；新 server work 一律由 `server/entry.mjs` 和 `server/` 開始。`BuyDashboard.tsx` 現時未係主路徑；如要改／刪，先向 owner 取得明確授權。

---

## 7. 本地開發、資料庫與驗證

### 基本驗證

```powershell
npx tsc --noEmit
npm run test
npm run build
npm run server:self-test
node scripts/hdc-collector.mjs --self-test
npm.cmd run test:ui:only
```

按改動範圍選相應組合；唔好宣稱完成而未跑至少相關 typecheck／test。涉及 v1.2.6 個人注單 promotion／settlement 時，另跑：

```powershell
node --test server/domain/personal-bet-sample.test.mjs
```

### Disposable PostgreSQL only

DB-backed 開發或測試只可指向 disposable DB，例如 `127.0.0.1:55432/odds_test`。設定 `DATABASE_URL` 前先確認目標；test helpers 會拒絕非指定 disposable URL。

```powershell
$env:DATABASE_URL = 'postgresql://odds_test:odds_test@127.0.0.1:55432/odds_test'
npm run db:migrate
npm run db:import:legacy -- --source-root .
npm run db:check:parity -- --source-root .
node scripts/check-data-integrity.mjs --database
```

現行 schema migrations 包含 `001` 至 `005`；較舊 runbook 寫嘅 `003` 只係當時基線，唔可當作 current schema 上限。

`PUBLIC_ORIGIN` 本地亦必須 HTTPS；本地前端冇 dev proxy，UI-only 改動用 Playwright mocks。唔好把 provider key 或 runtime secret 寫入檔案、測試輸出或文檔。

---

## 8. Production 部署與 migration

完整指令、secret rotation 和 restore 細節見 `docs/runbooks/production-deployment.md`；以下係現行順序和不可跳過嘅關卡。

1. **本機先驗證。** typecheck、相關 tests 和 build 綠；確認 worktree 只包含要 deploy 嘅改動。
2. **push 後打 deploy archive。** VM `build/` 唔係 git repo。Windows 打 archive 時仍要防 CRLF：

   ```bash
   git -c core.autocrlf=false -c core.eol=lf archive --format=tar.gz -o odds-deploy.tar.gz HEAD
   ```

   上傳至 VM `/tmp/`；不提交 SSH key 或 deploy helper。
3. **先備份及打 rollback tag。** 在 VM `/opt/odds-tool` 先做 `pg_dump`，並把目前 `odds-tool-api:latest`、`odds-tool-caddy:latest` tag 為 `:rollback`。
4. **解包和 validate。** 解包至 `/opt/odds-tool/build`，先跑 `docker compose config --quiet`。新 migration 要以 migration role 的 one-shot migration job 跑 ledger，唔好依賴 api container 偷跑 migration。
5. **依變更 rebuild。**
   - 純前端：build／更新 `caddy`。
   - server、collector、shared runtime 或 migration：build／更新 `api`（collector 同 image），通常亦連 `caddy`。
6. **先 smoke，再開 collector／tunnel。** 最少驗證 containers 狀態、internal api readiness 200 + Caddy internal 404、public `/` 200、受保護 API 401、HSTS 和 tunnel connections；有 migration／data 改動時再驗證相應 query。
7. **清理 askpass helper 和 archive。** secret helper 只可短暫存在，完成即刪。

### Rollback 原則

- 有 exposure／安全事故：先 `docker compose stop cloudflared` 切流量，保留 stack 供 diagnosis。
- App image 回滾：以 deploy 前 `:rollback` tag force-recreate api／collector 或 caddy，然後重跑 smoke。
- **唔可以盲目 reverse migration。** 若舊 app 同新 schema 不相容，先切流量，再由 verified pre-deploy `pg_dump` restore。

---

## 9. 常見事故分流

| 症狀 | 第一輪檢查／處理 |
|---|---|
| 網站 502 或 Cloudflare 1033 | cloudflared log、public hostname 是否指向 `http://caddy:80`、caddy 是否 healthy |
| 所有人 login 401 | api health、`session_secret` 有冇被 rotate；注意 login throttle 會轉 429 |
| deploy 後 UI 冇變 | 確認 archive／bundle 真係新、Caddy image 已 rebuild；再查 Cloudflare cache 和 client Service Worker |
| 特定 browser 白屏 | 在該真實 browser 重現；先看 ErrorBoundary／console，再 `registration.update()`；必要時 unregister Service Worker 並清 Cache Storage |
| collector 無 log／冇新資料 | 查 `collector_state.updated_at` 和 quota；quota 低於 50 時拒絕花費係預期行為 |
| DB down | 在 `/opt/odds-tool` 啟 postgres；pgdata volume 會保留，**絕不** `docker compose down -v` |
| 注單未結算 | 確認有 `match_id`、`results` 有賽果；`GET /api/v1/bets` 會 lazy settle。冇 line 嘅 handicap 只係目前 fallback 行為 |

白屏事故嘅核心教訓：乾淨 browser 通過唔代表 owner browser 正常。PWA／Service Worker 問題要以實際受影響 browser 驗證。

---

## 10. 已知限制與下一步

- 注單未有 PATCH／DELETE。
- 讓球仍未強制有 line；無 line 只做比分主客 fallback。
- 個人真錢注會入 snapshot，但刻意**唔會**併入 readiness 四卡，亦未自動 retrain LOO。
- 可加 `src/teamAliases.ts` 擴充中文 alias；先確認 mapping 正確。
- 儲存後「我有買」未變成「已記」，屬 UX polish。
- `deploy-now.ps1` 應去 secret 化／改由安全 secret workflow 取代；目前不可 commit。
- Client 卡住舊 SW 時仍需人手 hard reload／unregister 指引。
- `oddsApi`、`handicap`、`asianTotals` 暫保留，因 collector 仍由 Vite 載入 parser；un-Vite live-odds adapter 係日後架構工作，唔好順手重構。

如要把真錢注顯示喺模型 performance 或用作訓練，必須先重新做產品／資料完整性決策；唔可直接混入 `unified-buyable-v1` readiness。

---

## 11. 深入閱讀索引

| 需要 | 文件 |
|---|---|
| v1.2.6 完整交接、production 驗證 | `docs/HANDOFF-2026-07-26-session-full.md` |
| 注單產品決策 | `docs/HANDOFF-2026-07-26-bet-performance-decision.md` |
| v1.2.6 前系統／白屏／PWA 背景 | `docs/MASTER-HANDOFF-v1.2.1.md` |
| unified-only 決策 | `docs/adr/0001-sole-recommendation-engine-is-unified.md` |
| LOO／orphan client 移除決策 | `docs/adr/0002-delete-off-path-loo-and-orphan-client-modules.md` |
| deployment、rollback、secret rotation | `docs/runbooks/production-deployment.md` |
| disposable PostgreSQL 開發 | `docs/runbooks/local-postgres-development.md` |
| legacy archive import／parity | `docs/runbooks/legacy-migration.md` |

**接手前最後提醒：** production 現行版本係 v1.2.6；推薦係 unified-only；個人注單係 owner-scoped、會存 sample 同 lazy settle，但唔等同模型 performance 或自動訓練。任何牽涉模型、production、migration 或 identity vocab 嘅改動，先讀相關 ADR／runbook，再改程式。
