# Task 2: Adaptive application shell and soft-night design system

## Context

Task 1 added the canonical selector and the four route values. This task creates the reusable visual shell for later page migration; do not move Dashboard business logic yet. Work in `C:\Users\itadmin\Documents\賭`. No usable Git repository: do not initialize or commit. Use strict RED/GREEN TDD and `apply_patch` for source edits.

## Files

- Create `src/components/AppShell.tsx`
- Create `src/components/AppShell.test.tsx`
- Create `src/styles/tokens.css`
- Create `src/styles/layout.css`
- Modify `src/main.tsx`
- Modify only the global/root compatibility portions of `src/styles.css`; preserve existing feature selectors for Task 3.

## Required interface

```tsx
import type { ReactNode } from "react";
import type { Page } from "../route";

export function AppShell(props: {
  route: Page;
  dataWarning?: string;
  children: ReactNode;
}): React.ReactElement;
```

Navigation is generated from one immutable config array, not duplicated markup. Exact routes and labels:

- `#/dashboard` — `值得買`
- `#/fixtures` — `全部賽事`
- `#/history` — `完場紀錄`
- `#/analysis` — `模型健康`

Render a desktop/tablet top navigation and an iPhone bottom navigation from the same config. Both use `aria-label`, exact anchors, and `aria-current="page"` for the active route. The shell includes a skip link to `#main-content`; the content container has that ID and is focusable. A non-empty `dataWarning` renders exactly one semantic `role="alert"` outside the navigation.

## Visual contract

Define and use these exact CSS variables:

```css
--color-bg: #11182b;
--color-surface: #182038;
--color-primary: #7c83c8;
--color-positive: #9ce2cf;
--color-warning: #f2c879;
--color-text: #f6f7ff;
--color-muted: #8e9cba;
--radius-card: 16px;
--touch-target: 44px;
```

- Body background/text use tokens and retain system font rendering.
- App content is centered, max width 1440px, and leaves bottom safe-area room on phones.
- At widths above 720px show top nav and hide bottom nav. At `max-width: 720px`, hide top nav, show fixed bottom nav, respect `env(safe-area-inset-bottom)`, and keep all nav targets at least 44px.
- Visible `:focus-visible`, reduced-motion override, no horizontal page overflow, and semantic alert styling are mandatory.
- Do not introduce a light theme, theme toggle, animation framework, component library, or business data.

## TDD and verification

Use `renderToStaticMarkup` from `react-dom/server`; do not add React Testing Library or jsdom in this task.

Write RED tests that assert:

1. All four labels and exact hrefs render in both navigations from the component output.
2. Active route produces `aria-current="page"` in both rendered navs, while inactive routes do not.
3. Skip link and `main-content` target exist.
4. Non-empty warning produces exactly one `role="alert"`; blank/missing warnings produce none.
5. Children render inside the main content region.

Also add a source-level test or focused assertion confirming the exact CSS token values, 720px breakpoint, safe-area usage and 44px touch target. First observe meaningful RED failures, then implement minimally.

Run `npm.cmd test -- src/components/AppShell.test.tsx`, `npm.cmd test`, and `npm.cmd run build`. Record RED evidence, exact GREEN totals, changed files, self-review and concerns in `.superpowers/sdd-responsive-pwa/task-2-report.md`. Return only status plus one-line test/build summary and concerns.
