### Task 4: `DashboardPage` 透傳 + `App.tsx` fetch + PWA ignore

**Files:**
- Modify: `src/pages/DashboardPage.tsx`
- Modify: `src/pages/DashboardPage.test.tsx`
- Modify: `src/App.tsx`(CRLF 混合換行,Edit 精準改)
- Modify: `vite.config.ts`(globIgnores 加一行)

**Interfaces:**
- Consumes: `TeamLogoMap` from `src/components/TeamLogo.tsx`(Task 1);兩個 dashboard 嘅新 `logos` prop(Task 2、3)
- Produces: `DashboardPage(props: { opportunities; generatedAt: string | null; dataFresh: boolean; storage?: StorageLike; logos: TeamLogoMap })`

- [ ] **Step 1: 改 DashboardPage 測試先** — `src/pages/DashboardPage.test.tsx`:

  1. import 加 `import type { TeamLogoMap } from "../components/TeamLogo";`
  2. 加 `const testLogos: TeamLogoMap = {};` 並將所有 render 呼叫加 `logos={testLogos}`。
  3. 加新 test:

```tsx
  it("passes logos through to the active dashboard", () => {
    const logos: TeamLogoMap = { Home: { id: 1, logo: "/team-logos/1.png" } };
    const markup = renderToStaticMarkup(
      <DashboardPage opportunities={opportunities} generatedAt="now" dataFresh logos={logos} />,
    );

    expect(markup).toContain('src="/team-logos/1.png"');
  });
```

- [ ] **Step 2: 行測試確認 fail**

Run: `node node_modules/vitest/vitest.mjs run src/pages/DashboardPage.test.tsx`
Expected: FAIL(冇 `logos` prop)

- [ ] **Step 3: 改 DashboardPage** — `src/pages/DashboardPage.tsx`:

  1. import 加 `import type { TeamLogoMap } from "../components/TeamLogo";`
  2. props type 加 `logos: TeamLogoMap;`
  3. 兩個 render 分支都加 `logos={props.logos}`:

```tsx
{mode === "pro" ? (
  <BuyDashboard opportunities={props.opportunities} generatedAt={props.generatedAt} dataFresh={props.dataFresh} logos={props.logos} />
) : (
  <SimpleDashboard opportunities={props.opportunities} generatedAt={props.generatedAt} dataFresh={props.dataFresh} logos={props.logos} />
)}
```

- [ ] **Step 4: 行 DashboardPage 測試確認 pass**

Run: `node node_modules/vitest/vitest.mjs run src/pages/DashboardPage.test.tsx`
Expected: PASS,5 個 test 全過

- [ ] **Step 5: 改 App.tsx** — 主 component 入面其他 `useState` 附近加 state + effect:

```tsx
const [teamLogos, setTeamLogos] = useState<TeamLogoMap>({});
useEffect(() => {
  let cancelled = false;
  fetch("/team-logos.json")
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => {
      if (!cancelled && payload?.teams && typeof payload.teams === "object") setTeamLogos(payload.teams);
    })
    .catch(() => { /* logo map 係 progressive enhancement,失敗就用徽章 */ });
  return () => { cancelled = true; };
}, []);
```

  import 區加 `import type { TeamLogoMap } from "./components/TeamLogo";`
  渲染行改做:

```tsx
<DashboardPage opportunities={buyOpportunities} generatedAt={lastSuccessfulSync} dataFresh={opportunitiesTrusted} logos={teamLogos} />
```

- [ ] **Step 6: PWA 唔 precache logo PNG** — `vite.config.ts` 嘅 `globIgnores` 陣列加一行(跟現有格式):

```ts
"**/team-logos/**",
```

- [ ] **Step 7: 行全套測試 + build**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: 全綠(`App.test.tsx` 如有 wiring 斷言受影響,1:1 等價更新,唔准放水)

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json && node node_modules/vite/bin/vite.js build`
Expected: 零 error,build 成功

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/pages/DashboardPage.tsx src/pages/DashboardPage.test.tsx vite.config.ts
git commit -m "feat: load team logo map and pass through dashboard modes"
```

---

