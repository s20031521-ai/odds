# Handoff — Chiikawa UI Refresh + Playwright 測試修復(2026-07-21)

> 上一份:[MASTER-HANDOFF-v1.0.1.md](MASTER-HANDOFF-v1.0.1.md)(整合 team logos feature)。
> 呢份覆蓋 2026-07-21 嘅全 app UI 改造:由深色交易台風格轉做 pastel Chiikawa(吉伊卡哇 + 飛鼠 Momonga)主題,以及隨之而嚟嘅 Playwright dashboard spec 修復。**純前端樣式/展示層改動,零數據邏輯改動。**
> 收尾更新:補入 `ec24f06`(primary 文字對比修正)、`83cd086`(錯誤/警告狀態 Momonga mascot)、`58ff5b9`(self-hosted Baloo 2 webfont)三個收尾 commit,相關技術債已標記解決(§7)。

## 1. 背景同目標

Owner 想將成個 app(登入頁、值得買、全部賽事、完場紀錄、模型健康)由深色交易台風格(舊 `--color-bg: #11182b`)轉做**沉浸式輕鬆 Chiikawa 風格**:pastel 色板、大圓角、軟陰影、mascot 插畫 + 廣東話微文案。硬性要求:

- **數據可讀性不妥協** — 賠率數字、表格、升跌標示保持清晰,可愛元素只係裝飾層
- **零邏輯改動** — 只改樣式同加展示元件,現有測試全部照過
- **離線可用** — 零外部資源(唔用 Google Fonts CDN、唔 hotlink 圖)

流程跟 superpowers SDD:設計規格 `docs/superpowers/specs/2026-07-21-chiikawa-ui-refresh-design.md` → 實施計劃 `docs/superpowers/plans/2026-07-21-chiikawa-ui-refresh.md`(698 行,逐 task checkbox)→ 逐 task 實施。

## 2. 改動一覽(master,時間序)

| Commit | 內容 |
|---|---|
| `8545216` | docs: 設計規格 |
| `d47f087` | docs: 實施計劃(10 個 task) |
| `adb1f7a` | `tokens.css` 重寫 pastel 色板;`index.html` theme-color → `#FFF8F0` |
| `e7a86b4` | 新 `Kawaii.tsx`(`Mascot` + `KawaiiDecor`)+ `kawaii.css` + 測試 |
| `0d48a9d` | `public/chiikawa/` 四張素材圖 + README Artwork Assets 註明 |
| `62d05f1` | `styles.css` 全面 pastel sweep(348 行改動) |
| `224d355` | `AppShell` 角落常駐 Chiikawa + nav active 轉 pastel pill |
| `26dadd4` | 登入頁迎接插畫(login-duo)+ boot splash |
| `d280bf9` | loading / 空白狀態掛 mascot + 微文案(App、SimpleDashboard、BuyDashboard) |
| `7981a43` | `dashboard.css` 對比度目測修正 |
| `9e28452` | **Playwright dashboard spec 修復**(見 §5) |
| `bca41d0` | docs: 本 handoff 初版 + playwright spec fix 記錄 |
| `ec24f06` | **Primary 文字色 WCAG AA 修正**:加 `--color-primary-text: #2E6DA4`(對比 2.70:1 → 5.19:1),`styles.css` 5 處文字色換用新 token,`AppShell.test.tsx` 加新 token 斷言 |
| `83cd086` | **錯誤/警告狀態掛 Momonga mascot**:`Kawaii.tsx` 加 `momonga-alert` pose(40×40 icon 級),覆蓋 `App.tsx` 兩個 `role="alert"` 錯誤區塊 + 兩處 qualityWarning + `AppShell` dataWarning + `LoginPage` login-error |
| `58ff5b9` | **Self-hosted Baloo 2 webfont**:`public/fonts/baloo-2-var.woff2`(177 KB variable 400–800,SIL OFL)+ `styles.css` 頂部 `@font-face`,PWA precache 已包 |

## 3. 檔案地圖

**新檔:**

| Path | 用途 |
|---|---|
| `src/components/Kawaii.tsx` | `<Mascot pose="chiikawa-corner\|chiikawa-empty\|momonga-loading\|momonga-alert\|login-duo" />` + `<KawaiiDecor />`(CSS 花瓣/星星裝飾,`aria-hidden`);`momonga-alert`(`83cd086` 加)係 40×40 icon 級,重用 momonga-loading 圖 |
| `src/components/Kawaii.test.tsx` | Mascot/decor SSR 測試 |
| `src/styles/kawaii.css` | mascot 四個 pose 嘅定位/尺寸(corner 係 fixed 右下角常駐,mobile 縮細)+ decor 動效;`main.tsx` import |
| `public/chiikawa/` | 4 張 PNG:`mascot-chiikawa-corner.png`(79 KB)、`mascot-chiikawa-empty.png`(236 KB)、`mascot-login-duo.png`(137 KB)、`mascot-momonga-loading.png`(45 KB) |
| `public/fonts/baloo-2-var.woff2` | Self-hosted Baloo 2 variable webfont(177 KB,weight 400–800,SIL OFL),`styles.css` 頂部 `@font-face` 引入,PWA precache 已包(`58ff5b9`) |

**大改:**

| Path | 改咗咩 |
|---|---|
| `src/styles/tokens.css` | 成個色板重寫(見 §4.1)。新增 `--color-positive-text` / `--color-negative-text` / `--color-border` / `--shadow-soft` / `--radius-card-lg` / `--font-rounded`;`--radius-card` 16→24px;`--touch-target` 保持 44px(plan 紅線) |
| `src/styles.css` | Pastel sweep:約 118 個 hardcoded hex 換做 tokens / 新 pastel 值,commit 改動 348 行 |
| `src/styles/layout.css` | Nav active 狀態轉 pastel pill(primary 底白字圓角) |
| `src/styles/dashboard.css` | 淺色底下嘅對比度修正(邊框、tag 底色) |
| `index.html` | `theme-color` meta → `#FFF8F0`(`pwaConfig.test.ts` 斷言同步更新) |
| `src/App.tsx` / `LoginPage.tsx` / `AppShell.tsx` / `SimpleDashboard.tsx` / `BuyDashboard.tsx` | 掛 Mascot / KawaiiDecor;loading、空白、boot splash 狀態加插畫同微文案 |

## 4. 設計決策(點解咁做)

### 4.1 最終色板(`tokens.css`)

奶油白底 `#FFF8F0`、暖白卡片 `#FFFEFC`、奶藍 primary `#5E9FD4`、淡粉 `#FFD9E0`、淡黃 `#FFF1C9`、薄荷綠 positive `#7FCFA9`、蜜桃粉 negative `#F2A0A0`、蜜糖黃 warning `#E8B45A`、深可可文字 `#4A3F3F`(唔用死黑)、灰杏 muted `#A89B91`。

- **Primary 同 spec 唔同**:spec 寫 `#8FC1E9`,實施時目測太淺,落做 `#5E9FD4`。
- **升跌文字另開 token**:pastel 嘅 `--color-positive`/`--color-negative` 做底色可以,做文字色對比唔夠,所以加咗 `--color-positive-text: #2F7D5F` 同 `--color-negative-text: #C05A5A` 專俾文字用。**呢個模式值得記住 — primary 後嚟喺 `ec24f06` 照做咗同一處理(`--color-primary-text: #2E6DA4`,對比 2.70:1 → 5.19:1),見 §7.1。**
- **字體**:用本地 font stack(`"Baloo 2", "PingFang TC", "Microsoft JhengHei", sans-serif`)。初版**唔係**真係 load Baloo 2(離線紅線下唔可以用 Google Fonts CDN);收尾 `58ff5b9` self-host 咗 variable webfont(`public/fonts/baloo-2-var.woff2` + `@font-face`),真 Baloo 2 而家離線可用,系統圓體降格做 fallback。

### 4.2 計劃紅線(實施時遵守咗,後續改 UI 都要守)

- **鎖死字串唔准改**:一堆 SSR/source-contract 測試逐字斷言(`載入中...`、`暫時冇場次過關`、`資料未更新，暫停顯示買盤。`、LoginPage 錯誤訊息等,完整清單喺 plan 嘅 Global Constraints)。加裝飾元素得,改字串唔得。
- **className 唔准改名**:現有測試斷言 class(`buy-dashboard__empty`、`login-panel`、`app-navigation--top/--bottom`、`empty-state`、`team-logo--badge` 等),只加新 class。
- **幾何唔准變**:`--touch-target` 44px、dashboard grid 列數、nav breakpoints(Playwright 斷言)。
- `BuyDashboard.tsx` 嘅「唔准改」紅線(master handoff §10)今次有**有限度豁免**:只加咗一個 Mascot/微文案展示元素,冇郁邏輯。

### 4.3 素材版權

圖下載自 chiikawa-wallpaper.com(標明免費、僅供個人用途)。本項目係本地個人工具屬個人用途,但**圖唔可以隨項目對外發佈或商用**。README 尾有「Artwork Assets」一節註明來源同限制,版權屬原作者 Nagano。四個檔名係 plan 訂死嘅 contract,`Kawaii.tsx` 直接引用 `/chiikawa/<檔名>`,改名要兩邊一齊改。

## 5. Playwright 修復(`9e28452`,重要脈絡)

**症狀**:UI 改造後 `tests/ui/dashboard.spec.ts` 成批 fail。

**根因**:產品預設 dashboard 模式係「極簡」(simple),但呢個 spec 斷言嘅係「專業」(pro) 模式嘅 `.buy-dashboard` DOM 結構。之前僥倖過係因為測試順序/localStorage 殘留;改造郁咗渲染路徑就現形。

**修法**:`mockApi` helper 加 `page.addInitScript`,每次導航/reload 前寫 `localStorage[DASHBOARD_MODE_STORAGE_KEY] = "pro"`(key 由 `src/dashboardMode.ts` import,唔係 hardcode 字串);寫入失敗(私隱模式)就靜默回落產品預設。冇改任何產品代碼 — 測試環境明確固定行 pro 模式。

**教訓**:呢個 spec 嘅模式依賴而家係**顯式**嘅。之後如果產品預設模式再變,或者有人喺 spec 加 simple 模式斷言,記住 init script 係全 spec 生效。

## 6. 驗證狀態(2026-07-21 完成時)

| 項目 | 結果 |
|---|---|
| Vitest 單元測試 | **196/196 全綠**(v1.0.1 時係 192,本次 feature +3:Kawaii 相關;收尾 `83cd086` 再 +1:`momonga-alert` 新測試) |
| Playwright UI | **32/32 全綠**(4 viewports;三個收尾 commit 冇郁 UI 結構,未重跑) |
| Build | `tsc --noEmit` + `vite build` 通過(收尾 commits 後重跑) |
| 離線檢查 | 零外部資源(冇 CDN font、冇 hotlink 圖) |
| 目測 | 三個主要頁面 + 登入頁喺淺色底下數字對比度檢查過(見 §7 例外) |

⚠️ 本機 Git Bash 冇 `npm`/`npx` 喺 PATH,跑測試用 `node node_modules/vitest/vitest.mjs run`(詳見 master handoff §8.1)。

**已部署(2026-07-21)**:純前端改動,跟 team-logos handoff §4 流程 rebuild caddy 上咗 production(`https://odds.ballballchu.com.hk`)。Smoke 全過(caddy healthy、首頁 200、API 401、internal 404、HSTS ✓、tunnel ×4),公開 bundle `index-CLj0yK_X.js` 同本地 build 一致(grep `chiikawa` ×18)。DB 備份 `pre-deploy-20260721-044351.dump`,`odds-tool-caddy:rollback` 就位。Cloudflare purge 唔駛做(edge 已派新嘢);如 client 睇唔到新主題,係 stale Service Worker 問題,要 unregister SW + reload(master handoff §11.3 #5/#6 教訓)。

## 7. 已知事項 / 技術債

1. ~~**`--color-primary: #5E9FD4` 做文字色對比唔達標**~~ **✅ 已於 `ec24f06` 解決**(保留歷史):奶藍色喺奶油白底上對比約 2.7:1,達唔到 WCAG AA 4.5:1。解法照 `--color-positive-text`/`--color-negative-text` 前科,加咗 `--color-primary-text: #2E6DA4`(對比 2.70:1 → 5.19:1),`styles.css` 5 處 `color: var(--color-primary)` 已換用新 token,`AppShell.test.tsx` 加埋新 token 斷言。
2. **`styles.css` 剩 5 個 hex 未 token 化**:L237/L533/L769 `#DFF5EA`(淺綠底)、L466 `#FFFFFF`、L472 `#4A8BC0`(深藍 hover 底)。細微,唔阻運作,下次郁樣式順手執。
3. **工作樹有 team-logos 遺留 untracked 檔**(唔係今次 feature 嘅嘢,**唔好郁**):`scripts/tmp-alias-logos.mjs`、`scripts/tmp-priority-logos.mjs`、`data/priority-*.txt/json`、`data/current-teams-now.txt`、`webbridge-req-*.json`、`docs/superpowers/plans/2026-07-20-team-logos.md`;另外 `.superpowers/sdd/progress.md` 有未 commit 修改。
4. ~~**Baloo 2 字體得個名**~~ **✅ 已於 `58ff5b9` 解決**(保留歷史):原本 `--font-rounded` 第一個係 "Baloo 2" 但冇 load 任何 webfont,實際渲染係系統圓體。而家 self-host 咗 `public/fonts/baloo-2-var.woff2`(177 KB variable 400–800,SIL OFL),`styles.css` 頂部加 `@font-face`,PWA precache 已包,離線紅線保持。
5. **素材尺寸不一**:四張 PNG 由 45 KB 到 236 KB,`mascot-chiikawa-empty.png` 最大。`Kawaii.css` 用固定尺寸 + `object-fit` 統一顯示,效能上可以接受,但如要再壓可以用圖片工具瘦下身。
6. ~~Spec 原本講 6–8 張圖,最終落咗 4 張(分工:corner / empty / loading / login-duo);「錯誤提示用 Momonga 細圖示」呢個用途未做,錯誤提示而家冇 mascot。~~ **✅ 已於 `83cd086` 解決**(保留歷史):`Kawaii.tsx` 加咗 `momonga-alert` pose(40×40 icon 級,重用 momonga-loading 圖,所以 PNG 維持 4 張),覆蓋 `App.tsx` 兩個 `role="alert"` 錯誤區塊 + 兩處 qualityWarning + `AppShell` dataWarning + `LoginPage` login-error。
7. **App.tsx 有一個 hardcoded `.sample-warning` 冇 mascot**:「只得 N 場獨立賽事，暫未適合調整策略。」呢段 hardcoded 警告**冇**加飛鼠 mascot — `83cd086` 收尾範圍只覆蓋 `{qualityWarning}` 嘅 `.sample-warning`。如要一致性可 follow-up 加 `<Mascot pose="momonga-alert" />`。

## 8. 下步建議(按優先順序)

1. **(可選)部署上 production** — 純前端,rebuild caddy 就得,流程見 team-logos handoff §4;部署後用乾淨 profile 驗證。
2. ~~**加 `--color-primary-text`** 修正連結/active 文字對比(§7.1),順手 token 化埋剩低 5 個 hex(§7.2)。~~ `--color-primary-text` 已於 `ec24f06` 搞掂;剩低 token 化 5 個 hex(§7.2)可以照做。
3. **Master handoff 版本升級** — 跟 v1.0.1 做法,出 `MASTER-HANDOFF-v1.0.2.md` 整合 team logos + chiikawa UI refresh,`package.json` version + git tag 三件套一齊升。
4. ~~**補錯誤提示 mascot**(spec 有講但未做)同考慮壓縮 `mascot-chiikawa-empty.png`。~~ 錯誤提示 mascot 已於 `83cd086` 補咗(剩 hardcoded `.sample-warning` 一處,見 §7.7);可考慮壓縮 `mascot-chiikawa-empty.png`。

## 9. 常用指令速查

```bash
# 本地驗證(npm/npx 唔喺 PATH)
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/vite/bin/vite.js build
npm.cmd run test:ui:only          # Playwright(用 PowerShell 嘅 npm.cmd)

# 本地 preview
npm.cmd run dev                   # vite --host 127.0.0.1,會 forward host/port args

# 查剩餘 hardcoded hex
grep -nE '#[0-9A-Fa-f]{3,8}' src/styles.css
```

---

*文件完。維護方式:下次重大 UI 改動後更新 §6/§7;出 v1.0.2 master handoff 時呢份會變歷史文件。*
