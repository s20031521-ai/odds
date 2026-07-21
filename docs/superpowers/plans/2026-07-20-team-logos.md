# 球隊 Logo(Self-hosted)實作計劃

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dashboard 兩個 mode 每張卡嘅主/客隊名隔籬顯示 24px 圓 logo(self-hosted PNG),搵唔到嘅隊用 initials 徽章 fallback。

**Architecture:** 本地 script `scripts/build-team-logos.mjs` 用 API-Football 搜隊 → download PNG 落 `public/team-logos/<id>.png` → 寫 `public/team-logos.json`(本地路徑,commit 落 git)。前端 `TeamLogo` component 做靜態 lookup;`App.tsx` fetch 一次 `/team-logos.json` 逐層傳 props。Browser 永不接觸第三方 CDN。

**Tech Stack:** React 19 + TypeScript + Vite + vitest(`renderToStaticMarkup`,node);script 用 Node 24 原生 `fetch` + `node:test`。

**Spec:** `docs/superpowers/specs/2026-07-20-team-logos-design.md`

## Global Constraints

- Logo 必須 **self-hosted**:`team-logos.json` 入面嘅 `logo` 值係本地路徑格式 `/team-logos/<id>.png`,**唔准** 存 `https://media.api-football.com/...` 外部 URL;前端唔准向第三方 CDN 發 request。
- 前端 lookup key 係**英文 canonical 名**(`homeTeam`/`awayTeam`),唔係中文名。
- Fallback 係 initials 徽章(唔係空白、唔係通用 icon);冇 mapping 嘅隊唔可以穿崩版面。
- vitest 行 node,冇 jsdom;component 測試用 `react-dom/server` 嘅 `renderToStaticMarkup`。
- script 測試用 `node:test` + `node:assert/strict`(跟 `scripts/*.test.mjs` pattern),用注入假 `fetchImpl`,**唔准喺測試度真打 API**。
- API key 由 `.env.local` 嘅 `API_FOOTBALL_KEY` 提供,只留本地;測試、日誌、commit 都唔准出現 key。
- 3% edge / 買盤邏輯 / collector / server 唔准郁。
- `src/App.tsx` 係 CRLF 混合換行過千行大檔,用 Edit 精準修改。
- 每個 task 完咗要 commit;收工前全套測試 + build 全綠。
- 本機 `npx`/`npm` 可能唔喺 PATH:vitest 用 `node node_modules/vitest/vitest.mjs run`,tsc 用 `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`,vite build 用 `node node_modules/vite/bin/vite.js build`。

---

### Task 1: `TeamLogo` component + CSS

**Files:**
- Create: `src/components/TeamLogo.tsx`
- Test: `src/components/TeamLogo.test.tsx`
- Modify: `src/styles/dashboard.css`(append)

**Interfaces:**
- Produces(之後所有 task 用):
  - `type TeamLogoEntry = { id: number; logo: string; needsReview?: boolean }`
  - `type TeamLogoMap = Record<string, TeamLogoEntry>`
  - `TeamLogo(props: { teamName: string; logos: TeamLogoMap }): React.ReactElement`
  - `initials(teamName: string): string`(export 俾測試)
  - CSS class:`team-logo`、`team-logo--badge`、`match-teams`

- [ ] **Step 1: 寫 failing test** — 建立 `src/components/TeamLogo.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { initials, TeamLogo, type TeamLogoMap } from "./TeamLogo";

const logos: TeamLogoMap = {
  Arsenal: { id: 42, logo: "/team-logos/42.png" },
};

describe("TeamLogo", () => {
  it("renders a 24px local img when the team is mapped", () => {
    const markup = renderToStaticMarkup(<TeamLogo teamName="Arsenal" logos={logos} />);

    expect(markup).toContain("<img");
    expect(markup).toContain('src="/team-logos/42.png"');
    expect(markup).toContain('width="24"');
    expect(markup).toContain('height="24"');
    expect(markup).toContain('loading="lazy"');
    expect(markup).toContain('alt=""');
    expect(markup).not.toContain("team-logo--badge");
    expect(markup).not.toContain("media.api-football.com");
  });

  it("renders an initials badge when the team is not mapped", () => {
    const markup = renderToStaticMarkup(<TeamLogo teamName="Manchester United" logos={logos} />);

    expect(markup).not.toContain("<img");
    expect(markup).toContain("team-logo--badge");
    expect(markup).toContain(">MU</span>");
  });

  it("is deterministic: same team renders identical badge markup", () => {
    const first = renderToStaticMarkup(<TeamLogo teamName="Chelsea" logos={{}} />);
    const second = renderToStaticMarkup(<TeamLogo teamName="Chelsea" logos={{}} />);

    expect(first).toBe(second);
  });
});

describe("initials", () => {
  it("uses the first letter of the first two words", () => {
    expect(initials("Manchester United")).toBe("MU");
  });

  it("uses the first two letters for single-word teams", () => {
    expect(initials("Arsenal")).toBe("AR");
  });

  it("handles blank input safely", () => {
    expect(initials("   ")).toBe("?");
  });
});
```

- [ ] **Step 2: 行測試確認 fail**

Run: `node node_modules/vitest/vitest.mjs run src/components/TeamLogo.test.tsx`
Expected: FAIL,`Failed to resolve import "./TeamLogo"`

- [ ] **Step 3: 實作** — 建立 `src/components/TeamLogo.tsx`:

```tsx
export type TeamLogoEntry = { id: number; logo: string; needsReview?: boolean };
export type TeamLogoMap = Record<string, TeamLogoEntry>;

const BADGE_COLORS = [
  "var(--color-primary)",
  "var(--color-positive)",
  "var(--color-warning)",
  "var(--color-muted)",
] as const;

export function TeamLogo(props: { teamName: string; logos: TeamLogoMap }): React.ReactElement {
  const entry = props.logos[props.teamName];
  if (entry?.logo) {
    return <img alt="" className="team-logo" height={24} loading="lazy" src={entry.logo} width={24} />;
  }
  return (
    <span aria-hidden="true" className="team-logo team-logo--badge" style={{ background: badgeColor(props.teamName) }}>
      {initials(props.teamName)}
    </span>
  );
}

export function initials(teamName: string): string {
  const words = teamName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function badgeColor(teamName: string): string {
  let hash = 0;
  for (const char of teamName) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return BADGE_COLORS[hash % BADGE_COLORS.length];
}
```

- [ ] **Step 4: 行測試確認 pass**

Run: `node node_modules/vitest/vitest.mjs run src/components/TeamLogo.test.tsx`
Expected: PASS,6 個 test 全過

- [ ] **Step 5: 加 CSS** — append 落 `src/styles/dashboard.css` 尾:

```css
.match-teams {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.team-logo {
  width: 24px;
  height: 24px;
  flex: none;
  border-radius: 50%;
  background: var(--color-surface);
  object-fit: contain;
}

.team-logo--badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-bg);
  font-size: 0.62rem;
  font-weight: 800;
}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/TeamLogo.tsx src/components/TeamLogo.test.tsx src/styles/dashboard.css
git commit -m "feat: add TeamLogo component with initials fallback"
```

---

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

### Task 5: `scripts/build-team-logos.mjs`

**Files:**
- Create: `scripts/build-team-logos.mjs`
- Test: `scripts/build-team-logos.test.mjs`

**Interfaces:**
- Consumes: `.env.local` 嘅 `API_FOOTBALL_KEY`(runtime);`public/hkjc-odds.json`、`data/*.json` 入面嘅 `homeTeam`/`awayTeam` 字串
- Produces(operator 用):
  - CLI:`node scripts/build-team-logos.mjs` / `--refresh`
  - `public/team-logos.json`:`{ generatedAt: string, teams: Record<string, { id: number, logo: "/team-logos/<id>.png", needsReview?: boolean }> }`
  - `public/team-logos/<id>.png`
  - Export 俾測試:`collectTeamNames(root: string): Promise<string[]>`、`pickTeamResult(teamName: string, payload: unknown): { id: number, name: string, logoUrl: string, needsReview: boolean } | null`、`buildTeamLogos(options): Promise<BuildSummary>`

API 細節(跟 `scripts/hkjc-import.mjs` 現有 pattern):endpoint `https://v3.football.api-sports.io`,header `x-apisports-key: <key>`,`GET /teams?search=<name>`,response shape `{ response: [{ team: { id, name, logo } }] }`。

- [ ] **Step 1: 寫 failing test** — 建立 `scripts/build-team-logos.test.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildTeamLogos, collectTeamNames, pickTeamResult } from "./build-team-logos.mjs";

function apiPayload(teams) {
  return { response: teams.map((team) => ({ team })) };
}

async function fixtureRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "team-logos-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "public"), { recursive: true });
  await mkdir(path.join(root, "data"), { recursive: true });
  await writeFile(path.join(root, "public", "hkjc-odds.json"), JSON.stringify({
    entries: [{ homeTeam: "Arsenal", awayTeam: "Chelsea" }],
  }));
  await writeFile(path.join(root, "data", "background-hdc-odds.json"), JSON.stringify({
    items: [{ homeTeam: "Arsenal", awayTeam: "Liverpool" }],
  }));
  return root;
}

function fakeFetch(routes, calls = []) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    const key = routes.find(([match]) => String(url).includes(match));
    if (!key) throw new Error("network down");
    const [, payload, isPng] = key;
    return {
      ok: true,
      json: async () => payload,
      arrayBuffer: async () => new TextEncoder().encode("PNG-BYTES").buffer,
      headers: new Headers({ "content-type": isPng ? "image/png" : "application/json" }),
    };
  };
}

test("collectTeamNames finds unique home/away names across public and data JSON", async (t) => {
  const root = await fixtureRoot(t);
  const names = await collectTeamNames(root);
  assert.deepEqual(names, ["Arsenal", "Chelsea", "Liverpool"]);
});

test("pickTeamResult adopts exact matches without needsReview", () => {
  const picked = pickTeamResult("Arsenal", apiPayload([{ id: 42, name: "Arsenal", logo: "https://cdn/42.png" }]));
  assert.deepEqual(picked, { id: 42, name: "Arsenal", logoUrl: "https://cdn/42.png", needsReview: false });
});

test("pickTeamResult flags near-name matches for review", () => {
  const picked = pickTeamResult("Arsenal", apiPayload([{ id: 42, name: "Arsenal FC", logo: "https://cdn/42.png" }]));
  assert.equal(picked.needsReview, true);
});

test("pickTeamResult returns null when there are no results", () => {
  assert.equal(pickTeamResult("Nowhere FC", apiPayload([])), null);
});

test("buildTeamLogos writes local-path entries, downloads PNGs and is idempotent", async (t) => {
  const root = await fixtureRoot(t);
  const calls = [];
  const fetchImpl = fakeFetch([
    ["search=Arsenal", apiPayload([{ id: 42, name: "Arsenal", logo: "https://cdn/42.png" }])],
    ["search=Chelsea", apiPayload([{ id: 49, name: "Chelsea FC", logo: "https://cdn/49.png" }])],
    ["search=Liverpool", apiPayload([])],
    ["https://cdn/42.png", null, true],
    ["https://cdn/49.png", null, true],
  ], calls);

  const summary = await buildTeamLogos({ root, apiKey: "test-key", fetchImpl, sleepImpl: async () => {} });

  const written = JSON.parse(await readFile(path.join(root, "public", "team-logos.json"), "utf8"));
  assert.deepEqual(written.teams.Arsenal, { id: 42, logo: "/team-logos/42.png" });
  assert.deepEqual(written.teams.Chelsea, { id: 49, logo: "/team-logos/49.png", needsReview: true });
  assert.equal(written.teams.Liverpool, undefined);
  assert.deepEqual(summary.misses, ["Liverpool"]);
  assert.deepEqual(summary.needsReview, ["Chelsea"]);
  const png = await readFile(path.join(root, "public", "team-logos", "42.png"));
  assert.equal(png.toString(), "PNG-BYTES");

  // 第二次跑:已有 entry(Arsenal/Chelsea)唔再叫 API;Liverpool 冇 entry 會再試
  const again = await buildTeamLogos({ root, apiKey: "test-key", fetchImpl, sleepImpl: async () => {} });
  assert.equal(calls.filter((call) => call.url.includes("search=Arsenal")).length, 1);
  assert.equal(calls.filter((call) => call.url.includes("search=Chelsea")).length, 1);
  assert.deepEqual(again.misses, ["Liverpool"]);
});

test("buildTeamLogos skips entries whose logo download fails and keeps going", async (t) => {
  const root = await fixtureRoot(t);
  const fetchImpl = fakeFetch([
    ["search=Arsenal", apiPayload([{ id: 42, name: "Arsenal", logo: "https://cdn/42.png" }])],
    ["search=Chelsea", apiPayload([{ id: 49, name: "Chelsea", logo: "https://cdn/49.png" }])],
    ["search=Liverpool", apiPayload([{ id: 50, name: "Liverpool", logo: "https://cdn/50.png" }])],
    ["https://cdn/49.png", null, true],
    ["https://cdn/50.png", null, true],
    // 42.png 故意唔俾 route → download 失敗
  ]);

  const summary = await buildTeamLogos({ root, apiKey: "test-key", fetchImpl, sleepImpl: async () => {} });

  const written = JSON.parse(await readFile(path.join(root, "public", "team-logos.json"), "utf8"));
  assert.equal(written.teams.Arsenal, undefined);
  assert.deepEqual(written.teams.Chelsea, { id: 49, logo: "/team-logos/49.png" });
  assert.deepEqual(summary.downloadFailed, ["Arsenal"]);
});
```

注意:測試入面嘅 `"test-key"` 係假值,唔係真 key。

- [ ] **Step 2: 行測試確認 fail**

Run: `node --test scripts/build-team-logos.test.mjs`
Expected: FAIL,`Cannot find module './build-team-logos.mjs'`

- [ ] **Step 3: 實作** — 建立 `scripts/build-team-logos.mjs`:

```js
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const API_FOOTBALL_ENDPOINT = "https://v3.football.api-sports.io";
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["public", "data"];
const SKIP_FILES = new Set(["team-logos.json"]);

export async function collectTeamNames(root, readDirImpl = readdir, readFileImpl = readFile) {
  const names = new Set();
  for (const dir of SCAN_DIRS) {
    let files;
    try {
      files = await readDirImpl(path.join(root, dir));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".json") || SKIP_FILES.has(file)) continue;
      try {
        collectNamesFromValue(JSON.parse(await readFileImpl(path.join(root, dir, file), "utf8")), names);
      } catch {
        // 唔係 JSON 或者讀唔到:跳過,唔阻住其他檔
      }
    }
  }
  return [...names].sort((left, right) => (left < right ? -1 : 1));
}

function collectNamesFromValue(value, names) {
  if (Array.isArray(value)) {
    for (const item of value) collectNamesFromValue(item, names);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (typeof value.homeTeam === "string" && value.homeTeam.trim()) names.add(value.homeTeam.trim());
  if (typeof value.awayTeam === "string" && value.awayTeam.trim()) names.add(value.awayTeam.trim());
  for (const item of Object.values(value)) {
    if (item && typeof item === "object") collectNamesFromValue(item, names);
  }
}

export function pickTeamResult(teamName, payload) {
  const first = payload?.response?.[0]?.team;
  if (!first?.id || !first?.logo) return null;
  const exact = String(first.name ?? "").toLowerCase() === teamName.toLowerCase();
  return { id: first.id, name: String(first.name ?? teamName), logoUrl: String(first.logo), needsReview: !exact };
}

export async function buildTeamLogos({
  root = PROJECT_ROOT,
  apiKey = process.env.API_FOOTBALL_KEY,
  fetchImpl = fetch,
  sleepImpl = defaultSleep,
  refresh = false,
} = {}) {
  if (!apiKey) throw new Error("API_FOOTBALL_KEY missing (.env.local)");
  const publicDir = path.join(root, "public");
  const logosDir = path.join(publicDir, "team-logos");
  const jsonPath = path.join(publicDir, "team-logos.json");
  await mkdir(logosDir, { recursive: true });

  const existing = await readExisting(jsonPath);
  const names = await collectTeamNames(root);
  const pending = refresh ? names : names.filter((name) => !existing[name]);
  const summary = { written: 0, skipped: names.length - pending.length, misses: [], needsReview: [], downloadFailed: [] };

  for (const name of pending) {
    await sleepImpl();
    let picked = null;
    try {
      const url = `${API_FOOTBALL_ENDPOINT}/teams?search=${encodeURIComponent(name)}`;
      const response = await fetchImpl(url, { headers: { "x-apisports-key": apiKey } });
      if (!response.ok) throw new Error(`API-Football ${response.status}`);
      picked = pickTeamResult(name, await response.json());
    } catch (error) {
      console.warn(`[team-logos] search failed for ${name}: ${error.message}`);
    }
    if (!picked) {
      summary.misses.push(name);
      continue;
    }
    const pngPath = path.join(logosDir, `${picked.id}.png`);
    try {
      const logoResponse = await fetchImpl(picked.logoUrl);
      if (!logoResponse.ok) throw new Error(`logo ${logoResponse.status}`);
      await writeFile(pngPath, Buffer.from(await logoResponse.arrayBuffer()));
    } catch (error) {
      console.warn(`[team-logos] download failed for ${name}: ${error.message}`);
      summary.downloadFailed.push(name);
      continue;
    }
    existing[name] = {
      id: picked.id,
      logo: `/team-logos/${picked.id}.png`,
      ...(picked.needsReview ? { needsReview: true } : {}),
    };
    if (picked.needsReview) summary.needsReview.push(name);
    summary.written += 1;
  }

  const sorted = Object.fromEntries(Object.entries(existing).sort(([a], [b]) => (a < b ? -1 : 1)));
  await writeFile(jsonPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), teams: sorted }, null, 2)}\n`);
  console.log(`[team-logos] written=${summary.written} skipped=${summary.skipped} misses=${summary.misses.length} downloadFailed=${summary.downloadFailed.length} needsReview=${summary.needsReview.length}`);
  if (summary.needsReview.length) console.log(`[team-logos] needsReview: ${summary.needsReview.join(", ")}`);
  return summary;
}

async function readExisting(jsonPath) {
  try {
    const payload = JSON.parse(await readFile(jsonPath, "utf8"));
    return payload?.teams && typeof payload.teams === "object" ? payload.teams : {};
  } catch {
    return {};
  }
}

function defaultSleep() {
  return new Promise((resolve) => setTimeout(resolve, 120));
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  try {
    process.loadEnvFile(path.join(PROJECT_ROOT, ".env.local"));
  } catch {
    // .env.local 唔存在就用 process.env 現有值
  }
  buildTeamLogos({ refresh: process.argv.includes("--refresh") }).catch((error) => {
    console.error(`[team-logos] failed: ${error.message}`);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: 行測試確認 pass**

Run: `node --test scripts/build-team-logos.test.mjs`
Expected: PASS,6 個 test 全過

- [ ] **Step 5: Commit**

```bash
git add scripts/build-team-logos.mjs scripts/build-team-logos.test.mjs
git commit -m "feat: add team logo builder script (self-hosted PNGs)"
```
