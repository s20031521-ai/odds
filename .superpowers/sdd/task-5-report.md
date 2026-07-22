# Task 5 implementation report

Status: **DONE**

Commit: `640d8a5 feat: show server-recorded buyable odds ranges`

## Outcome

- `App` fetches authenticated `currentRecommendations()` and makes the recorded response the sole Today/pro opportunity source.
- Removed the browser effect that called `savePredictions`; legacy snapshot conversion helpers remain only for compatibility.
- Added `BuyableOddsRange` with exact selection/line, sampled min-max, best quote, bookmaker count, evaluation time, same-line warning, and native `<details>` per-bookmaker rows.
- Each bookmaker row displays the server-provided provider, sampled odds, minimum buy odds, edge, and observed time. The UI formats values but does not derive chance, edge, threshold, or model output.
- Added explicit, lazy observation loading for match analysis and History. The loaded timeline displays every batch, its buyable quotes, empty batches, fingerprint, and audit inputs.
- Today cards consume recorded API opportunities directly. The professional dashboard receives only a compatibility mapping from recorded summaries and remains unchanged; a sibling current-range panel exposes the richer server data.
- Failed/offline current state supplies an empty active list to Today, pro, fixture markers, and match analysis. Post-kickoff match analysis also hides current buyable ranges.

## TDD evidence

Baseline before changes:

- `npm.cmd run test -- src/pages/TodayPage.test.tsx src/pages/DashboardPage.test.tsx src/pages/MatchAnalysisPage.test.tsx src/App.test.tsx`
- Result: 4 files, 30 tests passed.

RED evidence:

- Required five-file command initially failed: four suites could not import the missing `BuyableOddsRange`; three App source-contract assertions failed because current recommendations/lazy observations/server-only flow did not exist.
- Build integration exposed missing/extra page props. A new App regression assertion failed 14/15 before the wiring fix.
- Professional adapter regression failed 1/8 before the adapter was made testable and stopped duplicating the selection line.
- Offline/stale active-list regression failed 14/15 before recorded opportunities were gated for every current display.
- Full observation timeline regression failed 4/5 before batch quotes and audit inputs were rendered.

GREEN evidence on final code:

- Exact required command:
  `npm.cmd run test -- src/components/BuyableOddsRange.test.tsx src/pages/TodayPage.test.tsx src/pages/DashboardPage.test.tsx src/pages/MatchAnalysisPage.test.tsx src/App.test.tsx`
  Result: 5 files, 40 tests passed.
- Full Vitest regression: `npm.cmd run test`
  Result: 39 files, 253 tests passed.
- Production verification: `npm.cmd run build`
  Result: TypeScript passed; Vite transformed 1616 modules and built successfully.
- `git diff --check` passed.

## Files committed

- `src/App.tsx`, `src/App.test.tsx`
- `src/components/BuyableOddsRange.tsx`, `src/components/BuyableOddsRange.test.tsx`
- `src/components/PickCard.tsx`, `src/components/PickCard.test.tsx`
- `src/pages/DashboardPage.tsx`, `src/pages/DashboardPage.test.tsx`
- `src/pages/TodayPage.tsx`, `src/pages/TodayPage.test.tsx`
- `src/pages/MatchAnalysisPage.tsx`, `src/pages/MatchAnalysisPage.test.tsx`
- `src/styles/today.css`
- `src/testFixtures/recordedOpportunity.ts`

## Red-line proof

- `Get-FileHash src/pages/BuyDashboard.tsx -Algorithm SHA256`
  returned `2157936DE9247CBC38417B572792FC440B721C01AB5442F269758E570355689A`, identical to the pre-task hash.
- `git diff d855c87 -- src/pages/BuyDashboard.tsx` returned no output.
- `BuyableOddsRange.test.tsx` locks the same SHA-256 as a regression test.
- No new provider, dependency, model value, threshold, secret, or browser unified write was added.
- `.superpowers` scratch files and `package-lock.json` were not staged or committed.

## Self-review / concerns

No open Critical or Important concerns. The native disclosure keeps the first layer compact, and the complete audit payload is fetched only after an explicit user expansion.

## Review fixes

Commit: `1f53d60 fix: refresh and normalize recorded recommendations`

- Added one canonical market mapping for `h2h`/`totals`/`corners`/`handicap` and the legacy Chinese labels. Unified result rows, pending rows, labels, and readiness now remain visible while legacy rows stay compatible.
- Pending unified samples now expose the same lazy observation timeline as settled History rows.
- Current recommendations now load immediately and refresh every three minutes. Empty server batches replace the previous list, refresh failures fail closed, polling continues for recovery, overlapping requests are skipped, and cleanup ignores late responses.

Review-fix TDD evidence:

- Market mapping RED: 8 expected failures; GREEN: 19/19.
- Pending observation wiring RED: 1 expected source-contract failure; GREEN after explicit callback wiring.
- Scheduler RED: missing module; GREEN fake-timer coverage: 2/2 for three-minute empty replacement, fail-closed error notification, and continued polling.
- Focused mapping/scheduler/App tests: 3 files, 37 tests passed.
- Exact Task 5 UI regression: 5 files, 41 tests passed.
- Full Vitest regression: 40 files, 264 tests passed.
- Production verification: TypeScript passed; Vite transformed 1617 modules and built successfully.
- `git diff d855c87 -- src/pages/BuyDashboard.tsx` remains empty and its SHA-256 remains `2157936DE9247CBC38417B572792FC440B721C01AB5442F269758E570355689A`.
