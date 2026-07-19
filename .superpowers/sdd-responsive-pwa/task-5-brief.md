# Task 5 — Responsive black-box verification and final gate

## Scope

Add deterministic Playwright smoke tests for the production PWA build, then run the full local verification matrix without contacting paid providers or mutating archives.

## Binding requirements

1. Add `@playwright/test`, a minimal `playwright.config.ts`, `tests/ui/dashboard.spec.ts`, and package scripts for UI tests. Prefer installed Chromium/Chrome if available; install only the required Chromium runtime if necessary.
2. Serve the production Vite preview at a fixed localhost port. Browser tests must intercept/mock every app data request (`/hkjc-odds.json`, `http://127.0.0.1:8787/health`, `.../api/hdc-live`, and any backtest/results request they trigger). Do not start collectors and do not call paid providers.
3. Use deterministic future kickoff times and data that produces two qualified picks for one match plus at least one non-qualified fixture. The Dashboard must prove:
   - only worth-buying, fresh, pre-match opportunities appear;
   - one card per match even when it has multiple qualified markets;
   - primary and alternative pick presentation;
   - fixed 3% boundary remains unchanged.
4. Test all three viewports: desktop 1440x900, tablet 820x1180, phone 390x844.
   - primary navigation works;
   - no horizontal document overflow;
   - interactive nav/primary controls are at least 44px in the touch layouts;
   - Fixtures route and fixture detail open correctly;
   - top navigation is used on desktop/tablet and bottom navigation on phone.
5. Cover failure states deterministically:
   - empty but fresh data;
   - stale health response;
   - browser offline event/state hides active opportunities and shows the exact offline warning;
   - failed/unavailable data load shows an understandable state without leaking stale active picks.
6. PWA smoke: built manifest is reachable and service worker registration is present on localhost production preview. Do not require browser install UI.
7. Keep production code changes minimal. Do not add test-only behavior or query switches to the production app. Do not alter model/backend/contracts/threshold/archive.

## TDD/verification workflow

Follow strict RED/GREEN for the Playwright suite. Record intended RED before any product fix; implementation may consist only of tests/config if current UI already passes.

Final fresh gate:

- `npm.cmd run server:self-test`
- `node scripts/odds-monitor.mjs --self-test`
- `node scripts/hkjc-import.mjs --self-test`
- `node scripts/hdc-collector.mjs --self-test`
- `npm.cmd run check:data`
- `npm.cmd test`
- Task 5 Playwright suite
- `npm.cmd run build`
- `npm.cmd audit --omit=dev`
- `npm.cmd audit`

If registry/audit is unavailable, mark it unverified; never auto-fix/update dependencies. Capture archive SHA256 before/after and prove it equals the approved baseline.

## Delivery

Write exact evidence, screenshots/trace locations if generated, tested viewports/states, audit results, archive hashes and changed files to `.superpowers/sdd-responsive-pwa/task-5-report.md`. Keep transient Playwright output out of source control/workspace where practical. Do not create a Git commit.
