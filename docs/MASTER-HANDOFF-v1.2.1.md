# MASTER HANDOFF — odds-tool v1.2.1

> **俾接手 AI / 開發者：呢份文件係唯一入口。讀完呢份 + 按 §1.2 順序掃過引用文件，你應該可以完全 pickup 成個系統。**
> 版本：v1.2.1（git tag `v1.2.1`，package.json version `1.2.1`）
> 日期：2026-07-23
> 語言：本 repo 所有交接文件用廣東話書寫，程式碼註解用英文。
> v1.2.1 變更（三個 commits，全部已部署 production）：
> 1. **白屏事故修復**（`8eb1f8c`）— flat live-odds 數據令 render 期間掟 error，成個 React tree unmount 變白屏；新增 `normalizeLiveOddsPayload` + 修 `hasCompleteOdds` 漏洞 + 加 `ErrorBoundary`。
> 2. **Deploy script 修正**（`eb04770`）— `git fetch origin master` 唔會更新 `origin/master` ref，導致頭一次部署拎咗舊 code 上線。
> 3. **Chiikawa UX redesign 遺留修復**（`3e93935`）— 今日頁永遠「暫無推薦」（`FOCUS_MARKETS` 漏咗 h2h）、feed 失敗警示邏輯、401 唔跳登入；成個 Playwright UI suite 重寫返綠（18 failed → 19/19）。
> 同日亦將 **Chiikawa UX redesign**（merge `a7be682` + `2f25bbe` + wallpaper 修正 `b5e7728`）正式部署上線。

---

## 0. 一句講晒

**odds-tool 係一個足球賠率價值分析 PWA，已正式上線生產：`https://odds.ballballchu.com.hk`。** React 19 + TS 前端（**Chiikawa pastel 主題 + 三頁結構：今日／賽程／表現**，v1.2.1）、raw `node:http` API、PostgreSQL 18、Cloudflare Tunnel 對外、兩個 collector 自動運行緊。單一 owner 登入。四個投注模型凍結喺 3% edge 門檻。

⚠️ Production 行緊 v1.2.1（commit `3e93935`，bundle `index-DGoiiUhh.js`，2026-07-23 晚部署）。**而家有 GitHub remote**：`https://github.com/s20031521-ai/odds.git`（v1.2.0 文件講「冇 remote」已過時；VM 係 `git fetch origin && git reset --hard origin/master` 拉代碼再 Docker build）。

專案位置：`C:\Users\itadmin\Documents\賭`（Windows 本機）。

---

## 1. 上手路線圖

### 1.1 快速健康檢查

```bash
# 公開端點
curl -s -o /dev/null -w "%{http_code}\n" https://odds.ballballchu.com.hk/                    # 200
curl -s -o /dev/null -w "%{http_code}\n" https://odds.ballballchu.com.hk/api/v1/results     # 401
curl -s https://odds.ballballchu.com.hk/ | grep -o 'assets/index-[^"]*\.js'                # 應係現行 bundle（v1.2.1: index-DGoiiUhh.js）

# 白屏檢查（唔係淨睇 HTTP 200）：bundle 有冇 ErrorBoundary 字串
curl -s https://odds.ballballchu.com.hk/assets/index-DGoiiUhh.js | grep -c "頁面載入時出咗問題"   # >=1
```

### 1.2 文件閱讀順序

| 順序 | 文件 | 用途 |
|---|---|---|
| 1 | 本文件 | v1.2.1 全局 + 白屏事故完整記錄 |
| 2 | `docs/MASTER-HANDOFF-v1.2.0.md` | 系統架構、auth/安全、DB schema、模型紅線、VM 操作細節（**呢啲 v1.2.1 冇變，唔重複**） |
| 3 | `docs/HANDOFF-2026-07-23-unified-buyable-v1-deploy.md` | 統一採樣系統（flat live-odds 格式嘅來源） |
| 4 | `docs/runbooks/production-deployment.md` | 部署／rollback playbook |

---

## 2. v1.2.1 事故同修復全記錄（本版核心）

### 2.1 白屏事故（2026-07-23 下晝發現）

**症狀**：owner 開 `https://odds.ballballchu.com.hk/` 全頁空白。Fresh browser（無頭）冇事，owner 嘅 browser 先中。

**Root cause 鏈**：

1. Collector 改用 Postgres 之後（unified-buyable-v1 cutover），`GET /api/v1/odds/live` 回傳嘅係 **flat per-selection rows**——每個盤口每個結果一行，`odds` 係 scalar（例：`{id:"hkjc-50071591:home", market:"h2h", selection:"home", odds:3.85}`）。格式定義喺 `scripts/hkjc-import.mjs flattenHkjcLive` 同 `scripts/hdc-collector.mjs flattenSportEntries`。
2. 前端仲預期 nested `{home,draw,away}`。scalar 行入到 `analyzeEntries`：`Object.keys(3.85)` 係空陣列 → `every()` 真空返 `true` → 繞過 `hasCompleteOdds` → `overround()` render 期間掟 `Decimal odds must be greater than 1.`
3. 冇 ErrorBoundary → React 成棵樹 unmount → `#root` 全空 → 白屏。
4. 用戶 browser 嘅 **stale service worker** 仲 serve 緊更舊嘅 bundle（`index-BYtYrZms.js`），令表象更撲朔迷離。

**診斷手法**（值得記低）：kimi-webbridge 喺用戶真實瀏覽器 reproduce（`#root` 零 children）→ `evaluate` 裝 `window.onerror` listener 再動態 `import()` 同一個 bundle → 捕捉到完整 error message。新鮮 browser 冇 SW 所以唔中 — PWA app 嘅 bug 一定要喺「有 SW 嘅真實 browser」重現。

**修復**（commit `8eb1f8c`）：

| 改動 | 檔案 | 講咩 |
|---|---|---|
| 新增 normalizer | `src/liveOddsMapping.ts` | `normalizeLiveOddsPayload`：flat rows 重組做 UI 嘅 h2h/totals/corners/spreads 巢狀格式；殘缺組合（得 home 冇 draw 之類）直接掉棄。**呢個正係 `_skipped_tests/liveOddsMapping.test.ts` 一早設計好但從未實作嘅嘢**（`hdc-collector.mjs` 嘅註解都寫明 frontend 要有佢） |
| 接線 | `src/App.tsx refreshHdcOdds` | API response 先經 normalizer 先入 state |
| 補漏洞 | `src/odds.ts hasCompleteOdds` | 改為明確檢查 `home/draw/away` 三個 key，唔再 `Object.keys` |
| 兜底 | `src/components/ErrorBoundary.tsx`（新）+ `src/main.tsx` | 將來任何 render error 顯示「頁面載入時出咗問題，請重新整理」而唔係白屏 |
| 移除 legacy | `src/App.tsx` | 刪 `loadHkjcOdds`（`/hkjc-odds.json` 靜態檔 fetch，redesign 加返嘅）；HKJC 數據本來就經統一 API 返嚟 |

**教訓**：API contract 改動（collector flat 化）冇同步前端 consumer；`_skipped_tests` 入面嘅 spec 係未完成工作嘅文件，唔好當死檔。

### 2.2 Deploy script bug（commit `eb04770`）

`deploy/deploy-chiikawa-ux.sh` Step 1 原本係 `git fetch origin master` — 呢個**只更新 FETCH_HEAD，唔更新 `origin/master` 個 remote-tracking ref**，所以之後 `git reset --hard origin/master` 仲係舊 commit，Docker build cache 出舊 bundle 上線（白屏修復第一次部署因此冇生效）。已改做 `git fetch origin`。另外 VM repo 有 root-owned objects（之前 sudo 操作遺留）會令 `git fetch` 爆 `insufficient permission` — 要 `sudo chown -R hugo:hugo /opt/odds-tool/build` 先。

### 2.3 Redesign 遺留 bug + UI suite（commit `3e93935`）

Chiikawa UX redesign（`2f25bbe`）改咗 UI 但**一個測試檔都冇更新**，仲引入三個真 bug：

1. **「暫無推薦」假象**：`TodayPage` 嘅 `FOCUS_MARKETS = {totals, corners, handicap}` filter 漏咗 `h2h` — 主客和推薦（unified 系統主要輸出）永遠唔會喺今日頁出現。已刪 filter。
2. **Feed 失敗邏輯**：`dataFresh` gating 將兩種失敗撈埋 — 而家回復設計原意：live-odds feed 壞 → 顯示警示但**保留**已記錄推薦；recommendations feed 壞 → 先 fail closed 收埋。
3. **401 被 swallow**：protected API 回 401（session 過期）時 app 唔會跳返登入頁。已喺 `refreshHdcOdds` + `loadBacktest` 補 `clearAuthenticatedState()`。

**UI suite 修復**：原本 18 failed / 4 passed（三個 spec 全部過時）。逐個測試判斷：selector 過時 → 按原意改寫；功能已被取代 → 改寫驗證新行為；app bug → 修 app 唔改測試。而家 **desktop 19/19 全綠**。`tests/ui/helpers.ts` 嘅 readiness mock keys 由中文市場名改做 server 嘅 canonical English keys（`totals`/`corners`/`handicap`/`h2h`，跟 `server/domain/backtest.mjs`）。`#/analysis`、`#/history` 等 legacy hash 會安全著陸落今日頁（`pageFromHash` 兜底的 `today`）。

---

## 3. 系統現況（v1.2.1 基線）

| 項目 | 狀態 |
|---|---|
| 網站 | `https://odds.ballballchu.com.hk`（200，PWA） |
| 現行 build | commit `3e93935`，bundle `index-DGoiiUhh.js`（2026-07-23 晚部署） |
| Git remote | `https://github.com/s20031521-ai/odds.git`（master；VM 經 fetch+reset 同步） |
| Stack | postgres / api / caddy / cloudflared / collector 五 container（冇變） |
| UI 結構 | **三頁**：`#/today`（今日：推薦 picks + 即將開賽）/ `#/fixtures`（賽程）/ `#/performance`（表現：四模型 readiness 卡 X/30）；底部 3-tab 導航；`#/dashboard`/`#/analysis`/`#/history` 等舊 hash 兜底落 today。**simple/pro 雙模式已取消**（`dashboardMode.ts` localStorage 變成無效遺物） |
| 測試 | **Vitest 34 files 212/212**；`tsc --noEmit` 0 errors；**Playwright desktop 19/19**（dashboard/today/analysis 三個 spec；其餘 viewport 未逐個跑） |
| API 數據格式 | `/api/v1/odds/live` 回 flat per-selection rows（scalar odds + market + selection + line）；前端經 `normalizeLiveOddsPayload` 重組，**任何新 consumer 都要用呢個 normalizer** |
| 模型 | 四模型凍結 3% edge、30 場門檻（同 v1.2.0，冇郁） |

### 3.1 今日部署時間線（2026-07-23，四次 caddy 部署）

| 時間（約） | Bundle | 內容 |
|---|---|---|
| 14:49 | `index-CHq65MhX.js` | Chiikawa redesign 首次上線（其後證實帶白屏隱患） |
| ~18:25 | `index-BYtYrZms.js` | ⚠️ deploy script bug 拎咗舊 commit `b5e7728` 上線（白屏修復未生效） |
| ~18:50 | `index-BmnOb5bQ.js` | 修正後部署 `8eb1f8c`（白屏修復生效，用戶 browser SW autoUpdate 自愈確認） |
| ~22:35 | `index-DGoiiUhh.js` | 部署 `3e93935`（h2h 推薦 + UI suite 修復，**現行**） |

api image 今日冇改動（全部係前端／測試／script 改動），所以每次只 rebuild caddy。

---

## 4. 程式碼地圖（v1.2.1 變動；其餘見 v1.2.0 文件 §5）

### 4.1 新增

- `src/liveOddsMapping.ts` — flat live-odds normalizer（§2.1）；測試 `src/liveOddsMapping.test.ts`（6 cases：四市場重組、malformed 掉棄、多線分組、league/中文名 threading、legacy nested passthrough、空 payload）。
- `src/components/ErrorBoundary.tsx` — class component，`getDerivedStateFromError` + fallback UI（Mascot + 重新整理按鈕）；`componentDidCatch` log 去 console。

### 4.2 修改

- `src/App.tsx` — `refreshHdcOdds` 經 normalizer；刪 `loadHkjcOdds` + `hkjcAutoLoadStarted`（統一 feed 成功時 hkjc/hdc 兩個 dataLoad leg 一齊標 true）；401 → `clearAuthenticatedState()`；`dataFresh` state 刪除，`LandingPage` 嘅 `dataFresh={recommendationsTrusted}`。
- `src/odds.ts` — `hasCompleteOdds` 明確三 key 檢查。
- `src/pages/TodayPage.tsx` — 刪 `FOCUS_MARKETS` filter。
- `src/main.tsx` — `ErrorBoundary` 包住 `<App />`。
- `deploy/deploy-chiikawa-ux.sh` — `git fetch origin`（§2.2）。
- `tests/ui/` — dashboard/today/analysis 三個 spec + helpers 全重寫（§2.3）。

### 4.3 Dead code（可清，未清）

`src/pages/DashboardPage.tsx`、`BuyDashboard.tsx`、`MatchAnalysisPage.tsx`、`AllFixtures.tsx`、`src/dashboardMode.ts` 仲喺 tree 但 `App.tsx` 冇 route 用佢哋。注意：v1.2.0 紅線「`BuyDashboard.tsx` 唔准改」依然適用——佢而家係 unrouted，刪除要先問 owner。

### 4.4 `_skipped_tests/`

`liveOddsMapping.test.ts` 嘅設計已喺 v1.2.1 實現（正式測試喺 `src/liveOddsMapping.test.ts`），`_skipped_tests` 成個目錄可以考慮清走。

---

## 5. 部署（v1.2.1 更新；完整流程見 v1.2.0 文件 §9 + runbook）

### 5.1 標準部署（而家有 remote 之後）

```bash
# 本機：push 上 GitHub
git push origin master

# VM：拉代碼 + rebuild（用 deploy/deploy-chiikawa-ux.sh 或手動）
ssh -i ~/.ssh/astra_vm_ed25519 -p 169 hugo@118.140.60.206
cd /opt/odds-tool/build && git fetch origin && git reset --hard origin/master
# askpass 設好之後（見 v1.2.0 §9.1）：
cd /opt/odds-tool/build
sudo -A docker compose build caddy        # 前端改動
sudo -A docker compose build api          # server/collector 改動先要
sudo -A docker compose up -d caddy
```

⚠️ 部署後驗證**唔好淨 curl HTTP 200**：要 check bundle hash 係新嘅 + grep 新代碼特徵字串（§1.1），因為 Docker layer cache / git ref 問題可以靜默 deploy 舊 code（今日實測中伏，見 §2.2）。

### 5.2 PWA / Service Worker 注意

- `registerType: "autoUpdate"`：新版 SW 安裝後會自動 skipWaiting + reload，正常 deploy 用戶會自愈（今日已驗證）。
- 但 deploy 之間用戶可能短暫行緊舊 SW cache 嘅舊 bundle；重大修復後可以喺用戶 browser 用 `navigator.serviceWorker.getRegistrations()` → `registration.update()` 催谷。
- 極端情況（SW 完全卡住）：DevTools → Application → unregister SW + `caches.delete()`（v1.2.0 §11.3 #6）。

---

## 6. 已知問題（v1.2.1 時點新增；v1.2.0 清單仍然適用）

1. **CSP 阻擋 Google Fonts**：`style-src 'self' 'unsafe-inline'` 擋咗 `index.html` 入面嘅 Nunito webfont（console error，cosmetic，fallback 字體頂上）。 redesign 引入；要么 self-host Nunito（跟 Baloo 2 做法），要么闊 CSP。
2. **Dead code 未清**：§4.3 四個 unrouted page + `dashboardMode.ts`。
3. **`#/dashboard` alias 註解過時**：v1.2.0 文件講 `pageFromHash` alias 落 today — 而家係**所有**唔認得嘅 hash 都落 today（包括 `#/analysis`、`#/history`），行為一樣但更闊。
4. **「暫無推薦」而家係真實狀態**：`FOCUS_MARKETS` 修復後，今日頁顯示「暫無推薦」即係 API 真係 0 個 active opportunities（2026-07-23 晚實測 `/api/v1/recommendations/current` count=0）。
5. **8 個 redesign 遺留 UI 測試已修**，但 Playwright 只跑咗 desktop project；tablet/phone viewport 未驗證（`npm run test:ui:only` 會跑齊 4 projects）。
6. **白屏類事故防禦**：`ErrorBoundary` 已兜底；但如果 `main.tsx` 本身或 ErrorBoundary 上面嘅層炸，仲係會白 — 長遠可以考慮喺 `index.html` 加 noscript-style 靜態 fallback 或 SW 層健康檢查。

---

## 7. 版本歷史（接 v1.2.0 文件 §12）

| 日期 | 文件 | 內容 |
|---|---|---|
| 2026-07-22 | `MASTER-HANDOFF-v1.2.0.md` | v1.2.0（Today-first Phase C） |
| 2026-07-23 | `HANDOFF-2026-07-23-unified-buyable-v1-deploy.md` | 統一採樣系統部署記錄 |
| 2026-07-23 | **本文件** | v1.2.1（白屏修復 + redesign 遺留修復 + UI suite 返綠，已部署） |

Git：v1.2.0 → unified-buyable-v1 commits → Chiikawa redesign merge `a7be682`（`2f25bbe` + deploy script `d5f3c10` + wallpaper 修正 `b5e7728`）→ `8eb1f8c` 白屏修復 → `eb04770` deploy script 修正 → `3e93935` h2h 推薦 + UI suite 修復 → 部署（bundle `index-DGoiiUhh.js`）→ **v1.2.1**。

---

*文件完。維護方式：每次重大改動完成後更新對應章節；每個 phase 完成後寫新 dated handoff；master 文件版本跟 package.json + git tag 三件套一齊升。*
