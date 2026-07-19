# Task 3 report: Worth-buying Dashboard and all-fixtures integration

## Status

DONE

## RED evidence

Production code was not edited until the focused tests existed and had been observed failing.

Command:

```text
npm.cmd test -- src/buyCandidates.test.ts src/buyOpportunities.test.ts src/pages/BuyDashboard.test.tsx src/pages/AllFixtures.test.tsx src/route.test.ts src/App.test.tsx
```

Result: exit 1. Vitest reported 6 failed test files; 4 failed and 8 passed tests (12 tests imported). The expected failures were:

- `buyCandidates`, `BuyDashboard`, and `AllFixtures` modules did not exist.
- App did not import or render `AppShell`, `BuyDashboard`, or `AllFixtures`, and still contained the old topbar/page tabs.
- `#/fixtures/:matchId` and legacy `#/dashboard/:matchId` did not resolve under Fixtures.
- provider duplicates for the same match/market/line were not deduplicated.

A later preservation check was also run RED before its production edit:

```text
npm.cmd test -- src/App.test.tsx
```

Result: exit 1, 1 failed / 1 passed. The removed topbar had also removed the standalone History and Analysis headings; the failing source integration assertion captured this regression before the headings were restored outside the old topbar.

## GREEN evidence

Focused domain/component/route GREEN:

```text
npm.cmd test -- src/buyCandidates.test.ts src/buyOpportunities.test.ts src/pages/BuyDashboard.test.tsx src/pages/AllFixtures.test.tsx src/route.test.ts
```

Result: exit 0, 5 test files passed, 20 tests passed.

Focused integration GREEN after wiring:

```text
npm.cmd test -- src/buyCandidates.test.ts src/buyOpportunities.test.ts src/pages/BuyDashboard.test.tsx src/pages/AllFixtures.test.tsx src/route.test.ts src/App.test.tsx
```

Result: exit 0, 6 test files passed, 21 tests passed.

Final focused App preservation GREEN:

```text
npm.cmd test -- src/App.test.tsx
```

Result: exit 0, 1 test file passed, 2 tests passed.

Final full regression suite:

```text
npm.cmd test
```

Result: exit 0, 22 test files passed, 136 tests passed, 0 failed.

Final typecheck and production build:

```text
npm.cmd run build
```

Result: exit 0. TypeScript passed; Vite transformed 1,599 modules and produced the production bundle.

## Changed files

Created:

- `src/buyCandidates.ts`
- `src/buyCandidates.test.ts`
- `src/pages/BuyDashboard.tsx`
- `src/pages/BuyDashboard.test.tsx`
- `src/pages/AllFixtures.tsx`
- `src/pages/AllFixtures.test.tsx`
- `src/styles/dashboard.css`
- `src/App.test.tsx`

Modified:

- `src/buyOpportunities.ts`
- `src/buyOpportunities.test.ts`
- `src/route.ts`
- `src/route.test.ts`
- `src/App.tsx`
- `src/main.tsx`

## Implementation summary

- Added a numeric-field adapter for H2H, totals, corners, and handicap. It does not read localized `pickLabel` values.
- Added fail-closed selection integration at the fixed `0.03` threshold, deterministic match/market/line deduplication, and unchanged opportunity ordering.
- Added the responsive worth-buying Dashboard with fresh populated, fresh empty, and stale states; exact filters, KPIs, one card per match, and compact alternatives.
- Added the semantic All Fixtures wrapper and moved the existing four market tabs/views and fixture detail there.
- Added new Fixtures detail routing and legacy Dashboard-detail compatibility without hash rewrites or reload loops.
- Wrapped all routes in `AppShell`, removed the duplicate topbar/page tabs and duplicate data warning, and preserved standalone History/Analysis headings and their existing content.
- Kept initial load and periodic market/health refresh active on both Dashboard and Fixtures.

## Self-review

- Checked that Dashboard eligibility comes only from numeric fields and `selectBuyOpportunities`, not localized labels.
- Checked that deduplication occurs only within a match and `market + line`, so distinct totals/handicap lines remain available.
- Checked that market filtering returns original opportunities and never promotes/reclassifies alternatives.
- Checked that stale data yields zero active cards and the exact required stale copy.
- Checked that all new fixture links use `#/fixtures/:matchId`, while the legacy route still resolves to Fixtures.
- Checked that History/Analysis JSX remains present and that their lost headings were restored without recreating the old topbar/page tabs.
- Checked that `dashboard.css` is imported after `layout.css`.
- Did not change model formulas, settlement logic, threshold, archives, paid APIs, PWA behavior, or backend scope.

## Concerns

- The workspace Git metadata is intentionally unusable, as stated in the brief, so no Git status/diff/commit evidence is available.
- No live-backend or browser screenshot pass was requested; verification is the focused SSR/source tests, complete 136-test regression suite, TypeScript check, and Vite production build.

## Important findings remediation

### Fixes

1. **Freshness startup is fail-closed.** `dataFresh` now starts `false`. The new `dataFreshFromHealth` helper accepts only an object with `dataFresh: true` and an array `staleSources`; unknown, delayed, null, invalid, stale, or failed health checks remain false. App uses the helper only after the existing successful HTTP/body validation, and the catch path explicitly keeps freshness false.
2. **Opportunities expire at kickoff without unrelated data changes.** `nextCandidateKickoffDelay` finds the next finite future candidate kickoff and returns a one-shot boundary delay of kickoff + 1 ms, capped at the platform-safe timeout maximum. App stores a selector clock in state, schedules one timeout for the next candidate boundary, updates that clock when it fires, and feeds the clock to `selectBuyOpportunities`. It does not add a polling interval.
3. **Fixture detail navigation forces H2H.** `tabForRouteTransition` returns `h2h` for both `#/fixtures/:matchId` and legacy `#/dashboard/:matchId`, while leaving the current tab unchanged for non-detail routes. The App hashchange handler genuinely calls this helper before rendering the selected fixture detail.

### RED evidence

Command:

```text
npm.cmd test -- src/dataHealth.test.ts src/buyOpportunities.test.ts src/route.test.ts src/App.test.tsx
```

Result: exit 1. Vitest reported 4 failed test files; 6 failed and 15 passed tests (21 total). Exact expected failures:

- `dataFreshFromHealth` was undefined.
- `nextCandidateKickoffDelay` was undefined.
- `tabForRouteTransition` was undefined.
- App source still initialized `dataFresh` true.
- App source had no selector clock/one-shot kickoff timer wiring.
- App source did not apply a route-transition helper in the hashchange handler.

### GREEN evidence

Focused command:

```text
npm.cmd test -- src/dataHealth.test.ts src/buyOpportunities.test.ts src/route.test.ts src/App.test.tsx
```

Result: exit 0, 4 test files passed, 21 tests passed.

Full regression command:

```text
npm.cmd test
```

Result: exit 0, 22 test files passed, 142 tests passed, 0 failed.

Build command:

```text
npm.cmd run build
```

Result: exit 0. TypeScript passed; Vite transformed 1,599 modules and produced the production bundle.

### Files modified for remediation

- `src/dataHealth.ts`
- `src/dataHealth.test.ts`
- `src/buyOpportunities.ts`
- `src/buyOpportunities.test.ts`
- `src/route.ts`
- `src/route.test.ts`
- `src/App.tsx`
- `src/App.test.tsx`
- `.superpowers/sdd-responsive-pwa/task-3-report.md`

### Remediation self-review

- Freshness cannot become true before a validated health response explicitly reports true.
- Health fetch failures and invalid bodies leave Dashboard opportunities fail-closed.
- The kickoff helper ignores invalid/past times, schedules only the nearest future boundary, and safely re-schedules very distant kickoffs after a maximum-duration one-shot timer.
- The selector uses stateful runtime time rather than `Date.now()` hidden inside a memo.
- Detail transitions reset only the Fixtures analysis tab; Dashboard, Fixtures index, History, and Analysis route behavior remains unchanged.

## Stale selector-clock remediation

### Root cause and fix

The first kickoff timer used `selectionNow` both to calculate its delay and as an effect dependency. If wall-clock time advanced while there were no candidates, then a candidate arrived, the candidate-change effect calculated its timer from the old selector clock. A 12:05 candidate added at 12:04 could therefore receive a five-minute delay calculated from 12:00.

`candidateSelectionRuntime` now packages one fresh `now` value with the delay derived from that exact value. On every `buyCandidates` change, App calls it with `Date.now()`, updates the selector clock from `runtime.now`, and schedules the boundary using `runtime.nextDelay`. The effect depends only on `buyCandidates`, so its clock update does not create an effect loop. Its one-shot callback refreshes the runtime again, which also preserves safe re-scheduling for timeout-capped distant kickoffs.

### RED evidence

Command:

```text
npm.cmd test -- src/buyOpportunities.test.ts src/App.test.tsx
```

Result: exit 1. Vitest reported 2 failed test files; 2 failed and 14 passed tests (16 total). Exact expected failures:

- The fake-timer runtime regression found `candidateSelectionRuntime` undefined after advancing from 12:00 to 12:04 and adding a 12:05 candidate.
- The App source integration assertion found no fresh candidate-change runtime wiring and still found the stale `nextCandidateKickoffDelay(buyCandidates, selectionNow)` / `[buyCandidates, selectionNow]` effect pattern.

### GREEN evidence

Focused command:

```text
npm.cmd test -- src/buyOpportunities.test.ts src/App.test.tsx
```

Result: exit 0, 2 test files passed, 16 tests passed.

The fake-timer regression advances time to 12:04 before adding the candidate, verifies a 60,001 ms delay from the addition time, keeps the opportunity through 12:05:00.000, and verifies its removal at 12:05:00.001 without changing the candidate array.

Full regression command:

```text
npm.cmd test
```

Result: exit 0, 22 test files passed, 144 tests passed, 0 failed.

Build command:

```text
npm.cmd run build
```

Result: exit 0. TypeScript passed; Vite transformed 1,599 modules and produced the production bundle.

### Files modified for this remediation

- `src/buyOpportunities.ts`
- `src/buyOpportunities.test.ts`
- `src/App.tsx`
- `src/App.test.tsx`
- `.superpowers/sdd-responsive-pwa/task-3-report.md`
