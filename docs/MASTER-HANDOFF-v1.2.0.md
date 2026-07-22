# MASTER HANDOFF — odds-tool v1.2.0

> **俾接手 AI / 開發者：呢份文件係唯一入口。讀完呢份 + 按 §1.4 順序掃過引用文件，你應該可以完全 pickup 成個系統，唔使再問任何人。**
> 版本：v1.2.0（git tag `v1.2.0`，package.json version `1.2.0`）
> 日期：2026-07-22
> 語言：本 repo 所有交接文件用廣東話書寫，程式碼註解用英文。
> v1.2.0 變更：整合 **Today-first UI Phase C**（`HANDOFF-2026-07-22-today-first-ui-phase-c.md`，branch 8 commits `b9e943c`…`ed0c8ed` ff merge master）— 賽程頁 h2h tab 執整（今日/聽日分組標題、一行式 fixture row、聯賽 chips + 隊名搜尋 toolbar、「有貨」mint 點、日內按開賽時間排序）、紀錄頁執整（四模型 readiness 進度條 X/30、「等緊開賽」pending 卡 +「已完場」分組、賽前快照 `<details>`）、server `/api/v1/backtest` response 加 `pending` 陣列（未結算 valid-current snapshot，冇新 endpoint）、owner-approved cleanup：刪 `SimpleDashboard.tsx` + `marketDisplay.ts` dead exports + 舊 analysis CSS（11 files +10/−559）。Merged 測試全綠：Vitest 233/233、tsc 0 errors、server node:test 9/9、Playwright 84/84 ×2。**已部署 production（2026-07-22 凌晨）** — rebuild 咗 api + caddy 兩個 image，bundle `index-jmHUUAaH.js`，備份 `pre-deploy-20260721-165125.dump`（VM 時鐘係 UTC）。模型檔 + `BuyDashboard.tsx` 零 diff。模型檔 + `BuyDashboard.tsx` 零 diff。v1.0.0 / v1.0.1 / v1.0.2 / v1.1.0 / v1.1.1 文件保留做歷史。

---

## 0. 一句講晒

**odds-tool 係一個足球賠率價值分析 PWA，已正式上線生產：`https://odds.ballballchu.com.hk`。** React 19 + TS 前端（中文 UI + 球隊 logo + **Chiikawa pastel 主題** + **Today-first 首頁 v1.1.0** + **單場分析頁 v1.1.1** + **賽程／紀錄執整 v1.2.0**）、raw `node:http` API、PostgreSQL 18、Cloudflare Tunnel 對外（零主機 port）、兩個 collector 自動運行緊。單一 owner 登入，冇 signup。四個投注模型（主客和／大細／角球／亞洲讓球）凍結喺 3% edge 門檻，全部 0 settled matches，等緊數據累積到每個 30 場先可以考慮調校。

⚠️ Production 行緊 v1.2.0 + post-kickoff gate 修正 build（bundle `index-BQuUTJ1Q.js`，2026-07-22 凌晨兩次部署；v1.2.0 初版係 `index-jmHUUAaH.js`）。修正詳情：`docs/HANDOFF-2026-07-22-post-kickoff-gate.md`。

專案位置：`C:\Users\itadmin\Documents\賭`（Windows 本機；git repo 2026-07-19 重建，base commit `645f22a`，冇 remote）。

---

## 1. 上手路線圖

### 1.1 五分鐘理解全局

1. 讀本文件 §2（系統現況）→ §3（架構）→ §10（硬性紅線）。
2. 跑 §1.3 快速健康檢查，確認線上狀態正常。

### 1.2 要做改動之前

1. 讀 §5（程式碼地圖）搵到你要改嘅檔案。
2. 讀 §8（開發／測試流程）—— **TDD 係 repo 紀律**，新行為先寫 failing test。
3. 讀 §9（部署）如果改動要上线。
4. 睇 §11（已知問題）避免撞舊坑。

### 1.3 快速健康檢查（接手第一件事）

```bash
# 公開端點（任何機器）
curl -s -o /dev/null -w "%{http_code}\n" https://odds.ballballchu.com.hk/                    # 200
curl -s -o /dev/null -w "%{http_code}\n" https://odds.ballballchu.com.hk/api/v1/results     # 401
curl -s -o /dev/null -w "%{http_code}\n" https://odds.ballballchu.com.hk/internal/health/ready  # 404
curl -sI https://odds.ballballchu.com.hk/ | grep -ci "strict-transport-security"            # >=1

# Stack（要 sudo askpass，見 §9.1）
ssh -i ~/.ssh/astra_vm_ed25519 -o BatchMode=yes -p 169 hugo@118.140.60.206
export SUDO_ASKPASS=/tmp/.ap.sh
sudo -A docker ps --filter name=odds-tool --format "{{.Names}} {{.Status}}"
# expect: postgres/api/caddy healthy, collector + cloudflared Up

# Tunnel 接通數
sudo -A docker logs odds-tool-cloudflared-1 2>&1 | grep -c "Registered tunnel connection"   # 4

# 付費 quota（必須 > 50）
sudo -A docker exec odds-tool-postgres-1 psql -U postgres -d odds -tAc \
  "SELECT state::text FROM collector_state WHERE state_key='hdc-collector';" | grep -oE '"quotaRemaining": *[0-9]+'

# Collector 有冇持續寫（updated_at 應該係近 15 分鐘內）
sudo -A docker exec odds-tool-postgres-1 psql -U postgres -d odds -tAc "SELECT state_key, updated_at FROM collector_state;"
```

### 1.4 文件閱讀順序（按需要深入）

| 順序 | 文件 | 用途 |
|---|---|---|
| 1 | 本文件 | 全局 |
| 2 | `docs/HANDOFF-2026-07-22-post-kickoff-gate.md` | 最新修正：開賽後買盤 gate（已部署，含 UX 陷阱分析 + deferred 後續） |
| 3 | `docs/HANDOFF-2026-07-22-today-first-ui-phase-c.md` | 賽程＋紀錄執整 Phase C（merged master + **已部署**，含 adjudicated deviations + deferred minors + deploy notes） |
| 4 | `docs/HANDOFF-2026-07-21-today-first-ui-phase-b.md` | 單場分析頁 Phase B（已部署，含 SDD 過程 + auto-load gate bug 教訓 + deferred minors） |
| 5 | `docs/HANDOFF-2026-07-21-today-first-ui-phase-a.md` | Today-first 首頁 Phase A（已部署） |
| 6 | `docs/HANDOFF-2026-07-21-chiikawa-ui-refresh.md` | Chiikawa UI 改造 + Playwright 修復（已部署） |
| 7 | `docs/HANDOFF-2026-07-21-team-logos.md` | 球隊 logo + 每日自動 deploy（含 stale SW 事故教訓） |
| 8 | `docs/KIMI-HANDOFF-2026-07-19.md` | Phase 2 部署全記錄 + VM 操作須知 |
| 9 | `docs/HANDOFF-2026-07-19-simple-dashboard-mode.md` | Dashboard 雙模式嘅做法範例（simple 模式已被 TodayPage 取代；v1.2.0 連 `SimpleDashboard.tsx` 本體都刪埋） |
| 10 | `docs/runbooks/production-deployment.md` | 部署／rollback／smoke／secret rotation／故障 playbook |
| 11 | `docs/runbooks/local-postgres-development.md` | 本地 DB 開發 + 測試矩陣 |
| 12 | `docs/runbooks/legacy-migration.md` | 舊 archive → Postgres 遷移同 parity |
| 13 | `docs/CODEX-HANDOFF-2026-07-18.md` | 模型信任政策、snapshot 分類嘅歷史背景 |
| 14 | `.superpowers/sdd*/` | 每個 phase 嘅逐 task 證據（progress.md + task-*-report.md） |

---

## 2. 系統現況（v1.2.0 基線）

| 項目 | 狀態 |
|---|---|
| 網站 | `https://odds.ballballchu.com.hk`（200，PWA 可裝） |
| Owner 帳號 | `s20031521`（唯一帳號，密碼 owner 自選，Argon2id） |
| Stack | postgres / api / caddy / cloudflared / collector 五 container healthy |
| 數據（2026-07-19 上線時） | 96 prediction snapshots、1234 results、live_odds ~170–300 行浮動、286 distinct matches、0 settlements |
| 付費 quota | The Odds API `quotaRemaining` 491/500；collector 有 50-credit 保護線 + provider cooldown |
| 備份 | 手動 `pg_dump`：`/opt/odds-tool/backups/odds-2026-07-19.dump`（已驗證 10/10 表）+ Chiikawa 部署前 `pre-deploy-20260721-044351.dump` + `pre-deploy-20260721-055126.dump` + Today-first 部署前 `pre-deploy-20260721-093231.dump` + Phase B 部署前 `pre-deploy-20260721-122827.dump` — **冇自動備份** |
| 測試 | **Vitest 246/246 全綠**（v1.2.0 233 + post-kickoff gate 13 新）；**Playwright 84/84 全綠**（4 viewports）；server `node:test` 9/9；`tsc --noEmit` 0 errors + `vite build` 通過 |
| Dashboard | 雙模式：**今日（新預設，`TodayPage`）**+ 專業（`BuyDashboard` 原封），`#/today` 右上一條 toggle，localStorage `dashboard-mode`（值仍係 `"simple" \| "pro"` 冇變） |
| UI 主題 | Chiikawa pastel 主題 + Today-first 首頁（v1.1.0）+ 單場分析頁（v1.1.1）+ 賽程／紀錄執整（v1.2.0）+ **post-kickoff gate（2026-07-22，已部署）**：開賽後所有 market card / fixture-row pick label 统一顯示「已開賽」（`src/kickoffGate.ts`，買同唔買都 gate，`BuyDashboard.tsx` 紅線冇郁）；self-hosted Baloo 2 webfont；零外部資源（離線可用）；production bundle `index-BQuUTJ1Q.js`（2026-07-22 凌晨部署） |
| 路由 | `#/today`（首頁）/ `#/fixtures` / `#/analysis`（單場分析頁，`?match=<matchId>` 揀場；裸路徑係揀場 picker）/ `#/history`；**舊 `#/dashboard` 喺 `pageFromHash` alias 落 today**（舊書籤/PWA 唔死），`#/dashboard/<id>` 深鏈維持落 fixtures；nav label：今日／賽程／分析／紀錄 |
| 球隊 logo | `public/team-logos/` 70 個 PNG；`public/team-logos.json` manifest 75 隊（31 隊 `needsReview` 待 owner 核對）；搵唔到顯示 initials 徽章；Caddy `file_server` 直接派 PNG 唔經 API |
| 每日自動續跑 | Blueprint Automation `automation_1dbf8f50-40cd-4dcf-b007-a16b2c452f41`「球隊 logo 每日續跑」，cron `17 9 * * *` Asia/Hong_Kong，enabled，latestRun succeeded |

### 2.1 模型現況（紅線相關）

| 市場 | modelVersion | settled distinct matches | 距離調校門檻 |
|---|---|---:|---:|
| 主客和（1X2） | `consensus-v1` | 0 | 30 |
| 大細波 | `totals-loo-v1` | 0 | 30 |
| 角球大細 | `corner-loo-v1` | 0 | 30 |
| 亞洲讓球 | `hdc-loo-v2` | 0 | 30 |

- `legacy-v0` 只係 archive/audit 分類，**唔係現行模型**，唔可以進入 readiness／hit rate／ROI／值得買計算。
- 30 場係按 `market + modelVersion + matchId` 嘅 settled distinct match 計，唔係 snapshot 行數。
- 舊資料點解角球曾經寫 7 場而家係 0：2026-07-16 加咗嚴格 snapshot trust policy（要有效 `commenceTime`、賽前 `savedAt`、odds、chance、合法 line），嗰批缺 `commenceTime`，保留做 audit 但分類 invalid。規則喺 `shared/snapshot-policy.mjs`。

---

## 3. 架構

### 3.1 生產數據流

```text
Internet → Cloudflare edge (HTTPS) → cloudflared (tunnel_net, outbound QUIC)
  → caddy:80 (tunnel_net+app_net)      # handle blocks: /internal/*→404, /api/v1/*→proxy, /api/*→404, legacy→404, SPA fallback
  → api:8787 (app_net+db_net)          # setpriv uid 1000；TRUSTED_PROXY_CIDRS=172.16.0.0/12；RUN_MIGRATIONS=false
  → postgres:5432 (db_net internal)    # roles: odds_app(CRUD-only) / odds_migration(DDL)

collector (app_net+db_net)             # 同 api image；每 5 min hdc-collector（state-driven，閒置零 call）+ 每 15 min hkjc-import（免費）
```

- **零 published host ports**；對外唯一入口係 cloudflared outbound QUIC 去 Cloudflare。
- 三個 Docker networks：`db_net`（internal-only）、`app_net`、`tunnel_net`。
- Logs 全部 json-file，`max-size 10m, max-file 3`。
- 所有 base images digest-pinned；api image 俾 api + collector 共用。
- `/team-logos/*` 同 `/team-logos.json` 由 Caddy `file_server` 直接派（打進 `dist/`，唔經 API）；`/chiikawa/*` 同 `/fonts/*`（v1.0.2 新素材）同一機制。

### 3.2 部署邊界（極重要）

- **前端改動 → 重建 caddy image**（`deploy/web.Dockerfile` 內嵌 PWA `dist/` + Caddyfile）。
- **server / collector 改動 → 重建 api image**（`deploy/api.Dockerfile`）。
- ⚠️ **v1.2.0 兩邊都有改動**（server `backtest.mjs` + 前端）→ deploy 要 rebuild **api + caddy 兩個 image**（Phase A/B 純前端淨 caddy）。
- VM 上 `/opt/odds-tool/build/` 係 repo 嘅 copy — **本地改完要 scp 同步**，compose 要 `sed 's|context: \.\.|context: ./build|'` 轉換先放上 `/opt/odds-tool/compose.yaml`。

### 3.3 API 路由（`server/app.mjs` route table）

| Route | Auth | 備註 |
|---|---|---|
| `POST /api/v1/auth/login` | public | 16 KiB body limit；throttled（5 次 fail / 15 min → 429 30 min，dual scope：username + client IP） |
| `GET /api/v1/session` | public | 回 `authenticated` + 新鮮 CSRF token |
| `POST /api/v1/auth/logout` | session + CSRF + Origin | server-side revoke |
| `GET /api/v1/odds/live` | session | live odds entries |
| `GET /api/v1/results` | session | 完場結果 |
| `GET /api/v1/backtest` | session | snapshot-vs-result 回測 summary + readiness + **v1.2.0 新增 `pending`**（未結算 valid-current snapshot 行：id/matchId/market/prediction/line/odds/chance/edge/commenceTime/savedAt/modelVersion/source/status；status ∈ upcoming/settling/overdue/unknown，180-min 結算寬限；按開賽時間升序；冇新 endpoint） |
| `POST /api/v1/predictions` | session + CSRF + Origin | 1 MiB body limit；batch snapshot insert |
| `GET /internal/health/ready` | public 但 Caddy edge 404 | readiness（SELECT 1），**永遠唔可以公開** |
| 舊 `/api/*`、`/hkjc-odds.json`、`/health` | — | 全部 fail closed 404 |

### 3.4 Auth / 安全細節

- Cookie：`__Host-odds_session; Path=/; Secure; HttpOnly; SameSite=Strict`（冇 Domain）。
- Session：opaque 32-byte base64url token，DB 只存 SHA-256 digest；閒置 14 日滑動失效，絕對 30 日。
- 密碼：Argon2id m=19456 t=2 p=1；dummy-hash constant-time login。
- CSRF：per-session token，`x-csrf-token` header + `Origin === PUBLIC_ORIGIN` exact match 先俾 mutation。
- Client IP：`TRUSTED_PROXY_CIDRS`（`172.16.0.0/12`）gate 住嘅 X-Forwarded-For 左most。
- Error response 唔回傳 SQL、路徑或 secret。
- 主要檔案：`server/auth/`、`server/http/security.mjs`、`server/http/cookies.mjs`、`server/http/client-ip.mjs`。

---

## 4. 投注模型同「值得買」邏輯（全部 client-side）

### 4.1 Pipeline

```text
四個市場模型各自產生 candidates
  主客和   src/odds.ts        analyzeEntries
  大細波   src/totals.ts      → src/asianTotals.ts asianTotalMetrics
  角球大細 src/corners.ts
  亞洲讓球 src/handicap.ts    buildHandicapCards
→ src/buyCandidates.ts buildBuyCandidates   合併成 BuyCandidate[]
→ src/buyOpportunities.ts selectBuyOpportunities (lines 61–103)
     !dataFresh → 全部丟棄
     kickoff 未來 + chance∈(0,1] + odds>1 + edge >= 0.03
     按 match 分組、每 market+line 留 best edge、按 primary edge 降序
→ Dashboard 顯示（極簡 = 每卡一場波列晒過關盤；專業 = 完整 BuyDashboard）
→ v1.2.0：buyOpportunities 再 derive `buyMatchIds` → 賽程頁 h2h 行嘅「有貨」mint 點（fail-closed）
```

### 4.2 核心常數（凍結，見 §10 紅線）

| 常數 | 值 | 位置 |
|---|---|---|
| `BUY_EDGE_THRESHOLD` | `0.03` | `src/buyOpportunities.ts:1` |
| analyzer defaults | bankroll 1000 / fractionalKelly 0.25 / stakeCapPercent 0.02 / edgeThreshold 0.03 | `src/App.tsx:132–137` |
| edge 公式 | `winWeight * (odds - 1) - lossWeight` | `src/asianTotals.ts:35` |
| stake | fractional Kelly，cap 2% bankroll | `src/asianTotals.ts:36–38`、`src/odds.ts kellyStake` |
| 模型機率 | league-calibrated expected goals/corners，season/recent blend（`recentWeight` clamp 0–1）+ Poisson settlement | `src/totals.ts:38–44`、`src/corners.ts` |
| market blend（可選） | `calibratedProbability(model, odds, otherOdds, weight=0.5)` | `src/marketCalibration.ts:1–11` |
| data-freshness | 45 min | `server/domain/backtest.mjs:3` |
| settlement grace | 180 min | `server/domain/backtest.mjs:4` |
| `READINESS_TARGET`（v1.2.0 新） | 30 場 | 紀錄頁 readiness 進度條顯示用（client 端） |
| `HDC_REFRESH_MS` | 3 min | `src/App.tsx:100` |

### 4.3 Result source priorities（upsert 只喺 priority 嚴格更高時）

`FOTMOB 40 > API-Football 30 > HKJC historic 20 > HKJC live 10 > legacy import 0` — collector 寫嘅結果永遠贏 legacy；重跑 legacy import 唔會覆蓋新數據。

---

## 5. 程式碼地圖

### 5.1 Top-level

| Path | 用途 |
|---|---|
| `src/` | React 19 + TS 前端（Vite），PWA（v1.2.0 cleanup：刪 SimpleDashboard + 舊 analysis CSS + marketDisplay dead exports，11 files +10/−559） |
| `server/` | Node API（raw `node:http`，冇 Express/Fastify）、auth、DB repositories、domain 邏輯；全 `.mjs` ESM |
| `scripts/` | collector／import／integrity／ops／team-logo scripts + 佢哋嘅 node:test 測試 |
| `db/migrations/` | SQL migrations 001–003（ledger `schema_migrations` + advisory lock） |
| `shared/` | browser/server/collector 共用：`snapshot-policy.mjs` + types |
| `deploy/` | compose.yaml、Dockerfiles、Caddyfile、postgres roles script、secrets README |
| `docs/` | 交接文件 + runbooks + superpowers plans/specs + `prediction-log.md` |
| `data/` | 舊 file-mode archives（JSONL）— **immutable audit baseline** |
| `public/` | PWA icons + 舊 `hkjc-odds.json`（inert artifact，runtime 唔讀）+ `team-logos/`（70 PNG）+ `team-logos.json`（manifest，runtime 讀）+ **`chiikawa/`（4 張 mascot PNG）** + **`fonts/baloo-2-var.woff2`（self-hosted webfont）** |
| `server.mjs`（root） | **舊 file-mode server，已被 `server/entry.mjs` 取代**，留做 reference，唔好加新嘢 |
| `compose.test.yaml` | disposable Postgres 18（tmpfs）@ `127.0.0.1:55432` 俾 DB 測試 |
| `.env.local` | **live provider API keys**（gitignored，唔好 print／commit） |
| `.hermes/plans/` | 17 份早期 planning docs（7/8–7/12） |
| `.superpowers/` | SDD artifacts：`sdd/`（dashboard mode）、`sdd-production-phase1/`、`sdd-production-phase2/`、`sdd-responsive-pwa/`、`brainstorm/` mockups |

### 5.2 前端 `src/`

- 入口：`index.html`（zh-Hant，`theme-color` `#FFF8F0`）→ `src/main.tsx` → `src/App.tsx`（monolith：auth state、data loading、settings、四模型 wiring；v1.1.1 刪咗舊分析頁 ~180 行；v1.2.0 加 `readiness` / `pendingEntries` state，error path 清晒所有 response-owned state）。
- Hash router `src/route.ts`：`today` / `fixtures` / `analysis` / `history`（bare `#/dashboard` alias 落 `today`，`#/dashboard/<id>` 深鏈維持落 fixtures）；`analysisMatchIdFromHash` 解析 `#/analysis?match=<id>`（strict-equals `analysis` path，URLSearchParams decode）。
- `src/apiClient.ts`：`/api/v1` fetch wrapper，session/CSRF。v1.2.0：`BacktestResponse` 加 `pending`；`ModelReadiness` / `PendingEntry` types + `isModelReadiness` / `isPendingEntry` guards；`ResultEntry` 加 optional `edge` / `savedAt`。
- Pages：`DashboardPage.tsx`（今日/專業 toggle）→ **`TodayPage.tsx`（v1.1.0 首頁；v1.2.0 `dataFresh` false 時收埋即將開賽 section）**｜`BuyDashboard.tsx`（專業，**唔准改**，見 §10）；**`MatchAnalysisPage.tsx`（v1.1.1 單場分析頁**：picker／搵唔到／完整三態，四市場卡固定次序 主客和→大細→角球→亞洲讓球）；`AllFixtures.tsx`、`LoginPage.tsx`。`SimpleDashboard.tsx` **已刪除（v1.2.0，owner-approved）**，連佢嘅 test。
- **賽程頁元件（v1.2.0 新，h2h tab）**：`src/dashboard.ts` `formatFixtureDayHeading`（今日/聽日前綴按 HK 曆日；`formatFixtureDateHeading` 唔郁，locked test 照舊）；一行式 `.fixture-row`（時間｜對賽｜聯賽｜有貨點｜pick label）取代三欄卡，`.fixture-card` 其他 tab 保留；`.fixture-row__buy-dot`（mint `--color-positive`）由 `buyMatchIds` 供（derived from `buyOpportunities`，fail-closed）；日內排序 memo `fixtureDayGroupsByTime`（`sortFixturesByBestEdge` 唔郁）；toolbar：聯賽 chips 多選 `.fixture-chip` + 隊名搜尋 `.fixture-search`（中英 case-insensitive），filter memo `visibleFixtureDayGroups`，預設 no-op 全部顯示。
- **紀錄頁元件（v1.2.0 新）**：四模型 readiness 進度條 `.model-readiness`（`READINESS_TARGET = 30`，主客和/consensus-v1、大細波/totals-loo-v1、角球/corner-loo-v1、亞洲讓球/hdc-loo-v2，各 `X/30 場`）；每個市場兩組：「等緊開賽」`PendingCard` `<details>`（隊名經 `fixturesByMatchId` 由 fixtures join，fallback raw matchId；盤口/賠率/模型機率/Edge/模型/快照時間）+「已完場」（原有卡 + `<details className="other-lines">` 賽前快照，`hasPredictionSnapshot` gate）。Locked 保留：`.empty-state[role="alert"]`、`role="status"` loading、`完場對比` h1、`.sample-warning`。
- **單場分析元件（v1.1.1）**：`src/matchDetails.ts`（純函數 `buildMatchMarketDetails`：按 matchId 由 h2h rows + total/corner/handicap cards 組裝四市場 `MarketDetail`（ok/insufficient/empty 三態）+ header metadata，fixtures 搵唔到會 fallback 用卡 metadata）；`src/components/MarketDetailCard.tsx`（三態卡）；`src/styles/match.css`（全用 tokens variables）。⚠️ 新頁面記住檢查 **live odds auto-load gate 有冇包佢**（Phase B 教訓：gate 原本只包 today/fixtures，cold visit analysis 冇數據；v1.2.0 history 頁都入埋 gate，等 pending 行 join 到隊名）。
- **Today-first 元件（v1.1.0）**：`src/components/PickCard.tsx`（三行卡 + 原生 `<details>` 原地展開；export `formatSelection/formatOdds/formatKickoff`；v1.2.0 「賠率同步於」改用 `formatKickoff`，唔再 raw ISO）、`FreshnessBar.tsx`（新鮮／過期／冇同步三態）、`EmptyState.tsx`（stale／no-fixtures／no-value 三種冇貨原因）、`src/stakeDisplay.ts`（`displayStake`：顯示用 fractional Kelly，defaults 1000/0.25/0.02 跟 analyzer；v1.2.0 test 註解更正）、`src/styles/today.css`（全部新 class，`main.tsx` import）。
- 模型檔：`odds.ts`、`totals.ts`、`asianTotals.ts`、`corners.ts`、`handicap.ts`、`buyCandidates.ts`、`buyOpportunities.ts`、`picks.ts`、`fixtureMatch.ts`、`marketCalibration.ts`、`marketDisplay.ts`（v1.2.0 刪咗 dead exports：PerformanceRow、PerformanceSummary、selectDistinctPerformanceRows、summarizePerformanceRows、currentModelRows、predictionDistribution、calibrationBuckets + private helpers，連測試；其他保留）。
- 基礎：`predictionSnapshots.ts`（localStorage snapshot + policy 分類）、`dataHealth.ts`、`dashboardMode.ts`、`dashboard.ts`、`pwa.ts`、`kickoffGate.ts`（**2026-07-22 新**：`isPostKickoff` / `gatePickLabel`，開賽後所有 pick label → 「已開賽」；接線 fixture-row、亞洲讓球卡、`MarketCardGroup`、`MarketDetailCard`）。
- 球隊 logo：`TeamLogo` component + `team-logos.json` manifest（格式 `{ 英文名: { id, logo, needsReview? } }`）。**Lookup 用英文名**（`homeTeam/awayTeam`），中文顯示名（`homeTeamZh` 等）完全獨立唔影響 logo；manifest 冇 entry 或 PNG load 失敗 → 顯示 initials 徽章 fallback，唔會壞 UI。
- **Chiikawa UI**：`src/components/Kawaii.tsx` — `<Mascot pose="chiikawa-corner|chiikawa-empty|momonga-loading|momonga-alert|login-duo" />` + `<KawaiiDecor />`（CSS 花瓣/星星，`aria-hidden`）；`momonga-alert` 係 40×40 icon 級，重用 momonga-loading 圖。`src/styles/kawaii.css` 管四個 pose 嘅定位/尺寸（corner 係 fixed 右下角常駐，mobile 縮細）+ decor 動效，`main.tsx` import。素材 `public/chiikawa/` 4 張 PNG，檔名係 plan contract，`Kawaii.tsx` 直接引用 `/chiikawa/<檔名>`，改名要兩邊一齊改。
- 樣式：`styles/tokens.css`（CSS variables 單一來源；pastel 色板，見 §5.6）、`layout.css`（nav active pastel pill）、`dashboard.css`（淺色底對比度修正）、`kawaii.css`、`today.css`（v1.1.0）、`match.css`（v1.1.1）、`styles.css`（pastel sweep；`@font-face` 引入 self-hosted Baloo 2；v1.2.0 刪咗舊 analysis CSS ~160 行：`.analysis-performance`、`.performance-market-*`、`.model-summary-*`、`.readiness-head`、`.health-tags`、`.performance-detail-grid`、`.performance-bar*` + 兩個 dead @media；`.sample-warning` 保留）。
- 中文顯示：隊名 `homeTeamZh/awayTeamZh`、聯賽 `leagueZh`，render 時 `zh ?? en`；data 層英文唔郁（matching/identity/logo lookup 靠英文名）。the-odds-api 行冇中文來源，`leagueZh` 永遠英文（by design）。

### 5.3 Server `server/`

- `entry.mjs`：config → pg pool →（可選）migrations → repositories + auth service → listen `HOST:PORT`（default `127.0.0.1:8787`）；`--self-test` 跑 backtest assertion 就 exit。
- `app.mjs`：route table（§3.3）+ legacy 404。
- `config.mjs`：`DATABASE_URL`（必需，validate postgres URL）、`SESSION_SECRET`（≥32 bytes）、`PUBLIC_ORIGIN`（必需，strict HTTPS，local 都唔俾 http）、`RUN_MIGRATIONS`（只有 exact `false` 先 skip）、`TRUSTED_PROXY_CIDRS`。
- `auth/`：session、password、auth-service、login-throttle（DB-backed `login_attempts` + FOR UPDATE）。
- `db/`：`pool.mjs`、`snapshot-repository.mjs`（immutable insert）、`result-repository.mjs`（priority upsert）、`odds-repository.mjs`（per-provider delete+insert under advisory lock）、`collector-state-repository.mjs`（JSONB KV）、`migrate.mjs`。
- `domain/`：`backtest.mjs`（settlement、health、freshness；**v1.2.0 加 `buildPendingRows`** — 未結算 valid-current snapshot 行，status upcoming/settling/overdue/unknown，180-min grace）、`identity.mjs`（identity keys，**live odds identity 包 bookmaker 後綴**，冇 bookmaker 時維持舊五段格式）。

### 5.4 DB schema（migrations 001–003，現行 version 003）

`schema_migrations`、`owners`（singleton unique index）、`sessions`、`login_attempts`、`prediction_snapshots`（odds/chance CHECK）、`results`、`live_odds`、`collector_state`、`import_runs`、`import_rows`（audit ledger，invalid rows 只入呢度）。

### 5.5 Scripts `scripts/`

| Script | 做咩 | 生產 cadence | self-test |
|---|---|---|---|
| `hdc-collector.mjs` (423 ln) | 付費 The Odds API：fixture discovery（15 min cooldown）、odds window polling（25/5 min）、result fetch（3h delay）；quota 50-credit 保護線 + provider cooldown；經 Vite SSR load parsers | 每 5 min（`collector-entrypoint.sh` loop） | `--self-test` |
| `hkjc-import.mjs` (1,067 ln) | 免費 HKJC GraphQL import + API-Football result/corner backfill（每日 90-call budget，10 reserve；result 150-min delay）；寫 `public/hkjc-odds.json`、results、snapshots | 每 15 min（每第 3 個 cycle） | `--self-test` |
| `build-team-logos.mjs` | API-Football `/teams?search=` 逐隊搵 logo → 落 PNG 入 `public/team-logos/` + 更新 `public/team-logos.json` manifest；**idempotent**（已有 PNG 跳過）；`--max-calls` quota guard（automation 用 85）；alias 處理官方名差異（例：Jeju SK → Jeju United FC）；⚠️ free plan 100 calls/day、10/min，script sleep 120ms 會撞 per-minute 429（見 §11.2） | 每日 09:17 HKT（Blueprint Automation，見 §2） | 有測試（scripts 測試 + Vitest） |
| `odds-monitor.mjs` | legacy watchlist alerter（`monitor.config.json` 驅動） | 手動 / `--once` | `--self-test` |
| `import-legacy-to-postgres.mjs` | 一次性 legacy JSONL → Postgres，idempotent（`IMPORTER_VERSION="phase1-v1"`） | 已完成 | — |
| `check-data-integrity.mjs` | file mode 或 `--database`；fail 就 non-zero exit | 手動 | — |
| `check-postgres-parity.mjs` | 證明 Postgres 重現 archive backtest byte-for-byte | 手動 | — |
| `create-owner.mjs` | 單一 owner bootstrap（`OWNER_USERNAME` + `OWNER_PASSWORD_FILE`，advisory lock） | 已完成 | — |
| `lib/storage-backend.mjs` | `file` vs `postgres` backend；`NODE_ENV=production` 強制 postgres | — | — |
| `lib/postgres-sink.mjs` | 包 pool + repositories 俾 collectors | — | — |
| `lib/test-db.mjs` | disposable-schema 測試 helper（見 §8.2） | — | — |

### 5.6 Chiikawa 主題速覽（v1.0.2 新）

- **色板（`tokens.css`）**：奶油白底 `#FFF8F0`、暖白卡片 `#FFFEFC`、奶藍 primary `#5E9FD4`、淡粉 `#FFD9E0`、淡黃 `#FFF1C9`、薄荷綠 positive `#7FCFA9`、蜜桃粉 negative `#F2A0A0`、蜜糖黃 warning `#E8B45A`、深可可文字 `#4A3F3F`（唔用死黑）、灰杏 muted `#A89B91`。
- **文字色另開 token 模式（記住呢個 pattern）**：pastel 底色做文字色對比唔夠 → `--color-positive-text: #2F7D5F`、`--color-negative-text: #C05A5A`、`--color-primary-text: #2E6DA4`（`ec24f06` 加，對比 2.70:1 → 5.19:1，WCAG AA 達標）。
- **字體**：`--font-rounded` = `"Baloo 2", "PingFang TC", "Microsoft JhengHei", sans-serif`；`58ff5b9` self-host 咗 `public/fonts/baloo-2-var.woff2`（177 KB variable 400–800，SIL OFL）+ `styles.css` 頂部 `@font-face`，PWA precache 已包，離線紅線保持。
- **設計紅線（後續改 UI 都要守）**：鎖死字串唔准改（一堆 SSR 測試逐字斷言，完整清單喺 plan `docs/superpowers/plans/2026-07-21-chiikawa-ui-refresh.md` 嘅 Global Constraints）；className 唔准改名，只加新 class；幾何唔准變（`--touch-target` 44px、dashboard grid 列數、nav breakpoints）。
- **素材版權**：圖下載自 chiikawa-wallpaper.com（免費、僅供個人用途），版權屬原作者 Nagano。本項目屬個人用途，但**圖唔可以隨項目對外發佈或商用**。README 尾有「Artwork Assets」一節註明。
- 詳情：`docs/HANDOFF-2026-07-21-chiikawa-ui-refresh.md`；設計規格 `docs/superpowers/specs/2026-07-21-chiikawa-ui-refresh-design.md`。

---

## 6. 數據同信任政策

- **Source of truth**：runtime 全部係 PostgreSQL；`data/*.jsonl`、`data/*.json`、`public/hkjc-odds.json` 係 immutable audit baseline，郁之前要 sha256 對比。
- Snapshot identity：`matchId|market|line|modelVersion`，第一個 snapshot immutable。
- 分類（`shared/snapshot-policy.mjs`）：valid-current／legacy／invalid；current API 只讀 `listCurrent()`；legacy/invalid 可 audit 但唔污染 readiness／performance。
- Live odds identity：`matchId|market|line|point|bookmaker`（bookmaker-aware；2026-07-19 bug fix，之前多莊家撞 unique key 23505）。
- 預期數據（2026-07-19）：snapshotRows=183（DB 存 96 valid+legacy；87 invalid audit-only）、resultRows=853、distinctMatches=286、settlements=0。
- 球隊 logo 數據：`public/team-logos.json` manifest 係 runtime 讀嘅唯一 logo 來源（client fetch）；PNG 檔名同 manifest 一致；manifest 加 team 要 `id` + `logo` 齊，核對未確認標 `needsReview: true`。

---

## 7. Secrets（全部位置，值永遠唔入 repo／log／chat）

### 7.1 VM production（`/opt/odds-tool/secrets/`，0400 root:root）

`pg_postgres_password`、`pg_app_password`、`pg_migration_password`、`session_secret`（隨機 48-hex，VM 產生）、`odds_api_key`、`api_football_key`（owner 提供）+ `cloudflared.env`（`TUNNEL_TOKEN=…`，cloudflared 只食 env/CLI 所以唔係 Compose secret）。Rotation 程序：runbook §5（`docs/runbooks/production-deployment.md`）。

### 7.2 本機

- `.env.local`（gitignored）：`ODDS_API_KEY`、`VITE_ODDS_API_KEY`、`API_FOOTBALL_KEY`（`build-team-logos.mjs` 用呢個）。
- Runtime env（server/collector）：`DATABASE_URL`、`SESSION_SECRET`、`PUBLIC_ORIGIN`、`RUN_MIGRATIONS`、`TRUSTED_PROXY_CIDRS`、`STORAGE_BACKEND`、`OWNER_USERNAME`、`OWNER_PASSWORD_FILE`。
- Owner password：只經 hidden prompt 或 `OWNER_PASSWORD_FILE`，用完即刪。
- ⚠️ sudo 密碼曾喺 chat 出現過 — owner 可自行決定 rotate。

---

## 8. 開發／測試流程

### 8.1 本機環境怪癖（Windows）

- Git Bash **冇 `npm`/`npx`** 喺 PATH：前端測試用 `node node_modules/vitest/vitest.mjs run`；build 用 `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` + `node node_modules/vite/bin/vite.js build`；或者 PowerShell 用 `npm.cmd`（Playwright 要 `npm.cmd run test:ui:only`）。
- 本機冇 Docker。
- 混合 CRLF/LF 檔案（`src/odds.ts`、`src/App.tsx`、`src/styles.css`）：Edit tool 會 match 唔到，用 assertion-guarded Python replacement。
- git identity repo-local：`itadmin <itadmin@localhost>`。
- Git repo 2026-07-19 重建（base `645f22a`），**之前嘅歷史冇咗**，舊嘢以文件為準；冇 remote。

### 8.2 測試矩陣

| 類別 | 指令 | 要 disposable DB？ |
|---|---|---|
| 前端 Vitest（**233 tests**，v1.2.0） | `node node_modules/vitest/vitest.mjs run` | 否 |
| Server/collector self-tests | `npm run server:self-test`；`node scripts/{hdc-collector,hkjc-import,odds-monitor}.mjs --self-test` | 否 |
| Data integrity（file mode） | `npm run check:data` | 否 |
| Build | `tsc --noEmit` + `vite build` | 否 |
| Playwright UI（4 viewports，mocks，**84 tests**，v1.2.0） | `npm run test:ui:only`（**打 build 後 preview；src 改咗要先 `vite build`**） | 否 |
| `node --test server/app.test.mjs server/auth/auth.test.mjs` | **係**（DB-backed） |
| `node --test server/db/*.test.mjs`、`scripts/lib/postgres-sink.test.mjs`、`scripts/*-pg.test.mjs`、`scripts/check-data-integrity.test.mjs` | 係 |

Disposable DB 兩個來源：SSH tunnel 去 VM 上嘅 `odds-tool-test` stack（`postgresql://odds_test:odds_test@127.0.0.1:55432/odds_test`，**呢個 exact URL 被 `scripts/lib/test-db.mjs` 硬 assert**），或 `compose.test.yaml`。每個測試開獨立 UUID schema、migrate、完咗 drop；冇 `DATABASE_URL` 時 skip。

```bash
# 開 tunnel（會斷，用前檢查重開）
ssh -i ~/.ssh/astra_vm_ed25519 -o BatchMode=yes -f -N -L 127.0.0.1:55432:127.0.0.1:55432 -p 169 hugo@118.140.60.206
```

⚠️ **Playwright 嘅模式依賴（v1.1.0 起係 option 化嘅）**：`mockApi` 已抽去 `tests/ui/helpers.ts`，`addInitScript` 寫嘅 dashboard-mode 由 `options.dashboardMode` 控制（default `"pro"`）。`dashboard.spec.ts` 唔傳 option 行「專業」；`today.spec.ts` 傳 `dashboardMode: "simple"` 行「今日」。新 spec 記住顯式揀模式，唔好靠 localStorage 殘留/順序。另：`helpers.ts` 嘅 `FUTURE_KICKOFF` hardcode 咗 2030（見 §11.2）；v1.2.0 `entry()` / `total()` 加咗 optional `league` param，`/api/v1/backtest` mock 回 1 settled + 4 readiness + 1 pending row（之前係空陣列）。

### 8.3 紀律

- **TDD**：新行為先寫 failing test（RED → GREEN → refactor）。
- 唔好對 production DB 跑 legacy import／sink fixtures；唔好為驗證跑 live collector（蝕付費 quota）。
- Superpowers SDD workflow（brainstorm → spec → plan → tasks → review）係過往做法；artifacts 喺 `.superpowers/`。

---

## 9. 部署同 VM 操作

### 9.1 VM 存取

```bash
ssh -i ~/.ssh/astra_vm_ed25519 -o BatchMode=yes -p 169 hugo@118.140.60.206
```

- Key 已裝好免密碼。**sudo 要密碼**（hugo 唔喺 docker group）→ askpass：

```bash
printf '#!/bin/sh\nprintf "%%s\\n" "<sudo密碼>"\n' > /tmp/.ap.sh && chmod +x /tmp/.ap.sh
scp -i ~/.ssh/astra_vm_ed25519 -P 169 /tmp/.ap.sh hugo@118.140.60.206:/tmp/.ap.sh
# VM 上：export SUDO_ASKPASS=/tmp/.ap.sh && sudo -A <command>
# 用完兩邊 rm -f /tmp/.ap.sh
```

⚠️ askpass script **必須有 shebang**；⚠️ `/tmp` 跨 Bash call 唔保留（本機 python 同 Git Bash 嘅 `/tmp` 係兩回事）；跨步驟檔案放 workspace。

### 9.2 Stack 佈局（VM）

```text
/opt/odds-tool/
├── compose.yaml          # VM 版（build context ./build）
├── build/                # repo copy（改嘢要雙向同步！）
├── secrets/              # 0400 root:root
├── postgres/create-roles.sh
├── migration-bundle-2026-07-19/   # read-only archive 副本
└── backups/odds-2026-07-19.dump
    backups/pre-deploy-20260721-044351.dump   # Chiikawa 第一次部署前備份（v1.0.2）
    backups/pre-deploy-20260721-055126.dump   # Chiikawa 第二次部署前備份（v1.0.2）
    backups/pre-deploy-20260721-093231.dump   # Today-first Phase A 部署前備份（v1.1.0）
    backups/pre-deploy-20260721-122827.dump   # Phase B 部署前備份（v1.1.1）
    backups/pre-deploy-20260721-165125.dump   # Phase C 部署前備份（v1.2.0，VM 時鐘 UTC = 香港 2026-07-22 00:51）
```

### 9.3 Docker 怪癖（已繞過，唔好「修正」返）

- **Secrets 嘅 uid/gid/mode 被無視**（mount 落嚟 root-only）→ roles 用 `deploy/postgres/create-roles.sh`（idempotent，唔用 initdb.d）；api/collector entrypoint 係 root 啟動讀 secrets 再 `setpriv --reuid=1000 --regid=1000 --init-groups` 降權。
- **`docker compose` 命令一定要 `cd /opt/odds-tool` 先跑**（冇 cd 會靜默無效 — rollback 演練實測）。

### 9.4 部署次序（詳細指令喺 runbook）

`postgres → roles/migrations → api/caddy build → smoke → collector → cloudflared`。

- 部署前：`pg_dump` 備份 + `docker tag odds-tool-{api,caddy}:latest :rollback`。
- `sudo -A docker compose config --quiet` validate → build → per-service `up -d --no-deps <service>`。
- Smoke 綠先開 collector + cloudflared。
- 呢個流程（tarball→scp→rsync→pg_dump→tag rollback→build→smoke）已驗證**八次**：team logos feature 三次（2026-07-20/21）+ Chiikawa UI 兩次（2026-07-21）+ Today-first Phase A 一次（bundle `index-BYUf2jMY.js`、備份 `pre-deploy-20260721-093231.dump`）+ Phase B 一次（2026-07-21 晚，純前端淨 rebuild caddy，bundle `index-BW9hE076.js`、備份 `pre-deploy-20260721-122827.dump`）+ Phase C 一次（2026-07-22 凌晨，api + caddy 兩個 image，bundle `index-jmHUUAaH.js`、備份 `pre-deploy-20260721-165125.dump`；中途 git archive CRLF 中伏一次，見下面 ⚠️）。
- ⚠️ **v1.2.0 已部署（2026-07-22 凌晨）**：rebuild api + caddy 兩個 image，bundle `index-jmHUUAaH.js`，備份 `pre-deploy-20260721-165125.dump`，rollback tags 已打，smoke 全綠（internal 200/404/200、public 200/401/404/HSTS、tunnel ×4、quota 388、collector 重啟後即寫咗批新盤）。
- ⚠️ **git archive 喺 Windows 會輸出 CRLF**（v1.2.0 部署實測中伏）：`git archive` 跟 `core.autocrlf=true` 將成個 tarball 轉 CRLF → image 入面 `.sh` entrypoint 嘅 shebang 變 `#!/bin/sh\r` → api container `exec ... no such file or directory` 不停 restart。解法：打包用 `git -c core.autocrlf=false -c core.eol=lf archive master -o <tar>`，上傳前 `tar -xOf <tar> deploy/api-entrypoint.sh | head -1 | od -c` 驗證係 `\n` 先繼續。
- ⚠️ **Cloudflare 預設快取 `.js`**：曾經舊 `sw.js` 派舊 bundle 嘅 incident。Caddy 已對 `/sw.js`、`/registerSW.js` 派 `no-cache, must-revalidate`；如果更新後睇唔到新 UI，Cloudflare dashboard Purge Everything。**如果個 client 已經中咗招（裝咗舊 SW）**，Caddy no-cache 救唔到佢 — 要喺嗰個 client unregister service worker + `caches.delete()` 一次（見 §11.3 第 6 條）。

### 9.5 Rollback

- Kill-switch（安全事件）：`docker compose stop cloudflared`（網站即熄，stack 保留俾 diagnosis）。
- App rollback（已演練）：`docker tag odds-tool-api:rollback odds-tool-api:latest && cd /opt/odds-tool && sudo -A docker compose up -d --no-deps --force-recreate api collector`（caddy 同理）。
- DB：migrations **永遠唔好盲目 reverse**；restore 用 pre-deploy `pg_dump`（runbook §4）。

### 9.6 故障 playbook（速查）

| 症狀 | 第一步 |
|---|---|
| Public 502 / Cloudflare 1033 | `docker logs odds-tool-cloudflared-1`；dashboard public hostname 要係 `http://caddy:80`；caddy healthy？ |
| 所有人 login 401 | api up？`session_secret` 俾人 rotate 咗？ |
| 密碼啱但 401/429 | throttle：`DELETE FROM login_attempts;` |
| Collector 靜 | 佢淨係 error/state 先 log；check `collector_state.updated_at`；quota < 50 係正確拒絕 |
| DB down | `docker compose up -d postgres`；pgdata volume persist；**永遠唔好 `down -v`** |
| 部署後 UI 冇更新 | Purge Cloudflare cache；唔得就 client unregister SW + clear Cache Storage（stale SW，§11.3 #6） |

---

## 10. 硬性紅線（違反即事故）

1. **模型凍結**：四個模型 0/30 settled distinct matches — 唔准調 weights、Kelly、ROI 定義或 3% edge threshold，亦唔准為製造 picks 降門檻。
2. **`BuyDashboard.tsx` / `BuyDashboard.test.tsx` 唔准改**（owner 明確指示；新 view 開新檔）。Chiikawa UI refresh 有過**有限度豁免**：只加咗一個 Mascot/微文案展示元素，冇郁邏輯 — 唔好當係常態先例。
3. **絕對唔好郁 `hugo` 嘅 VM login**：唔好刪帳戶、唔好閂 SSH 密碼登入、唔好 rotate 密碼，除非 owner 明確叫。
4. **三個現有 VM stack 唔掂得**：`astra`、`store-network-dashboard`、`odds-tool-test`（disposable test DB 喺 `127.0.0.1:55432`）。
5. **零 published host ports**：對外只有 cloudflared outbound QUIC。
6. **Archives immutable**：`data/*.jsonl`、`data/*.json`、`public/hkjc-odds.json` 郁之前要 sha256 對比。
7. **Secrets 永遠唔入** compose.yaml、CLI args、logs、chat、git、docker image、frontend `VITE_` 變數。`.env.local` 唔好 print。
8. **`/internal/*` 永遠唔可以公開**（Caddy 404 係第一道閘）。
9. **Result priority 唔准改**：FOTMOB 40 > API-Football 30 > HKJC historic 20 > live 10 > legacy 0。
10. **TDD 係 repo 紀律**；production collector 唔好用 live provider 做驗證。

---

## 11. 已知問題／技術債（v1.2.0 時點）

### 11.1 未做（按優先順序）

1. **自動備份（Phase 3）** — Restic 加密去 S3-compatible + 每日排程 + restore 演練。Owner 2026-07-19 話「唔一定要」；依家只靠手動 pg_dump。
2. **VM provider 快照** — owner 去控制台撳。
3. **閂 SSH 密碼登入** — key-only 已驗證可用；owner 未批。
4. **Cloudflare Access** — 可選加多層驗證。
5. **Phase 3 其他**：private GitHub + CI + GHCR + image scanning。

### 11.2 Known minor（唔阻運作）

- 完場／歷史版未中文化（result entries 冇中文資料）。
- the-odds-api 行 `leagueZh` 永遠英文（冇中文來源，by design）。
- 測試空隙：`DASHBOARD_MODE_STORAGE_KEY` 字面值冇 assertion；toggle 寫 localStorage 條 path 喺 `renderToStaticMarkup` 測唔到（組成函數各自有覆蓋）。
- `server.mjs`（root）legacy code 未清理；`public/hkjc-odds.json` 仲係 inert artifact；`installed.json.backup` stray file。
- oversized request stream 超限後未明確 destroy（minor）。
- sudo 密碼曾喺 chat 出現 — owner 決定使唔使 rotate。
- **球隊 logo manifest 31 隊 `needsReview`** 待 owner 核對（API search 名可能對錯隊）；女子隊 API-Football free plan 冇 logo 數據（長遠要升 plan 或另搵 source）。
- `build-team-logos.mjs` sleep 120ms 會撞 API-Football per-minute 429（10/min limit）；建議改 7 秒（要同步改對應 test），未改。
- `scripts/tmp-*.mjs`、`webbridge-req-*.json`、`data/priority-*`、`data/current-teams-now.txt` 係 logo 開發期間嘅臨時／診斷檔，有意未入 git，可清。
- **Today-first Phase C deferred minors（v1.2.0 新增，final review triage 過，全部唔阻 merge）**：
  - Server `pending` 嘅 "unknown" status / fallback / grace-boundary 路徑冇測試。
  - `PendingEntry.status` 冇渲染上 PendingCard（contract 暫時 write-only）。
  - `READINESS_MODELS` client 端 hardcode 咗 server 模型 registry（兩邊要同步改）。
  - `buildPendingRows` 重複計 settled/commenceByMatch（同 summarizeReadiness dup）。
  - `formatTimeOnly` 重複 pad 邏輯。
  - `fixturesByMatchId` 淨包 h2h — 非 h2h pending 行顯示 raw matchId。
  - 聯賽 chip stale selection 冇 prune（揀咗嘅聯賽消失仲留喺 selection）。
  - `isPendingEntry` 對 numeric fields 檢查寬鬆（plan-mandated）。
- **Post-kickoff gate 後續（2026-07-22 新增，詳見 `HANDOFF-2026-07-22-post-kickoff-gate.md` §5）**：
  - 紀錄頁大細波 tab 有 3 條 12/7–13/7 the-odds-api pending snapshot，結果追蹤窗口（開賽後 3 日）喺 7-19 遷移期間已過，**永遠唔會 settle、唔會計入 30 場**（遷移犧牲品，可日後清理/標記）。
  - **Quota 兩條 key 對唔上**：VM collector state `quotaRemaining: 373`，本機 `.env.local` 條 key 直查得 177 — 大機會本機同 production 係兩條唔同 key；Kimi 嘅 quota 監察 widget task 讀本機 key，換 key 時要一併校準。
  - `BuyDashboard.tsx`（專業模式）紅線冇郁 → 專業版開賽後理論上仲會出「買」label；要改要 owner 明確豁免。
  - Client snapshot POST 係 fire-and-forget（`void apiClient.savePredictions(...)`），server rejected 原因冇人睇 — 潛在盲點，未改。
  - 系統冇接 HKJC 即場盤；開賽後顯示嘅係賽前 closing odds。即場投注如要做係新模型（新 modelVersion、獨立儲 30 場），唔可以溝入現行 sample。
  - **主客和採樣範圍 vs 顯示範圍唔一致**：`toSnapshot` 主客和／角球淨記 `hkjc-` 場，但今日頁會顯示 the-odds-api h2h 嘅主客和 pick（唔會落 sample）；同一場波兩個 namespace（hex vs `hkjc-*`）冇 join。2026-07-22 實例：Larne 買主勝卡冇記錄；當晚首個真 sample 係 Fenerbahce 客勝 @18.55（已 settle，MISS → 主客和 1/30）。
- **Today-first Phase A deferred minors（v1.1.0 新增；v1.2.0 已清咗一部分）**：
  - ~~`PickCard` 展開區「賠率同步於」顯示 raw ISO timestamp~~ ✅ v1.2.0 已改用 `formatKickoff`（dynamic test assertion）。
  - ~~stale 狀態下「即將開賽」section 仲會顯示~~ ✅ v1.2.0 `TodayPage` 喺 `dataFresh` false 時收埋個 section（連測試）。
  - 冇貨文案 simple（`數據舊咗，唔好住落注`）vs pro（`資料未更新，暫停顯示買盤。`）唔一致（設計層，未統一）。
  - `tests/ui/helpers.ts` `FUTURE_KICKOFF` hardcode 2030（2030-07-17 後先會出事；下次郁個檔順手改 `Date.now()` 相對）。
  - ~~`stakeDisplay.test.ts:13-14` 混淆註解~~ ✅ v1.2.0 已更正；`FreshnessBar` 用 `Math.round` 計分鐘（90s → 「2 分鐘前」）；`helpers.ts` 註解仲講「一律行 pro」（已 option 化，註解過時）。
- **Today-first Phase B deferred minors（v1.1.1 新增；v1.2.0 已清咗一部分）**：
  - `matchDetails.test.ts` factory 用 `as HandicapCard["bestSide"]` 假 cast「大」（type lie，測試專用）；totals/corners header fallback 路徑冇直接單測。
  - `match.css`：`.market-detail-card__selection` 冗餘 color rule；hardcode `padding: 16px`（tokens 冇 spacing token）。
  - Picker link 冇垂直置中（cosmetic）；`leagueZh ?? league` 靠 operator precedence（plan verbatim）。
  - ~~`App.tsx` `clearBacktestResponseState` 遷就簽名 + `marketDisplay.ts` dead exports~~ ✅ v1.2.0 已清（dead exports 刪除；error path 清晒所有 response-owned state）。
  - ~~`tests/ui/dashboard.spec.ts:44` tablet-landscape 間歇 flaky~~ ✅ v1.2.0 已修（one-shot `expectDashboardColumns` 前等齊 2 個 `.dashboard-card`）。
  - ~~舊 analysis 頁 CSS orphan~~ ✅ v1.2.0 已刪 ~160 行。
  - `MarketDetailCard` stake 為 0 照出「建議注碼 $0」（plan-mandated，同 PickCard 一致）。
  - HDC interval gate 受 `analysisTab` 白名單限制 — 已查證永不 block，非問題（記錄用）。
- **Chiikawa UI follow-up 全部清零（v1.0.2 時點）**：
  - ~~`styles.css` 剩 5 個 hex 未 token 化~~ ✅ `53154b4` 已解決（`#DFF5EA` ×3、`#FFFFFF`、`#4A8BC0` 全部轉 tokens）。
  - ~~`mascot-chiikawa-empty.png`（236 KB）可壓縮~~ ✅ `4fb7aa1` 已解決（236 KB → 44 KB，PWA precache 941 → 754 KiB）；舊版喺 Cloudflare edge 有 cache（TTL 14400s，自然過期，無功能影響）。
  - ~~`App.tsx` hardcoded `.sample-warning` 未加 mascot~~ ✅ `e79747a` 已解決（補 `<Mascot pose="momonga-alert" />`）。
  - ~~`--color-primary` 文字色對比唔達標~~ ✅ `ec24f06` 已解決（`--color-primary-text: #2E6DA4`，5.19:1）；~~Baloo 2 得個名~~ ✅ `58ff5b9` 已 self-host；~~錯誤提示冇 mascot~~ ✅ `83cd086` 已補 `momonga-alert`（歷史記錄見 chiikawa handoff §7）。

### 11.3 歷史 bug 教訓（已修，唔好 reintroduce）

1. `odds_app` 漏 sequence USAGE → `create-roles.sh` 有 `ALTER DEFAULT PRIVILEGES … ON SEQUENCES`。
2. collector 降權後 EACCES → Dockerfile 預建 `/app/data`、`/app/public` 兼 chown。
3. api image 漏 `src/`（Vite SSR loader 要用）→ Dockerfile 有 `COPY src/ src/`。
4. `liveOddsIdentity` 漏 bookmaker → 多莊家撞 unique key。
5. Cloudflare 快取舊 `sw.js` → Caddy no-cache headers + Purge Everything。
6. **Stale service worker client**：舊 client 一早裝咗 HTTP-cacheable 舊 `sw.js`，之後 Caddy 派 no-cache 都救唔到佢（SW 已攔截 fetch）。解法係喺嗰個 client DevTools → Application → unregister SW + `caches.delete()` 一次，之後新 no-cache header 先保得住佢。部署後驗證 UI 要用乾淨 browser profile 或 hard refresh。
7. **新頁面唔喺 auto-load gate**（v1.1.1）：live odds auto-load（one-shot + HDC interval）原本只 gate today/fixtures 頁，cold visit analysis 頁永遠冇數據 — e2e 先捉到。之後加新頁面，check 數據 auto-load gate 有冇包佢。（v1.2.0 history 頁都入埋 gate，等 pending 行 join 到隊名。）
8. **Playwright spec 隱性模式依賴**（v1.0.2）：dashboard spec 斷言「專業」模式 DOM 但產品預設係「極簡」，之前靠測試順序/localStorage 殘留僥倖過，UI 改造郁咗渲染路徑就成批 fail。修法係 `mockApi` 加 `page.addInitScript` 顯式寫 `"pro"`（見 §8.2）— 之後測試環境嘅模式假設要顯式，唔好靠順序。
9. **豐富 e2e mock 會暴露隱性 race**（v1.2.0）：`/api/v1/backtest` mock 由空陣列變有數據後，tablet responsive-nav test 出現 page-transition race — 加咗一行 settle-wait 先穩定。改 mock 數據量時留意有冇 test 靠「冇數據所以即刻 render」僥倖過。

---

## 12. 版本歷史（handoff 鏈）

| 日期 | 文件 | 內容 |
|---|---|---|
| 2026-07-16 | `CODEX-HANDOFF-2026-07-16.md` | 早期模型／backtest 基礎 |
| 2026-07-18 | `CODEX-HANDOFF-2026-07-18.md` | Phase 1：auth、Postgres schema、PWA、snapshot trust policy |
| 2026-07-19 | `KIMI-HANDOFF-2026-07-19.md` | Phase 2：VM 部署上線 + 4 個 bug fix + 中文化 UI |
| 2026-07-19 | `HANDOFF-2026-07-19-simple-dashboard-mode.md` | Dashboard 極簡/專業雙模式 |
| 2026-07-19 | `MASTER-HANDOFF-v1.0.0.md` | v1.0.0 master handoff（首個 master 版本） |
| 2026-07-20/21 | `HANDOFF-2026-07-21-team-logos.md` | 球隊 logo feature + 每日自動 deploy + stale SW 事故教訓 |
| 2026-07-21 | `MASTER-HANDOFF-v1.0.1.md` | v1.0.1 master handoff（整合 team logos） |
| 2026-07-21 | `HANDOFF-2026-07-21-chiikawa-ui-refresh.md` | Chiikawa UI 改造 + Playwright 修復 + 收尾 commits（對比度／alert mascot／webfont） |
| 2026-07-21 | `MASTER-HANDOFF-v1.0.2.md` | v1.0.2 master handoff（整合 Chiikawa UI refresh，已部署 production） |
| 2026-07-21 | `HANDOFF-2026-07-21-today-first-ui-phase-a.md` | Today-first UI Phase A（今日首頁）+ SDD 13 task + 部署 |
| 2026-07-21 | `MASTER-HANDOFF-v1.1.0.md` | v1.1.0 master handoff（整合 Today-first Phase A，已部署 production） |
| 2026-07-21 | `HANDOFF-2026-07-21-today-first-ui-phase-b.md` | Today-first UI Phase B（單場分析頁）+ SDD 8 task + 部署 |
| 2026-07-21 | `MASTER-HANDOFF-v1.1.1.md` | v1.1.1 master handoff（整合 Today-first Phase B，已部署 production） |
| 2026-07-22 | `HANDOFF-2026-07-22-today-first-ui-phase-c.md` | Today-first UI Phase C（賽程＋紀錄執整 + cleanup）+ merged master + **已部署**（bundle `index-jmHUUAaH.js`） |
| 2026-07-22 | **本文件** | v1.2.0 master handoff（整合 Today-first Phase C，merged master，部署待定） |
| 2026-07-22 | `HANDOFF-2026-07-22-post-kickoff-gate.md` | 開賽後買盤 gate（commits `55e931b` + `9504963`，兩次部署，bundle `index-BQuUTJ1Q.js`） |

Git：base `645f22a chore: initial import`（2026-07-19 repo 重建）→ dashboard mode commits → v1.0.0 tag → team logos commits → `d4f835e` → v1.0.1 tag（`58e6aa8`）→ Chiikawa UI refresh commits（`8545216` spec → `d47f087` plan → `adb1f7a`…`d280bf9` 實施 → `9e28452` Playwright 修復 → `bca41d0` handoff → 收尾 `ec24f06` / `83cd086` / `58ff5b9` / `04d3707`）→ 第一次 production deploy（bundle `index-CLj0yK_X.js`）→ v1.0.2 tag（`12effe1`）→ `489e1dc` 標記已部署 → 第二輪收尾 `e79747a` / `4fb7aa1` / `53154b4` → 第二次 production deploy（2026-07-21 下午，bundle `index-DJb2OR6G.js`，備份 `pre-deploy-20260721-055126.dump`）→ v1.1.0：spec `8c2fb71` → plan `5b2ab7b` → branch `today-first-phase-a` 13 commits（`4684a69`…`e837c02`）→ ff merge master → production deploy（bundle `index-BYUf2jMY.js`，備份 `pre-deploy-20260721-093231.dump`）→ v1.1.0 tag → v1.1.1：plan `f37ffd5` → branch `today-first-phase-b` 7 commits（`5a1dff3`…`b03ac8f`）→ ff merge master → production deploy（bundle `index-BW9hE076.js`，備份 `pre-deploy-20260721-122827.dump`）→ v1.1.1 tag → v1.2.0：branch 8 commits（`b9e943c`…`ed0c8ed`）→ ff merge master → v1.2.0 tag → production deploy（2026-07-22 凌晨，api + caddy，bundle `index-jmHUUAaH.js`，備份 `pre-deploy-20260721-165125.dump`）→ post-kickoff gate：`55e931b` → production deploy（bundle `index-Cp7i2YwH.js`，備份 `pre-deploy-20260721-182949.dump`）→ `9504963` → production deploy（bundle `index-BQuUTJ1Q.js`，備份 `pre-deploy-20260721-183954.dump`）。

---

## 13. 快速指令 cheat sheet

```bash
# === 本機開發 ===
node node_modules/vitest/vitest.mjs run                 # 前端測試
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/vite/bin/vite.js build
npm run server:self-test                                # server 自測
node scripts/hdc-collector.mjs --self-test              # collector 自測（唔蝕 quota）
npm run check:data                                      # file-mode integrity
node scripts/build-team-logos.mjs --max-calls 85        # 球隊 logo 續跑（蝕 API-Football quota，daily budget 內先好跑）
npm.cmd run test:ui:only                                # Playwright（PowerShell 嘅 npm.cmd）
grep -nE '#[0-9A-Fa-f]{3,8}' src/styles.css             # 查剩餘 hardcoded hex

# === DB（disposable only）===
npm run db:migrate
npm run db:import:legacy -- --source-root .             # ⚠️ 一定要 --source-root .
npm run db:check:parity -- --source-root .
node scripts/check-data-integrity.mjs --database

# === VM ===
ssh -i ~/.ssh/astra_vm_ed25519 -p 169 hugo@118.140.60.206
cd /opt/odds-tool                                       # compose 前必做
sudo -A docker compose config --quiet
sudo -A docker compose build caddy                      # 前端改動
sudo -A docker compose build api                        # server/collector 改動（v1.2.0 兩邊都要）
sudo -A docker compose up -d --no-deps <service>
sudo -A docker compose logs --tail=100 <service>
sudo -A docker exec odds-tool-postgres-1 pg_dump -U postgres -d odds -Fc > /opt/odds-tool/backups/odds-$(date +%F).dump
```

---

*文件完。維護方式：每次重大改動完成後更新對應章節；每個 phase 完成後寫新 dated handoff 並喺 §12 加一行；master 文件版本跟 package.json + git tag 三件套一齊升。*
