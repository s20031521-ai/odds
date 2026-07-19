# Odds Tool handoff（截至 2026-07-18／Task 8 Slice A）

## 0. 一句狀態

前端已經轉成 responsive PWA，並改用受 auth 保護嘅同源 `/api/v1`；新 Node server、PostgreSQL schema／repositories、legacy importer、單一 owner auth 都已完成。現時仲未完成嘅關鍵位係 collector 全面改寫入 PostgreSQL：`postgres-sink` 已寫好，但真 DB GREEN test 因本機 PostgreSQL SSH tunnel 未開而未能完成；VM、Cloudflare Tunnel、DNS、backup 同正式部署亦未開始。

專案目前所在位置：

```text
C:\Users\itadmin\Documents\賭
```

本目錄冇可用 Git metadata；以實際檔案、`.superpowers/sdd-production-phase1/progress.md`、各 Task report 同本文件為準。

---

## 1. 而家嘅系統狀態

### 1.1 現行模型版本

| 市場 | 現行 modelVersion | 產生位置 | 目前合資格 settled distinct matches | 距離 30 場 |
|---|---|---|---:|---:|
| 主客和（1X2） | `consensus-v1` | `src/App.tsx` | 0 | 30 |
| 大細波 | `totals-loo-v1` | `src/App.tsx`、`scripts/hdc-collector.mjs` | 0 | 30 |
| 角球大細 | `corner-loo-v1` | `src/App.tsx` | 0 | 30 |
| 亞洲讓球 | `hdc-loo-v2` | `src/App.tsx`、`scripts/hdc-collector.mjs` | 0 | 30 |

`legacy-v0` 只係 archive／audit 分類，唔係現行模型，亦唔可以進入 readiness、hit rate、ROI、calibration 或值得買計算。

30 場門檻係按 `market + modelVersion + matchId` 嘅 settled distinct match 計，唔係 snapshot 行數、盤口數、bookmaker 數或 Dashboard cards。模型參數、Kelly 同固定 3% edge threshold 仍然凍結；每一個市場／模型都要獨立達到 30 場先可以考慮調校。

### 1.2 點解舊文件寫角球 7 場，而家係 0 場

2026-07-12 嘅歷史記錄曾經顯示 `corner-loo-v1` 有 7 場／69 snapshots settled。不過 7 月 16 日加入嚴格 snapshot trust policy 後，current snapshot 必須有有效 `commenceTime`、賽前 `savedAt`、odds、chance 同合法 line。嗰批角球 rows 缺 `commenceTime`，所以保留作 audit，但分類為 invalid，唔再計入現行統計。

截至本 handoff，用現行 `buildBacktest()` 直接重算本機 archives：

```text
prediction snapshots: 183
results: 853
valid-current snapshots: 3
legacy snapshots: 93
invalid snapshots: 87
missing commenceTime: 180
current settled distinct matches: 0
```

3 個 valid-current rows 全部係 `totals-loo-v1`，分屬 3 場賽事；現時全部係 overdue／未有可配對 settlement，所以 settled 仍然係 0。87 個 invalid rows 全部因缺 `commenceTime`；舊資料冇被修改或刪除。

相關規則入口：

- `shared/snapshot-policy.mjs`：valid-current／legacy／invalid 分類。
- `server/domain/backtest.mjs`：settlement、distinct-match 去重、readiness、ROI。
- `src/App.tsx`：四個 modelVersion 及 UI 30 場提示。
- `docs/superpowers/specs/2026-07-16-model-data-trust-design.md`：信任規則設計。

### 1.3 資料 source of truth

現階段係過渡狀態：

- 新 API runtime 已經以 PostgreSQL repositories 為唯一讀寫介面。
- 本機 JSON／JSONL archives 仍然係 migration audit baseline，必須保持 immutable。
- legacy importer 已證明可以將 183 snapshots／853 results idempotent 匯入 PostgreSQL，重跑不重複，並完成 file/DB parity。
- collectors/importers 仲未全部接駁 PostgreSQL sink，所以 production collector source of truth 遷移未完成。

---

## 2. 7 月 16 日之後嘅改動

完整進度以 `.superpowers/sdd-production-phase1/progress.md` 為準。以下係 Task 1–8 到目前為止嘅架構結果。

### 2.1 Domain 同資料信任邊界

- 將 backtest、settlement、quarter-line、push、distinct-match、ROI、snapshot merge 等邏輯抽到 `server/domain/`。
- snapshot identity 維持 `matchId|market|line|modelVersion`，第一個 snapshot immutable。
- valid-current、legacy、invalid 分隔已由 shared policy 統一；current API 只讀 `listCurrent()`。
- legacy／invalid rows 仍可 audit，但唔會污染現行 readiness 或 performance。

### 2.2 PostgreSQL 遷移

已完成：

- `db/migrations/001_initial.sql`：owners、sessions、login_attempts、prediction_snapshots、results、live_odds、collector_state、import_runs、import_rows。
- `002_import_row_audit.sql`：加強 legacy import row audit／分類記錄。
- `003_auth_constraints.sql`：單一 owner、approved password hash、session digest／時間、login throttle constraints。
- `server/db/` repositories：immutable snapshots、source-priority results、provider-scoped live odds replacement、collector state。
- `scripts/import-legacy-to-postgres.mjs`：原始 archive idempotent import，invalid rows 入 audit ledger。
- `scripts/check-postgres-parity.mjs`：比較 counts、分類、identity、distinct matches、readiness、settlement、hit rate、ROI 同代表 backtest rows。
- 先前用 disposable PostgreSQL test DB 驗證過 migrations、repositories、import twice、parity，archives hashes 保持不變。

未完成：

- `scripts/lib/postgres-sink.mjs` 已經建立，包住 advisory lock、live odds、snapshots、results 同 collector state repositories。
- sink 嘅真 PostgreSQL tests 已寫，但本機 `127.0.0.1:55432` tunnel 現時冇 listen，所以未有 GREEN 證據。
- `scripts/hdc-collector.mjs`、`scripts/hkjc-import.mjs`、`scripts/odds-monitor.mjs` 仲係 file persistence；未注入 sink。
- `scripts/check-data-integrity.mjs` 仲未有 `--database` mode。
- 因此目前唔可以話 collector PostgreSQL migration 已完成，更唔可以開 production automation。

### 2.3 Auth 系統

新 auth 係單一 owner、冇 signup：

- owner 用 `npm run auth:create-owner` 內部建立；密碼最少 14 字元，以 Argon2id hash。
- browser 收到 opaque session cookie；PostgreSQL 只存 session token SHA-256 digest。
- cookie 名係 `__Host-odds_session`，設有 `Secure`、`HttpOnly`、`SameSite=Strict`、`Path=/`，冇 `Domain`。
- session 閒置 14 日失效，最長 30 日；logout 會 server-side revoke。
- login 同時按 account 同 client IP throttle：15 分鐘內 5 次失敗會 cooldown 30 分鐘。
- mutation 要 exact same-origin `Origin` 加 session-bound CSRF token。
- CSRF 只存在前端 memory；password、session token、CSRF token 都唔寫 localStorage／sessionStorage。

主要檔案：`server/auth/`、`server/http/security.mjs`、`server/http/cookies.mjs`、`scripts/create-owner.mjs`、`src/apiClient.ts`、`src/pages/LoginPage.tsx`。

### 2.4 新 server 架構

正常入口已經由舊單檔 server 改為：

```text
package.json: npm run server
  -> server/entry.mjs
  -> load config
  -> PostgreSQL pool
  -> 自動 run migrations
  -> repositories + auth service
  -> server/app.mjs route table
  -> /api/v1
```

`server.mjs` 而家只保留 legacy self-test／舊碼兼容；正常 direct run 會 hand off 去 `server/entry.mjs`。唔應該再喺舊 `server.mjs` 加新 runtime routes。

API route：

- 公開：`POST /api/v1/auth/login`、`GET /api/v1/session`。
- 登入後：`POST /api/v1/auth/logout`、`GET /api/v1/odds/live`、`GET /api/v1/results`、`GET /api/v1/backtest`、`POST /api/v1/predictions`。
- 內部：`GET /internal/health/ready`，會 probe DB；正式部署時唔可以由 public Caddy route 暴露。
- 舊 `/api/backtest`、`/api/hdc-live`、`/api/predictions`、public import routes 同 `/health` 會 fail closed。
- auth JSON body limit 16 KiB，prediction batch limit 1 MiB；error response 唔回傳 SQL、路徑或 secret。

### 2.5 PWA／前端

- browser runtime 全部改成 relative same-origin `/api/v1`，唔再直接打 `127.0.0.1:8787`。
- app mount 先檢查 session；未登入只顯示 Login page，protected data request 唔會預先發出。
- Dashboard 首頁保留值得買賽事，全部賽事分開頁面；responsive PWA 已覆蓋 desktop、iPhone、iPad viewports。
- service worker 只 cache app shell；API、JSON、results、archives 同 live odds 不作 runtime cache。
- `public/hkjc-odds.json` 仲喺 repo 作 inert migration artifact，但 runtime frontend 已經唔讀。

---

## 3. 點樣啟動同驗證

### 3.1 舊嘅兩個 command 已經唔足夠做真 end-to-end

`npm run dev` 仍然可以啟動 Vite UI；`npm run server` 仍然係 backend command。不過而家 backend 必須有 PostgreSQL 同 auth config，frontend 又只會用同源 `/api/v1`。目前 `vite.config.ts` 未設 dev proxy，而 production Caddy／Compose 仲未建立，所以單純分兩個 terminal 跑以下命令，只會啟動兩個 process，唔會形成完整真資料登入流程：

```powershell
npm.cmd run server
npm.cmd run dev
```

換句話講：

- `npm run dev` 本身唔需要 DB，但未有同源 API 時只適合 UI 開發／mock。
- `npm run server` 一定要先有可連線 PostgreSQL，以及由 process environment 注入 `DATABASE_URL`、`SESSION_SECRET`、`PUBLIC_ORIGIN`；startup 會自動跑 migrations。
- 真正 browser end-to-end 仲需要一層同源 HTTPS reverse proxy；設計上係 production Caddy／Cloudflare Tunnel，現時未實作。

### 3.2 唔需要 DB 都可以跑嘅驗證

```powershell
npm.cmd run server:self-test
node scripts/odds-monitor.mjs --self-test
node scripts/hkjc-import.mjs --self-test
node scripts/hdc-collector.mjs --self-test
npm.cmd run check:data
npm.cmd run test
npm.cmd run build
npm.cmd run test:ui:only
npm.cmd audit
```

Playwright 使用受控 API mocks，亦會阻止 frontend 偷讀 `/hkjc-odds.json` 或 loopback legacy API；所以 UI tests pass 唔等於真 DB／reverse-proxy path 已經部署。

本 handoff 當日重新確認：

- `npm run server:self-test`：pass。
- `npm run check:data`：183 snapshots、853 results、0 late、0 duplicate snapshot/result keys、0 negative score；3 valid-current、93 legacy、87 invalid。
- 本機 PostgreSQL test port：未有 listener。

最近一次完整、已記錄而未改 archive 嘅 Task 7 baseline：149 Vitest tests、32 Playwright tests、production build、server app tests、server self-test、data integrity 同 dependency audit 全部 pass。

### 3.3 需要 DB 嘅驗證／操作

有 disposable PostgreSQL，而且 `DATABASE_URL` 已注入目前 process environment 後，先做：

```powershell
npm.cmd run db:migrate
npm.cmd run db:import:legacy
npm.cmd run db:check:parity
node --test scripts/lib/postgres-sink.test.mjs
```

唔好對 production DB 測試 legacy import 或 sink fixtures；只可用 disposable／test database。唔好為驗證而執行 live collector/import command，避免消耗付費 provider quota。

建立第一個 owner 要等 DB migration 完成，然後由安全 terminal 執行 `npm run auth:create-owner`；密碼由 hidden prompt 或指定嘅 password secret file 讀入，唔可以放 command line、chat、repo 或 log。

---

## 4. Known open issues

### 正在做

1. **Task 8 PostgreSQL collector sinks**
   - Slice A code／tests 已寫。
   - 等 disposable PostgreSQL tunnel 恢復後跑 GREEN tests，再做獨立 review。
   - 之後先 refactor 三個 scripts 接 injected sink，同埋加 integrity `--database` mode。

2. **Task 9 Phase 1 final gate**
   - 未開始。
   - 要做完整 DB/file parity、安全黑箱、service-worker cache scan、全套 tests、runbooks 同 whole-phase independent review。

3. **Local true end-to-end development path**
   - Vite 冇 `/api/v1` proxy，而 API config 要 HTTPS public origin。
   - 現時 UI 可用 mock 驗證、API 可獨立驗證，但兩個 command 未可提供完整真登入流程。

### 等緊數據

1. 四個現行模型都係 0 settled distinct matches；各自距離 30 場仲差 30。
2. `totals-loo-v1` 有 3 場 valid-current snapshots，但未有配對 settlement，現時係 overdue。
3. 舊角球 7 場只係歷史／invalid audit 記錄，唔可以當現行 sample。
4. 未夠 30 場前唔改 model weights、Kelly、ROI 定義或 3% threshold，亦唔為製造 picks 降門檻。

### 已知技術債／部署未完成

- `server.mjs` 仲保留大量 early-handoff legacy code；正常 runtime 唔行嗰段，但未清理。
- `public/hkjc-odds.json` 仲係 inert artifact。
- oversized request stream 超限後未明確 destroy；目前被評為 minor debt。
- collector scripts 仍可能寫 JSON／JSONL；production PostgreSQL mode 未完成，唔可以開 production collector。
- VM `/opt/odds-tool` Compose stack、Caddy、dedicated Cloudflare Tunnel、`odds.ballballchu.com.hk` DNS route、encrypted backup／restore rehearsal、private GitHub／CI 都未部署。
- 先前喺對話披露過嘅 SSH password 應視為已洩露；正式上線前要先驗證 SSH key login，再 rotate password。repo 內冇儲存該 credential。

---

## 5. API keys／DB 連線放喺邊（只列位置）

| 類別 | 目前位置／注入方式 | 備註 |
|---|---|---|
| The Odds API key | 專案根目錄 `.env.local` | 由 collector／monitor 讀；唔可以進 frontend bundle 或 commit。 |
| API-Football key | 專案根目錄 `.env.local` | 由 HKJC importer 讀；唔可以 print。 |
| PostgreSQL connection | runtime process environment 嘅 `DATABASE_URL` | 新 server 唔會自動由 `.env.local` 載入；production 值未寫入 repo。 |
| Session secret | runtime process environment 嘅 `SESSION_SECRET` | 只供 server/auth 使用。 |
| Public HTTPS origin | runtime process environment 嘅 `PUBLIC_ORIGIN` | 必須係完整 HTTPS origin。 |
| Owner username | owner bootstrap process environment 嘅 `OWNER_USERNAME` | 只喺一次性 owner CLI 使用。 |
| Owner password | hidden terminal prompt，或由 `OWNER_PASSWORD_FILE` 指向嘅 secret file | 唔接受 command-line password；真值唔應留喺 `.env.local`。 |
| Disposable test DB 定義 | `compose.test.yaml`，或本機 loopback SSH tunnel | 只供 tests；目前 tunnel 未開。 |
| 未來 VM production secrets | 尚未建立；設計要求放獨立 Compose／Docker mounted secrets，stack 目錄預定 `/opt/odds-tool` | 實作屬 Phase 2，唔好假設已存在。 |

唔好讀出、複製或記錄 `.env.local` 真值到 handoff、terminal transcript、Git、Docker image 或前端 `VITE_` 變數。

---

## 6. 下一手建議次序

1. 只恢復 disposable PostgreSQL test tunnel；確認係 test DB，唔接 production。
2. 跑 `scripts/lib/postgres-sink.test.mjs`，修正任何真 DB failure，再做 Task 8 Slice A review。
3. 完成 collector/importer/monitor sink injection 同 `check-data-integrity --database`。
4. 跑 Task 8 全部 self-tests／DB fixtures／previous gates，確保冇 provider network call、冇 archive write。
5. 完成 Task 9 full parity、安全黑箱、runbooks 同 final review。
6. Phase 1 完全綠燈後，先另開 Phase 2 做 VM Compose、Caddy、Cloudflare Tunnel、DNS 同 production owner bootstrap。

必讀：

- `.superpowers/sdd-production-phase1/progress.md`
- `.superpowers/sdd-production-phase1/task-8-brief.md`
- `.superpowers/sdd-production-phase1/task-8-report.md`
- `docs/superpowers/plans/2026-07-18-production-api-postgres-auth.md`
- `docs/superpowers/specs/2026-07-18-production-postgres-deployment-design.md`
- `docs/prediction-log.md`

