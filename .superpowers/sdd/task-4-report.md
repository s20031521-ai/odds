# Task 4 Report: `DashboardPage` 透傳 + `App.tsx` fetch + PWA ignore

Commit: `a5b90e3` — `feat: load team logo map and pass through dashboard modes`

## 做咗咩

1. **`src/pages/DashboardPage.test.tsx`(Step 1,測試先行)**
   - 加 `import type { TeamLogoMap } from "../components/TeamLogo";`
   - 加 `const testLogos: TeamLogoMap = {};`,4 個現有 render 呼叫全部加 `logos={testLogos}`
   - 加新 test `passes logos through to the active dashboard`,用 `{ Home: { id: 1, logo: "/team-logos/1.png" } }` 斷言 markup 有 `src="/team-logos/1.png"`

2. **確認 fail(Step 2)** — `DashboardPage.test.tsx` 4 failed / 1 passed(缺 `logos` prop,runtime 抛錯),符合 TDD red。

3. **`src/pages/DashboardPage.tsx`(Step 3)**
   - import `TeamLogoMap`;props type 加 required `logos: TeamLogoMap;`
   - `BuyDashboard` 同 `SimpleDashboard` 兩個 render 分支都加 `logos={props.logos}`

4. **確認 pass(Step 4)** — 5 個 test 全過。

5. **`src/App.tsx`(Step 5,Edit 精準改,冇重寫成個 CRLF 大檔)**
   - import 區加 `import type { TeamLogoMap } from "./components/TeamLogo";`
   - `apiStatus` state 後面加 `teamLogos` state + mount effect:fetch `/team-logos.json`,`response.ok` 先 parse,`payload?.teams` 係 object 先 set,catch 靜默失敗(空 map → 全部隊用徽章,唔阻 render),cleanup 設 `cancelled` flag
   - 渲染行加 `logos={teamLogos}`

6. **`vite.config.ts`(Step 6)** — `globIgnores` 跟現有格式加 `"**/team-logos/**"`。

## `App.test.tsx` 有冇需要改

**冇。** 全套測試一次過全綠,`App.test.tsx` 冇 wiring 斷言受影響(`logos` 係新 prop,fetch 失敗/未 load 完都唔會改變現有斷言嘅 markup),所以零改動,唔存在放水問題。

## 指令同結果

| 指令 | 結果 |
|---|---|
| `node node_modules/vitest/vitest.mjs run src/pages/DashboardPage.test.tsx`(改 component 前) | 4 failed / 1 passed(預期 red) |
| `node node_modules/vitest/vitest.mjs run src/pages/DashboardPage.test.tsx`(改 component 後) | 5 passed |
| `node node_modules/vitest/vitest.mjs run`(全套) | **29 files / 192 tests 全綠** |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | 零 error(TS2741 已消失) |
| `node node_modules/vite/bin/vite.js build` | 成功;PWA precache 9 entries,`team-logos` 唔喺入面 |

## Self-review

- 全部改動同 brief 指定嘅 code 一致;`App.tsx` 只用 3 次精準 Edit(import / state+effect / 渲染行),冇重寫。
- fetch effect 防禦齊:`!response.ok` → null、非 object payload 唔 set、network error catch 靜默、unmount 後唔 setState。
- 新測試真係行到 `SimpleDashboard` 嘅 logo 渲染路徑(red 階段佢係 1 個未 fail 嘅 test 因為 runtime 抛錯;green 階段斷言 `src="/team-logos/1.png"` 通過)。
- **注意:`public/team-logos.json` 同 `public/team-logos/` 而家未存在**(預計係後續 task 產生)。fetch 會 404 → 靜默用空 map,行為正確,但部署前要有呢個檔先會真係顯示 logo。
- commit 範圍乾淨:只含 brief 指定嘅 4 個檔,冇混入 `.superpowers` 或 webbridge 雜檔。
