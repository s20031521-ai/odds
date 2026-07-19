# Handoff — 極簡 / 專業雙模式 Dashboard(2026-07-19)

## 0. 一句狀態

`#/dashboard` 而家有「極簡 | 專業」雙模式:極簡(預設)每張卡一場波、直接列晒嗰場所有過關投注項目;專業係原本嘅完整畫面(`BuyDashboard` 一個字冇改過)。已 merge 落 `master`,並已 deploy 上 production(https://odds.ballballchu.com.hk),smoke checks 全綠。

專案位置:`C:\Users\itadmin\Documents\賭`(git repo 今次重建咗,見 §6)。

---

## 1. 今次改動範圍

| Commit | 內容 |
|---|---|
| `3d8480c` | `feat: add dashboard mode storage helpers` — 新 `src/dashboardMode.ts` |
| `e20e54b` | `feat: add minimal simple dashboard view` — 新 `src/pages/SimpleDashboard.tsx` + CSS |
| `75a4c84` | `feat: add simple/pro mode toggle wrapper` — 新 `src/pages/DashboardPage.tsx` + toggle CSS |
| `4e4cf0d` | `feat: route dashboard through simple/pro mode page` — `src/App.tsx` 兩行改動 + `App.test.tsx` 兩個 wiring assertion 更新 |
| `68bd536` | `chore: sdd progress ledger for simple-dashboard-mode` — 過程記錄 |

Base:`645f22a chore: initial import`(今次重建 git repo 嘅首次 commit)。Merge 係 fast-forward,feature branch `feature/simple-dashboard-mode` 已刪。

相關文件:

- Spec:`docs/superpowers/specs/2026-07-19-simple-dashboard-mode-design.md`
- Plan:`docs/superpowers/plans/2026-07-19-simple-dashboard-mode.md`
- SDD 過程(ledger、各 task brief/report、review diff):`.superpowers/sdd/`

---

## 2. 新架構

```text
App.tsx (#/dashboard)
  └─ DashboardPage          ← mode state + toggle(新)
       ├─ SimpleDashboard   ← 極簡 view(新)
       └─ BuyDashboard      ← 專業 view(原有,完全冇改)

dashboardMode.ts            ← localStorage 讀寫純函數(新)
```

### 2.1 `src/dashboardMode.ts`

- `readDashboardMode(storage?: StorageLike): DashboardMode` / `writeDashboardMode(mode, storage?)`。
- Key 係 `dashboard-mode`;值 `"simple" | "pro"`;任何無效值、讀寫失敗(私隱模式等)一律 fallback 去 `"simple"`。
- `StorageLike` 注入係跟 `src/predictionSnapshots.ts` 嘅 pattern,因為 vitest 行 node 冇 localStorage。

### 2.2 `src/pages/SimpleDashboard.tsx`

- 每張卡:聯賽 + 開賽時間(細字)→ 隊名(大字)→ 分隔線 → 每行一個過關盤「市場 · 選項 + 賠率」。
- `primary` + `alternatives` 全部列出(全部都係過咗 3% edge 嘅盤):3 個過關 3 行,1 個 1 行,唔過關嘅場次唔會出現。
- 冇 KPI、冇市場篩選、冇莊家/機會率/Edge — 呢啲只喺專業 mode。
- 空狀態:「暫時冇場次過關」(冇「查看全部賽事」連結);stale:「資料未更新，暫停顯示買盤。」(同 BuyDashboard 一致)。
- 撳卡照舊去 `#/fixtures/:matchId`;排序跟 `opportunities` 陣列原次序。
- 入面嘅 `formatSelection` / `formatOdds` / `formatDate` / `pickKey` 係**有意重複** BuyDashboard 嗰份(owner 批准,因為 BuyDashboard 唔准改);注意 `formatLine` 同 BuyDashboard 已經唔同:極簡版唔加 `+` 前綴(跟返 owner approve 嘅 mockup,例如 `大 2.5` 唔係 `+2.5`)。

### 2.3 `src/pages/DashboardPage.tsx`

- 「極簡 | 專業」toggle 擺喺 view 上面一條右齊欄(`.dashboard-mode-bar`),`aria-pressed` + `role="group"`。
- 預設極簡;撳制即時切換 + 寫 localStorage;任何狀態(包括 stale)都撳得。
- `storage?: StorageLike` prop 係 dependency injection,browser 唔傳就用 localStorage。

### 2.4 `src/App.tsx`

- 只改兩行:import(`BuyDashboard` → `DashboardPage`)同 `#/dashboard` 渲染行,props 不變(`opportunities` / `generatedAt` / `dataFresh`)。

### 2.5 CSS

- `src/styles/dashboard.css` 純 append:`.simple-dashboard*`、`.simple-card*`、`.dashboard-mode-bar*`;現有 rules 一字未郁。全部用 `tokens.css` 嘅 CSS variables。

---

## 3. 安全規矩(冇郁過)

- 3% edge 門檻、`buyOpportunities.ts` 邏輯、collector、API 全部冇改 — 今次純 presentation。
- 「買得過」定義完全沿用現有邏輯。
- `BuyDashboard.tsx` / `BuyDashboard.test.tsx` 零改動(final review 用 `git diff --stat` 驗證過)。

---

## 4. 測試

- 全套:**28 files / 183 tests 全綠**(merge 後喺 master 重行過);`tsc --noEmit` + `vite build` 通過。
- 新測試:`dashboardMode.test.ts`(6)、`SimpleDashboard.test.tsx`(6)、`DashboardPage.test.tsx`(4)。
- `App.test.tsx` 改咗兩個 source-string wiring assertion(`BuyDashboard` → `DashboardPage`),屬 1:1 等價 rewiring,冇放水。
- 已知測試空隙(Minor,review 記錄在案):`DASHBOARD_MODE_STORAGE_KEY` 字面值冇 assertion;toggle 撳制→寫 localStorage 條 path 喺 `renderToStaticMarkup` 環境測唔到(兩個組成函數各自有覆蓋)。

---

## 5. Production deploy 記錄(2026-07-19 ~19:00)

跟 `docs/runbooks/production-deployment.md`,純前端改動所以只重建 caddy:

1. 打包(排除 `.env.local` / `node_modules` / `.git` / `data` 等)scp 上 VM,rsync `--delete` 入 `/opt/odds-tool/build/`。
2. 部署前:`pg_dump` 備份 → `/opt/odds-tool/backups/odds-2026-07-19.dump`;`odds-tool-api` 同 `odds-tool-caddy` image tag 咗做 `:rollback`。
3. `docker compose config --quiet` OK → `docker compose build caddy` → `up -d --no-deps caddy`。
4. Smoke 全綠:caddy healthy;tunnel 4 connections;內部 readiness(api 200 / caddy internal 404 / session 200);公開(root 200 / API 401 / internal 404 / HSTS 有);production JS bundle 搵到 `dashboard-mode` 同「極簡」字樣,確認新 UI 已上線。
5. VM 同本地臨時檔(包括 sudo askpass)已清。

Rollback(如需):照 runbook §4,`docker tag odds-tool-caddy:rollback odds-tool-caddy:latest` 然後 `up -d --no-deps --force-recreate caddy`。

---

## 6. Git repo 重建咗

之前 `.git` 係空目錄(唔係有效 repo)。今次 `git init` 重建,`645f22a chore: initial import` 收錄晒當時成個工作目錄。即係話 **2026-07-19 之前嘅歷史係冇嘅**,舊嘢以 `.hermes/plans/`、`docs/`、`.superpowers/` 嘅文件為準。冇 remote。

---

## 7. 已知 Minor findings(final review 判定唔阻 merge)

1. 設計 mockup 寫「主勝 @ 2.10」,實作用 flex 排版,`@` 冇顯示出嚟(spec 文字同實作小出入)。
2. 極簡版正數讓球線顯示 `0.5` 唔係 `+0.5`(跟 approved mockup;負數線照樣有 `-`)。
3. `formatDate` 用 `toLocaleString()`,顯示跟 runtime locale(同 BuyDashboard 一致)。
4. 極簡空狀態 `<div>` 冇 `role="status"`(stale 嗰個有;同 BuyDashboard pattern 一致)。
5. Spec §Toggle 寫「標題隔籬」,實作係 view 上面一條右齊欄 — spec 文件可以更新返。
6. Helper 重複係已知 drift surface:如果將來准改 BuyDashboard,應該抽 shared formatters module。

## 8. 環境雜項

- 本機 `npx`/`npm` 唔喺 git bash PATH;行測試用 `node node_modules/vitest/vitest.mjs run`,build 用 `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` + `node node_modules/vite/bin/vite.js build`。
- git identity 設咗 repo-local:`itadmin <itadmin@localhost>`。
- VM:`118.140.60.206` SSH port 169 user `hugo`,key `~/.ssh/astra_vm_ed25519`(本機連線正常)。
- sudo 密碼曾喺 chat 出現過 — owner 可自行決定使唔使 rotate。
