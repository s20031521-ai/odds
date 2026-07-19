# Task 2 report: adaptive application shell and soft-night design system

## Status

DONE_WITH_CONCERNS

## Changed files

- `src/components/AppShell.tsx` — added the required typed `AppShell`, one frozen navigation config, shared top/bottom navigation rendering, active-route semantics, skip link, focusable main region, optional alert, and child content slot.
- `src/components/AppShell.test.tsx` — preserved the nine inherited server-render/source-level contract tests. Added one scoped `@ts-expect-error` on the `node:fs` import because the app intentionally has no Node type dependency while Vitest executes tests in Node.
- `src/styles/tokens.css` — added the nine exact soft-night design tokens.
- `src/styles/layout.css` — added the centered 1440px shell, adaptive navigation, phone safe-area spacing, 44px targets, visible focus, alert styling, reduced-motion override, and responsive breakpoint behavior.
- `src/main.tsx` — imported `tokens.css` and `layout.css` before the existing feature stylesheet.
- `src/styles.css` — changed only root/global compatibility rules to consume the new background/text tokens, retain the system font stack, and prevent horizontal page overflow; existing feature selectors remain in place for Task 3.
- `.superpowers/sdd-responsive-pwa/task-2-report.md` — added this handoff report.

No libraries were added. No archives, provider/data logic, Dashboard business logic, Git state, or unrelated feature selectors were changed.

## Inherited RED evidence

The RED cycle was completed by the prior implementer and handed off with the tests and public-shape stub intact. I inspected and preserved that suite before completing GREEN.

1. Command: `npm.cmd test -- src/components/AppShell.test.tsx`
   - Exit code: 1.
   - Result: 7 failed, 2 passed across 9 tests.
   - Meaningful expected failures: the public-shape-only component did not yet render both complete navigations, active-route state, the skip-link target, a non-empty warning alert, or children inside the main region; `tokens.css` and `layout.css` were also absent.
   - The two expected passes were the exported component/public shape and the absence of an alert for blank or missing warnings.

This evidence is inherited from the task handoff rather than re-created after implementation; the original tests were not weakened or replaced.

## GREEN verification

Fresh final verification was run after the last source/test adjustment.

1. Focused command: `npm.cmd test -- src/components/AppShell.test.tsx`
   - Exit code: 0.
   - Result: 1 test file passed, 9 tests passed, 0 failures.

2. Full command: `npm.cmd test`
   - Exit code: 0.
   - Result: 18 test files passed, 122 tests passed, 0 failures.

3. Build command: `npm.cmd run build`
   - Exit code: 0.
   - Result: TypeScript `--noEmit` passed; Vite production build completed after transforming 1,593 modules.

An earlier GREEN build check exposed `TS2307` for the test-only `node:fs` import because `@types/node` is not installed. The runtime tests were already passing. The final, dependency-free correction kept the filesystem assertions and applied a single import-level expected-error annotation; the focused suite, full suite, and build then passed.

## Self-review

- The public signature matches the brief and returns `React.ReactElement`.
- The exact four route/label entries live in one `Object.freeze(...)` config and both navigation surfaces are generated through the same component/map.
- Both navigations have distinct accessible labels, exact hash anchors, and only the active route receives `aria-current="page"`.
- The skip link points to `#main-content`; the matching `main` is focusable with `tabIndex={-1}`.
- A trimmed non-empty warning renders one alert outside both navigation elements; blank/missing warnings render none.
- Child content is inside the main content region.
- All exact token values are defined and consumed by the shell/global rules.
- Desktop/tablet defaults show the top navigation and hide the bottom navigation. At `max-width: 720px`, those states reverse and the fixed bottom navigation plus content padding include `env(safe-area-inset-bottom)`.
- Navigation targets use `min-height: var(--touch-target)`; visible `:focus-visible`, reduced-motion, semantic alert, centered max-width, and horizontal-overflow rules are present.
- No light theme, theme switcher, animation/component framework, business data, or Dashboard migration was introduced. The shell remains ready for the later migration task.

## Concerns

- The CSS behavior is contract-tested at source level as requested, not exercised in a real browser at multiple viewports in this task.
- `AppShell.test.tsx` has one narrow `@ts-expect-error` for `node:fs`. This avoids adding the prohibited/unnecessary Node type dependency while retaining real filesystem assertions, but it should be removable if the project later adopts Node types or excludes tests from the production TypeScript build.

## Reviewer follow-up: active-navigation contrast

The reviewer identified that normal/mobile active-navigation text used `--color-text` (`#f6f7ff`) over `--color-primary` (`#7c83c8`), approximately 3.31:1 and below the required 4.5:1 contrast ratio. This was corrected with a strict RED/GREEN regression cycle.

### RED

- Changed lines: `src/components/AppShell.test.tsx:96-104` added a focused source-contract test that isolates `.app-navigation a[aria-current="page"]` and requires both `color: var(--color-bg);` and the existing `background: var(--color-primary);`.
- Command: `npm.cmd test -- src/components/AppShell.test.tsx`
- Exit code: 1.
- Result: 1 test failed, 9 passed across 10 tests.
- Expected failure: the isolated active-navigation rule contained `color: var(--color-text);` instead of `color: var(--color-bg);`; its primary background assertion already passed.

### GREEN

- Changed line: `src/styles/layout.css:52` changed only the active-navigation foreground from `var(--color-text)` to `var(--color-bg)`; line 53 retained `background: var(--color-primary)`.
- Command: `npm.cmd test -- src/components/AppShell.test.tsx`
- Exit code: 0.
- Result: 1 test file passed, 10 tests passed, 0 failures.

### Build

- Command: `npm.cmd run build`
- Exit code: 0.
- Result: TypeScript `--noEmit` passed; Vite production build completed after transforming 1,593 modules.

No Minor report wording/token-consumption changes or other production behavior were included in this follow-up.
