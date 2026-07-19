# Responsive Buy Dashboard and PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Each task requires TDD and an independent spec/code-quality review.

**Goal:** Deliver the approved 柔和夜間 responsive PWA whose home page contains only valid buy opportunities, while preserving every existing model and archive invariant.

**Architecture:** Keep the current React/Vite client and extraction functions, but introduce one pure opportunity selector and split the monolithic view into route-level components. Add an installable PWA shell whose service worker never treats odds API responses as fresh offline data. Production PostgreSQL/auth/deployment is a separate follow-on plan.

**Tech Stack:** React 19, TypeScript, Vite 6, Vitest, Lucide React, vite-plugin-pwa, Playwright for responsive smoke tests.

## Global Constraints

- `edgeThreshold` remains exactly `0.03`; no UI can lower it.
- Only pre-match, current, data-fresh picks may receive active buy styling.
- Same match = one dashboard card; primary pick is highest edge, secondary picks are retained.
- Sort order is edge descending, kickoff ascending, `matchId` ascending.
- Theme tokens are `#11182B`, `#182038`, `#7C83C8`, `#9CE2CF`, `#F2C879`, `#F6F7FF`, `#8E9CBA`.
- API URLs remain behavior-compatible in this phase; no paid provider calls in tests.
- Existing archive files are read-only and their hashes must not change.

---

### Task 1: Canonical buy-opportunity selector

**Files:**
- Create: `src/buyOpportunities.ts`
- Test: `src/buyOpportunities.test.ts`
- Modify: `src/route.ts`, `src/route.test.ts`

**Interfaces:**

```ts
export type BuyMarket = "主客和" | "大細波" | "角球" | "亞洲讓球";
export type BuyPick = {
  market: BuyMarket;
  selection: string;
  line?: number;
  odds: number;
  chance: number;
  edge: number;
  bookmaker: string;
};
export type BuyCandidate = BuyPick & {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
};
export type BuyOpportunity = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  primary: BuyPick;
  alternatives: BuyPick[];
};
export function selectBuyOpportunities(candidates: BuyCandidate[], options: {
  now: number;
  edgeThreshold: 0.03;
  dataFresh: boolean;
}): BuyOpportunity[];
```

- [ ] Write failing tests for threshold equality, below-threshold exclusion, commenced exclusion, stale fail-closed behavior, four-market grouping, primary/alternative ordering, deterministic tie breaks and malformed numeric data.
- [ ] Run `npm.cmd test -- src/buyOpportunities.test.ts` and confirm failures are caused by the missing selector.
- [ ] Implement the minimal pure selector. Reject non-finite or non-positive odds/chance; never parse buy status from localized display text.
- [ ] Add routes `dashboard`, `fixtures`, `history`, `analysis`, with `#/dashboard` and an empty hash resolving to `dashboard`.
- [ ] Run focused tests, then `npm.cmd test`; record red/green evidence and archive hashes in the task report.

### Task 2: Adaptive application shell and soft-night design system

**Files:**
- Create: `src/components/AppShell.tsx`, `src/components/AppShell.test.tsx`
- Create: `src/styles/tokens.css`, `src/styles/layout.css`
- Modify: `src/main.tsx`, `src/styles.css`

**Interfaces:**

```ts
export type PrimaryRoute = "dashboard" | "fixtures" | "history" | "analysis";
export function AppShell(props: {
  route: PrimaryRoute;
  dataWarning?: string;
  children: React.ReactNode;
}): React.ReactElement;
```

- [ ] Add React Testing Library only if required, then write failing tests for Traditional Chinese navigation labels, active route, alert semantics and mobile navigation accessibility.
- [ ] Implement top navigation for desktop/tablet and safe-area bottom navigation below 720px.
- [ ] Introduce the approved CSS variables, 16px cards, 44px controls, visible focus, reduced motion and WCAG-AA text contrast.
- [ ] Keep current route URLs backward-compatible and remove duplicated top/page tab markup from the eventual page components.
- [ ] Run component tests, full Vitest and production build.

### Task 3: Worth-buying Dashboard and all-fixtures page

**Files:**
- Create: `src/pages/BuyDashboard.tsx`, `src/pages/AllFixtures.tsx`
- Create: `src/pages/BuyDashboard.test.tsx`, `src/pages/AllFixtures.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**

```ts
export function BuyDashboard(props: {
  opportunities: BuyOpportunity[];
  generatedAt: string;
  dataFresh: boolean;
}): React.ReactElement;
```

- [ ] Write failing tests for edge-first rendering, one card per match, alternative-market chips, four real KPIs, stale suppression, zero-opportunity copy and link to `#/fixtures`.
- [ ] Adapt existing H2H, totals, corners and handicap outputs into typed `BuyCandidate` values using numeric fields, not `pickLabel.startsWith("買")`.
- [ ] Render all markets by default with optional local market filters; filters may hide but never reclassify opportunities.
- [ ] Move the complete upcoming fixture feed and no-pick states to `AllFixtures`; retain fixture-detail navigation.
- [ ] Keep History and Model Health behavior unchanged behind the new shell.
- [ ] Run focused tests, all Vitest tests and production build.

### Task 4: Installable PWA and fail-closed offline shell

**Files:**
- Modify: `vite.config.ts`, `package.json`, `index.html`
- Create: `public/icons/*`, `src/pwa.ts`, `src/pwa.test.ts`

**Interfaces:**

```ts
export type ConnectivityState = {
  online: boolean;
  lastSuccessfulSync: string | null;
};
export function canShowActiveOpportunities(state: ConnectivityState, dataFresh: boolean): boolean;
```

- [ ] Write failing tests proving offline or stale state cannot show active buy styling and that the last sync timestamp is preserved for disclosure only.
- [ ] Add `vite-plugin-pwa`, manifest metadata, 192/512 maskable icons, Apple touch icon, standalone display and the soft-night theme colors.
- [ ] Configure Workbox to precache hashed static assets only; exclude `/api/**`, odds JSON and health responses from runtime cache.
- [ ] Add install guidance for iOS/iPadOS and an offline banner with no active opportunities.
- [ ] Run unit tests, production build and a generated-service-worker inspection that proves no API route is precached.

### Task 5: Responsive black-box verification and final gate

**Files:**
- Create: `tests/ui/dashboard.spec.ts`
- Modify: `package.json`

- [ ] Add Playwright smoke coverage at 1440×900, 820×1180 and 390×844 for navigation, one-card-per-match rendering, no horizontal overflow, 44px touch targets, empty/stale/offline states and fixture detail.
- [ ] Run the four existing self-tests, `check:data`, full Vitest, Playwright, production build and dependency vulnerability scan.
- [ ] Verify `prediction-snapshots.jsonl` and `background-hdc-snapshots.jsonl` SHA256 values are unchanged from the approved baseline.
- [ ] Perform independent per-task reviews plus a final whole-phase review; fix all Critical/Important findings and re-run covering tests.
- [ ] Record remaining limitations: current statistics have only three valid-current snapshots and production authentication/PostgreSQL are not part of this UI phase.

## Follow-on plan

After Task 5 passes, write a separate `production-postgres-deployment` implementation plan covering `/api/v1`, single-owner password authentication, PostgreSQL migration, VM collectors, Docker Compose/Caddy, Private GitHub CI and encrypted S3 backups.
