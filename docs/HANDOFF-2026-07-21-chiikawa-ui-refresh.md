# Handoff — Chiikawa UI Refresh + Playwright 測試修復(2026-07-21)

> 上一份:[MASTER-HANDOFF-v1.0.1.md](MASTER-HANDOFF-v1.0.1.md)(整合 team logos feature)。
> 呢份覆蓋 2026-07-21 嘅全 app UI 改造:由深色交易台風格轉做 pastel Chiikawa(吉伊卡哇 + 飛鼠 Momonga)主題,以及隨之而嚟嘅 Playwright dashboard spec 修復。**純前端樣式/展示層改動,零數據邏輯改動。**

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

## 3. 檔案地圖

**新檔:**

| Path | 用途 |
|---|---|
| `src/components/Kawaii.tsx` | `<Mascot pose="chiikawa-corner\|chiikawa-empty\|momonga-loading\|login-duo" />` + `<KawaiiDecor />`(CSS 花瓣/星星裝飾,`aria-hidden`) |
| `src/components/Kawaii.test.tsx` | Mascot/decor SSR 測試 |
| `src/styles/kawaii.css` | mascot 四個 pose 嘅定位/尺寸(corner 係 fixed 右下角常駐,mobile 縮細)+ decor 動效;`main.tsx` import |
| `public/chiikawa/` | 4 張 PNG:`mascot-chiikawa-corner.png`(79 KB)、`mascot-chiikawa-empty.png`(236 KB)、`mascot-login-duo.png`(137 KB)、`mascot-momonga-loading.png`(45 KB) |

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
- **升跌文字另開 token**:pastel 嘅 `--color-positive`/`--color-negative` 做底色可以,做文字色對比唔夠,所以加咗 `--color-positive-text: #2F7D5F` 同 `--color-negative-text: #C05A5A` 專俾文字用。**呢個模式值得記住 — 見 §7 已知事項,primary 仲未做同樣處理。**
- **字體**:用本地 font stack(`"Baloo 2", "PingFang TC", "Microsoft JhengHei", sans-serif`),**唔係**真係 load Baloo 2 — 離線紅線下唔可以用 Google Fonts CDN,系統冇 Baloo 2 就自然 fallback 系統圓體。

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
| Vitest 單元測試 | **195/195 全綠**(v1.0.1 時係 192,今次 +3:Kawaii 相關) |
| Playwright UI | **32/32 全綠**(4 viewports) |
| Build | `tsc --noEmit` + `vite build` 通過 |
| 離線檢查 | 零外部資源(冇 CDN font、冇 hotlink 圖) |
| 目測 | 三個主要頁面 + 登入頁喺淺色底下數字對比度檢查過(見 §7 例外) |

⚠️ 本機 Git Bash 冇 `npm`/`npx` 喺 PATH,跑測試用 `node node_modules/vitest/vitest.mjs run`(詳見 master handoff §8.1)。

**未部署**:今次改動仲未上 production(`https://odds.ballballchu.com.hk` 仲係深色主題)。要上的話係純前端改動,跟 team-logos handoff §4 流程,淨係 rebuild caddy;記住 Cloudflare purge + stale SW 教訓(master handoff §11.3 #5/#6)。

## 7. 已知事項 / 技術債

1. **`--color-primary: #5E9FD4` 做文字色對比唔達標**:奶藍色喺奶油白底上對比約 2.7:1,達唔到 WCAG AA 4.5:1。`styles.css` 有 5 處 `color: var(--color-primary)`(L54、L417、L615、L663、L1096 — 連結、active 狀態等)。**建議後續加 `--color-primary-text`**(做法照 `--color-positive-text`/`--color-negative-text` 嘅前科),揀隻深啲嘅藍。
2. **`styles.css` 剩 5 個 hex 未 token 化**:L237/L533/L769 `#DFF5EA`(淺綠底)、L466 `#FFFFFF`、L472 `#4A8BC0`(深藍 hover 底)。細微,唔阻運作,下次郁樣式順手執。
3. **工作樹有 team-logos 遺留 untracked 檔**(唔係今次 feature 嘅嘢,**唔好郁**):`scripts/tmp-alias-logos.mjs`、`scripts/tmp-priority-logos.mjs`、`data/priority-*.txt/json`、`data/current-teams-now.txt`、`webbridge-req-*.json`、`docs/superpowers/plans/2026-07-20-team-logos.md`;另外 `.superpowers/sdd/progress.md` 有未 commit 修改。
4. **Baloo 2 字體得個名**:`--font-rounded` 第一個係 "Baloo 2" 但冇 load 任何 webfont,實際渲染係系統圓體。想要真 Baloo 2 要 self-host 字體檔(保持離線紅線)。
5. **素材尺寸不一**:四張 PNG 由 45 KB 到 236 KB,`mascot-chiikawa-empty.png` 最大。`Kawaii.css` 用固定尺寸 + `object-fit` 統一顯示,效能上可以接受,但如要再壓可以用圖片工具瘦下身。
6. Spec 原本講 6–8 張圖,最終落咗 4 張(分工:corner / empty / loading / login-duo);「錯誤提示用 Momonga 細圖示」呢個用途未做,錯誤提示而家冇 mascot。

## 8. 下步建議(按優先順序)

1. **(可選)部署上 production** — 純前端,rebuild caddy 就得,流程見 team-logos handoff §4;部署後用乾淨 profile 驗證。
2. **加 `--color-primary-text`** 修正連結/active 文字對比(§7.1),順手 token 化埋剩低 5 個 hex(§7.2)。
3. **Master handoff 版本升級** — 跟 v1.0.1 做法,出 `MASTER-HANDOFF-v1.0.2.md` 整合 team logos + chiikawa UI refresh,`package.json` version + git tag 三件套一齊升。
4. **補錯誤提示 mascot**(spec 有講但未做)同考慮壓縮 `mascot-chiikawa-empty.png`。

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
