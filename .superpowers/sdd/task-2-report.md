# Task 2 Report: `SimpleDashboard` 接 logo

## 做咗咩

按 `.superpowers/sdd/task-2-brief.md` 用 TDD 完成:

1. **改測試先**(`src/pages/SimpleDashboard.test.tsx`):
   - 頂部加 `import type { TeamLogoMap } from "../components/TeamLogo";`
   - 加共用 `testLogos: TeamLogoMap = { Home: { id: 1, logo: "/team-logos/1.png" } }`
   - 全部 6 個現有 `renderToStaticMarkup(<SimpleDashboard .../>)` 呼叫補上 `logos={testLogos}`
   - 加新 test:`renders an img logo for mapped teams and a badge for unmapped teams`
2. **確認 fail**:新 test fail(`src="/team-logos/1.png"` 未出現),其餘 6 個 pass。
3. **改 component**(`src/pages/SimpleDashboard.tsx`):
   - import `TeamLogo, type TeamLogoMap`
   - props type 加 required `logos: TeamLogoMap`
   - `SimpleCard` 加 `logos` prop,由 map 傳入
   - `<h2>` 改做 `<h2 className="match-teams">`,主隊名前放 `<TeamLogo teamName={opportunity.homeTeam} logos={logos} />`,客隊名後放 `<TeamLogo teamName={opportunity.awayTeam} logos={logos} />`(lookup 用英文 canonical 名)
4. **確認 pass** → commit。

## 指令同測試結果

- `node node_modules/vitest/vitest.mjs run src/pages/SimpleDashboard.test.tsx`
  - Step 2(改 component 前):**1 failed | 6 passed**(新 logo test fail,符合預期)
  - Step 4(改 component 後):**7 passed (7)** ✅
- `node node_modules/typescript/bin/tsc --noEmit`:1 個預期之內嘅 error ——
  `src/pages/DashboardPage.tsx(45,10): error TS2741: Property 'logos' is missing ...`
  呢個係 Task 4(DashboardPage 傳 logos)嘅範圍,本 task 唔郁 DashboardPage。

## Commit

- `2df07da` — `feat: show team logos on simple dashboard cards`(branch `feature/team-logos`,淨係 add 咗 brief 指定嘅兩個檔案)

## Self-review

- ✅ TDD 次序正確:測試先 fail、後 pass,有截圖式輸出佐證(見上)。
- ✅ lookup key 用 `opportunity.homeTeam`/`awayTeam`(英文),唔係中文名;新 test 明確驗證 `Home` 出 img、`Away` 出 badge、`/team-logos/2.png` 唔出現。
- ✅ 冇改 brief 範圍外嘅檔案(DashboardPage 留畀 Task 4)。
- ⚠️ **Brief 偏差一處**:brief 話「冇 logo 嘅隊會出徽章,唔影響現有斷言」,但其實現有 test 入面 `expect(markup).toContain("<h2>主隊 <span>vs</span> 客隊</h2>")` 同 `"<h2>Second Home <span>vs</span> Second Away</h2>"` 兩句會因為 `<h2>` 加咗 `className="match-teams"` 同入面插咗 logo 元素而必然 fail。已將呢兩句放寬為 `toContain("主隊 <span>vs</span> 客隊")` / `toContain("Second Home <span>vs</span> Second Away")`(斷言本體唔變,只係唔再綁死成個 `<h2>` wrapper)。其餘全部照 brief。
- ⚠️ Repo 而家 `tsc --noEmit` 有 1 個 error(DashboardPage 未傳 `logos`),屬預期,Task 4 會解決;vitest 唔 type-check,所以測試全綠。
