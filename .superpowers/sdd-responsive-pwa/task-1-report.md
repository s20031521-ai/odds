# Task 1 report: canonical buy-opportunity selector

## Status

DONE

## Changed files

- `src/buyOpportunities.ts` — added the canonical threshold, required selector types, defensive candidate validation, grouping, deterministic pick/opportunity sorting, and non-mutating output construction.
- `src/buyOpportunities.test.ts` — added seven selector behavior tests covering threshold boundaries, pre-match filtering, stale data, all four markets and every pick tie-break, opportunity tie-breaks, malformed rows, and input immutability.
- `src/route.ts` — extended `Page` with `fixtures` and made the exact `#/fixtures` route resolve to it while preserving legacy fallbacks/detail parsing.
- `src/route.test.ts` — added fixtures, explicit dashboard, legacy routes, unknown routes, and fixtures-like unknown route coverage.

No archives, provider integrations, paid APIs, or Git state were modified.

## RED evidence

1. Command: `npm.cmd test -- src/route.test.ts`
   - Exit code: 1.
   - Result: 1 failed, 3 passed.
   - Expected failure: `#/fixtures` returned `dashboard` instead of `fixtures`.

2. Command: `npm.cmd test -- src/buyOpportunities.test.ts`
   - Exit code: 1.
   - Initial result: suite load failed because `./buyOpportunities` did not exist.
   - A public-shape-only module returning `[]` was then added so assertions could execute.

3. Command: `npm.cmd test -- src/buyOpportunities.test.ts`
   - Exit code: 1.
   - Meaningful behavioral RED: 5 failed, 2 passed.
   - Expected failures showed the empty implementation omitted threshold-qualified/future/valid candidates, grouping/order, and opportunity sorting.

4. During self-review, an ambiguous fixtures-prefix case was converted into a regression test. Command: `npm.cmd test -- src/route.test.ts`
   - Exit code: 1.
   - Result: 1 failed, 3 passed.
   - Expected failure: unknown `#/fixtures-old` incorrectly resolved to `fixtures`; implementation was narrowed from prefix matching to exact matching.

## GREEN verification

1. Focused command: `npm.cmd test -- src/buyOpportunities.test.ts src/route.test.ts`
   - Exit code: 0.
   - Result: 3 test files passed, 11 tests passed.
   - Vitest also selected the read-only baseline copy at `.superpowers/sdd-responsive-pwa/task-1-base/src/route.test.ts`, accounting for the third file and two additional tests. The two changed suites themselves contain 9 tests.

2. Full command: `npm.cmd test`
   - Exit code: 0.
   - Result: 18 test files passed, 115 tests passed, 0 failures.

3. Build/type command: `npm.cmd run build`
   - Exit code: 0.
   - Result: TypeScript `--noEmit` check passed and Vite production build completed after transforming 1,591 modules.

## Self-review

- `BUY_EDGE_THRESHOLD` is exactly `0.03 as const`; the selector option is typed as that literal threshold.
- Candidate validation rejects blank identity/team/selection/bookmaker fields, non-future or invalid dates, invalid/non-finite odds/chance/edge/line values, and unsupported runtime market values without throwing.
- Stale data returns early with `[]`.
- Each valid candidate is projected into a new `BuyPick`; only internal arrays are sorted, so caller arrays and objects are not mutated.
- Picks sort by edge descending, market ascending via deterministic code-unit comparison, numeric line ascending with missing last, selection ascending, then bookmaker ascending.
- Opportunities sort by primary edge descending, parsed kickoff ascending, then match ID ascending.
- No localized status/pick-label parsing is present.
- Route matching adds only the exact fixtures route; existing history/analysis prefix behavior, dashboard fallback, and fixture-detail decoding remain unchanged.

## Concerns

- No implementation blockers or known correctness concerns.
- The repository's Vitest discovery includes test fixtures under `.superpowers`, so focused and full test totals include the untouched baseline route tests. This did not affect pass/fail behavior but explains the reported counts.
