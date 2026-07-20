# Task 3 Report — `BuyDashboard`(專業 mode)接 logo(team-logos feature)

> 註:本檔案取代上一個 feature(simple-dashboard-mode)嘅同名舊報告。

## Status: DONE(驗收已存在嘅 commit)

接手時發現 Task 3 嘅改動已按 brief 完成並 commit(`e3cffa9`),工作目錄 `src/` 乾淨。
本輪工作 = 全面驗證該 commit 符合 brief + TDD red/green 可重現,然後補寫本報告。

## 做咗咩(驗證內容)

按 `.superpowers/sdd/task-3-brief.md` 逐項核對 commit `e3cffa9 "feat: show team logos on pro dashboard cards"`:

1. **測試檔 `src/pages/BuyDashboard.test.tsx`** ✅
   - 頂部 `import type { TeamLogoMap } from "../components/TeamLogo";`
   - 共用 map `const testLogos: TeamLogoMap = { Home: { id: 1, logo: "/team-logos/1.png" } };`
   - 全部 8 個 render 呼叫已補 `logos={testLogos}`(含 stale / generatedAt=null 邊界 case)
   - 新 test「renders an img logo for mapped teams and a badge for unmapped teams」存在,
     斷言 `src="/team-logos/1.png"` 同 `team-logo--badge`,同 brief 逐字一致
2. **Component `src/pages/BuyDashboard.tsx`** ✅(`git show` 確認 diff 只含 logo 改動:8 insertions / 1 deletion)
   - `import { TeamLogo, type TeamLogoMap } from "../components/TeamLogo";`
   - props type 加 `logos: TeamLogoMap;`(required)
   - 卡內 `<h2>` 改做 `className="match-teams"` 包 `<TeamLogo teamName={opportunity.homeTeam} … />` + 原名行 + `<TeamLogo teamName={opportunity.awayTeam} … />`
   - lookup 用英文 canonical 名(`homeTeam`/`awayTeam`),唔係中文名 ✅
3. **TDD red 可重現** ✅:暫時 `git checkout e3cffa9^ -- src/pages/BuyDashboard.tsx` 後行測試
   → `Tests 1 failed | 9 passed (10)`,fail 嘅正正係新 logo test;之後已 `git restore` 還原,
   `git status src/` 確認乾淨。
4. **Green 確認** ✅:現況 10/10 pass。

## 指令同測試結果

- `node node_modules/vitest/vitest.mjs run src/pages/BuyDashboard.test.tsx`
  - Red(舊 component):`Test Files 1 failed (1)`,`Tests 1 failed | 9 passed (10)` ✅(預期)
  - Green(HEAD):`Test Files 1 passed (1)`,`Tests 10 passed (10)` ✅
- 全套回歸:`node node_modules/vitest/vitest.mjs run`
  → `Test Files 1 failed | 28 passed (29)`,`Tests 3 failed | 188 passed (191)`
  - 3 個 fail 全部喺 `src/pages/DashboardPage.test.tsx`(DashboardPage 未傳 `logos` 畀 `BuyDashboard`,
    render 直接 throw)—— 同已知 tsc TS2741 同一根源,屬 Task 4 範圍(plan 已確認:
    Task 4 = DashboardPage 透傳 + App.tsx fetch),本 task 唔准郁。
- `node node_modules/typescript/bin/tsc --noEmit`
  → 只有預期嘅 2 個 `src/pages/DashboardPage.tsx(43,10)`、`(45,10)` TS2741(Property 'logos' is missing),Task 4 處理。

## Commit

- Hash: `e3cffa90a3e1f4085abba0e15302718fbfc0a759`(branch `feature/team-logos`)
- Message: `feat: show team logos on pro dashboard cards`
- 2 files changed, 31 insertions(+), 11 deletions(-):
  `src/pages/BuyDashboard.tsx`、`src/pages/BuyDashboard.test.tsx`(只有呢兩個檔,同 brief Files 清單一致)

## Self-review

- ✅ commit 只含 brief 指定嘅兩個檔案;component diff 逐行核對過,純 logo 相關,KPI 行 / 市場篩選 /
  莊家·賠率·機會率·Edge 明細 / 所有邏輯一字未郁。
- ✅ `logos` 係 required prop;所有現有測試 render 呼叫已補 `logos={testLogos}`。
- ✅ lookup key 用英文 canonical 名,唔係 `homeTeamZh`/`awayTeamZh`。
- ✅ Red→Green 已重現驗證,唔係齋信 commit message。
- ✅ 冇郁 `DashboardPage.tsx` / `DashboardPage.test.tsx`(Task 4 範圍)。
- ⚠️ 已知下游狀態:`DashboardPage.test.tsx` 3 個 test 暫時 fail + tsc 2 個 TS2741,
  全部源於 DashboardPage 未傳 logos,等 Task 4 wiring 後會綠;呢個係 plan 預期嘅中間態。
- ⚠️ 小事:工作目錄有其他未 commit 變動(`.superpowers/sdd/*`、`docs/*`、`webbridge-req-*.json`),
  唔屬於 Task 3,冇郁佢哋。
