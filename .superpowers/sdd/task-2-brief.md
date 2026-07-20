### Task 2: `SimpleDashboard` 接 logo

**Files:**
- Modify: `src/pages/SimpleDashboard.tsx`
- Modify: `src/pages/SimpleDashboard.test.tsx`

**Interfaces:**
- Consumes: `TeamLogo`、`TeamLogoMap` from `src/components/TeamLogo.tsx`(Task 1)
- Produces: `SimpleDashboard(props: { opportunities; generatedAt: string | null; dataFresh: boolean; logos: TeamLogoMap })`(`logos` 係新 required prop,Task 4 嘅 DashboardPage 會傳)

注意:lookup 用英文 canonical 名(`opportunity.homeTeam`/`awayTeam`),唔係 `homeTeamZh`。

- [ ] **Step 1: 改測試先(TDD)** — `src/pages/SimpleDashboard.test.tsx`:

  1. 頂部 import 加 `import type { TeamLogoMap } from "../components/TeamLogo";`
  2. 加一個共用 map 同埋將**所有現有** `renderToStaticMarkup(<SimpleDashboard ... />)` 呼叫加 `logos={testLogos}` prop(冇 logo 嘅隊會出徽章,唔影響現有斷言):

```tsx
const testLogos: TeamLogoMap = {
  Home: { id: 1, logo: "/team-logos/1.png" },
};
```

  3. 加新 test:

```tsx
  it("renders an img logo for mapped teams and a badge for unmapped teams", () => {
    const markup = renderToStaticMarkup(
      <SimpleDashboard opportunities={opportunities} generatedAt="now" dataFresh logos={testLogos} />,
    );

    expect(markup).toContain('src="/team-logos/1.png"');
    expect(markup).toContain("team-logo--badge");
    // "Away" 冇 mapping → 徽章;兩隊英文名做 key,唔係中文名
    expect(markup).not.toContain('src="/team-logos/2.png"');
  });
```

- [ ] **Step 2: 行測試確認 fail**

Run: `node node_modules/vitest/vitest.mjs run src/pages/SimpleDashboard.test.tsx`
Expected: FAIL(TypeScript 話冇 `logos` prop / 新 test fail)

- [ ] **Step 3: 改 component** — `src/pages/SimpleDashboard.tsx`:

  1. import 加:

```tsx
import { TeamLogo, type TeamLogoMap } from "../components/TeamLogo";
```

  2. props type 加 `logos: TeamLogoMap;`
  3. `SimpleCard` 嘅 `<h2>` 由:

```tsx
<h2>{opportunity.homeTeamZh ?? opportunity.homeTeam} <span>vs</span> {opportunity.awayTeamZh ?? opportunity.awayTeam}</h2>
```

  改做(`SimpleCard` 加 `logos` prop,由 map 傳入 `logos={props.logos}`):

```tsx
<h2 className="match-teams">
  <TeamLogo teamName={opportunity.homeTeam} logos={logos} />
  {opportunity.homeTeamZh ?? opportunity.homeTeam} <span>vs</span> {opportunity.awayTeamZh ?? opportunity.awayTeam}
  <TeamLogo teamName={opportunity.awayTeam} logos={logos} />
</h2>
```

- [ ] **Step 4: 行測試確認 pass**

Run: `node node_modules/vitest/vitest.mjs run src/pages/SimpleDashboard.test.tsx`
Expected: PASS,7 個 test 全過

- [ ] **Step 5: Commit**

```bash
git add src/pages/SimpleDashboard.tsx src/pages/SimpleDashboard.test.tsx
git commit -m "feat: show team logos on simple dashboard cards"
```

---

