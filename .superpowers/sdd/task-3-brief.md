### Task 3: `BuyDashboard`(專業 mode)接 logo

**Files:**
- Modify: `src/pages/BuyDashboard.tsx`
- Modify: `src/pages/BuyDashboard.test.tsx`

**Interfaces:**
- Consumes: `TeamLogo`、`TeamLogoMap` from `src/components/TeamLogo.tsx`(Task 1)
- Produces: `BuyDashboard(props: { opportunities; generatedAt: string | null; dataFresh: boolean; logos: TeamLogoMap })`

注意:上次 feature 嘅「BuyDashboard 唔准改」constraint 已過期 — 今個 feature 明確要改佢,但**只准加 logo 相關改動**,KPI/篩選/明細邏輯唔准郁。

- [ ] **Step 1: 改測試先** — `src/pages/BuyDashboard.test.tsx`:

  1. 頂部 import 加 `import type { TeamLogoMap } from "../components/TeamLogo";`
  2. 加共用 map,並將所有現有 render 呼叫加 `logos={testLogos}`:

```tsx
const testLogos: TeamLogoMap = {
  Home: { id: 1, logo: "/team-logos/1.png" },
};
```

  3. 加新 test:

```tsx
  it("renders an img logo for mapped teams and a badge for unmapped teams", () => {
    const markup = renderToStaticMarkup(
      <BuyDashboard opportunities={opportunities} generatedAt="now" dataFresh logos={testLogos} />,
    );

    expect(markup).toContain('src="/team-logos/1.png"');
    expect(markup).toContain("team-logo--badge");
  });
```

- [ ] **Step 2: 行測試確認 fail**

Run: `node node_modules/vitest/vitest.mjs run src/pages/BuyDashboard.test.tsx`
Expected: FAIL(冇 `logos` prop)

- [ ] **Step 3: 改 component** — `src/pages/BuyDashboard.tsx`:

  1. import 加:

```tsx
import { TeamLogo, type TeamLogoMap } from "../components/TeamLogo";
```

  2. props type 加 `logos: TeamLogoMap;`
  3. 卡入面嘅 `<h2>`(第 74 行附近)由:

```tsx
<h2>{opportunity.homeTeamZh ?? opportunity.homeTeam} <span>vs</span> {opportunity.awayTeamZh ?? opportunity.awayTeam}</h2>
```

  改做:

```tsx
<h2 className="match-teams">
  <TeamLogo teamName={opportunity.homeTeam} logos={props.logos} />
  {opportunity.homeTeamZh ?? opportunity.homeTeam} <span>vs</span> {opportunity.awayTeamZh ?? opportunity.awayTeam}
  <TeamLogo teamName={opportunity.awayTeam} logos={props.logos} />
</h2>
```

- [ ] **Step 4: 行測試確認 pass**

Run: `node node_modules/vitest/vitest.mjs run src/pages/BuyDashboard.test.tsx`
Expected: PASS,10 個 test 全過

- [ ] **Step 5: Commit**

```bash
git add src/pages/BuyDashboard.tsx src/pages/BuyDashboard.test.tsx
git commit -m "feat: show team logos on pro dashboard cards"
```

---

