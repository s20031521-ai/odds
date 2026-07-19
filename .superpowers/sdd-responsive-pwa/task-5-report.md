# Task 5 report — Responsive black-box verification and final gate

Date: 2026-07-16 (Asia/Shanghai)

## Outcome

- Added deterministic Playwright production-preview coverage using the locally installed Google Chrome. No Playwright browser runtime was downloaded.
- All application data requests are intercepted locally. The suite never starts a collector or contacts a paid odds provider.
- Fixed one black-box accessibility regression found by the RED run: legacy fixture market buttons were 38px tall on touch layouts; they now use the shared 44px touch-target token.
- Kept `BUY_EDGE_THRESHOLD` and model/backend/archive contracts unchanged.

## TDD evidence

### RED 1

Command: `npm.cmd run test:ui`

- Production PWA build completed.
- 11/15 Playwright cases passed.
- Genuine product failure: tablet `.market-tabs button` measured 38px; test required at least 44px.
- Two additional workers lost their Chrome process while three local Chrome instances were launched concurrently. Root-cause evidence was the Playwright browser process log, not a UI assertion.

Minimal changes:

- `.market-tabs button { min-height: var(--touch-target); }`
- `workers: 1` in Playwright config to execute the three deterministic viewport projects sequentially.

### RED 2 / test correction

- The 44px check passed after the product fix.
- Three navigation cases timed out because the test asked for `模型分析`; the AppShell single source of truth labels that route `模型健康`.
- Corrected only the test locator. No product behavior changed.

### GREEN

Command: `npm.cmd run test:ui:only`

- 15/15 passed in 8.5s, then the final fresh run passed 15/15 in 7.9s.
- The final successful run cleaned earlier failure screenshots/traces from the configured transient output directory. Only `.superpowers/sdd-responsive-pwa/playwright-output/.last-run.json` remains.

### Runner-integration regression

The first full `npm.cmd test` run found that Vitest was also discovering `tests/ui/dashboard.spec.ts`. The 157 assertions it had already executed passed, but Playwright's `test.beforeEach` cannot run inside Vitest. `vite.config.ts` now explicitly scopes Vitest to `src/**/*.test.{ts,tsx}`. The fresh rerun passed 135/135 tests in 22 files.

## Browser coverage

Projects:

- Desktop: 1440×900, top navigation.
- Tablet: 820×1180, top navigation.
- Phone: 390×844, safe-area bottom navigation.

Deterministic mocked dataset:

- `match-value`: two qualified markets for one match. The Dashboard proves one card per match, highest-edge primary pick and one alternative pick.
- `match-boundary`: a leave-one-out total priced at exactly 3.00%; it remains included.
- `match-below`: a leave-one-out total at 2.99%; it remains excluded from the Dashboard but appears in all fixtures.
- All kickoffs use `2030-07-17T12:00:00.000Z`, so every intended candidate is deterministically pre-match.

Verified in every viewport:

- Dashboard only exposes fresh, pre-match, edge-qualified opportunities.
- No duplicate match cards.
- Primary and alternative pick presentation.
- Exact 3% threshold behavior.
- No horizontal document overflow on Dashboard or fixture detail.
- Correct top/bottom navigation breakpoint.
- Visible touch-layout navigation, filters and market controls are at least 44px tall.
- Dashboard → all fixtures → fixture detail → history → model health → Dashboard navigation.
- Empty/fresh zero state.
- Stale health fail-closed state.
- Browser offline event/state hides active picks and shows exactly: `目前離線；已隱藏值得買機會，連線後會自動恢復。`
- Failed HKJC/HDC/health responses show the data-freshness warning and expose no active picks.
- Manifest is reachable, uses `display: standalone`, and a service-worker registration is present on localhost production preview.

Mocked endpoints:

- `/hkjc-odds.json`
- `http://127.0.0.1:8787/health`
- `http://127.0.0.1:8787/api/hdc-live`
- `http://127.0.0.1:8787/api/backtest`
- `http://127.0.0.1:8787/api/predictions`

Any other request to the app backend pattern throws `Unmocked app data request` instead of reaching a network service.

## Final fresh gate

| Gate | Result |
|---|---|
| `npm.cmd run server:self-test` | passed |
| `node scripts/odds-monitor.mjs --self-test` | passed |
| `node scripts/hkjc-import.mjs --self-test` | passed |
| `node scripts/hdc-collector.mjs --self-test` | passed |
| `npm.cmd run check:data` | passed |
| `npm.cmd test` | 22 files, 135/135 passed |
| `npm.cmd run build` | passed; PWA generated 9 precache entries |
| `npm.cmd run test:ui:only` | 15/15 passed |
| `npm.cmd audit --omit=dev` | 0 vulnerabilities |
| `npm.cmd audit` | 0 vulnerabilities |

`check:data` evidence:

- snapshots: 183
- results: 853
- late snapshots: 0
- duplicate snapshot keys: 0
- duplicate result keys: 0
- negative scores: 0
- missing `commenceTime`: 180 legacy/backfilled rows
- snapshot quality: 3 valid-current, 93 legacy, 87 invalid

Generated service-worker inspection:

- Forbidden precache text found: none for `/api/`, `hkjc-odds.json`, or `127.0.0.1:8787`.
- `runtimeCaching` remains empty in source config.
- Manifest output retains standalone display, Dashboard start URL and the 192/512/maskable icons.

## Archive proof

Before and after the Task 5 gates:

| Archive | Length | SHA256 | Approved baseline match |
|---|---:|---|---|
| `data/prediction-snapshots.jsonl` | 42,922 | `E55625769E4560B524773BD4A8C2884EFF236540AFC63B2187F3FAE7696617BA` | yes |
| `data/background-hdc-snapshots.jsonl` | 0 | `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855` | yes |

## Changed files

- `package.json`
- `package-lock.json`
- `playwright.config.ts`
- `tests/ui/dashboard.spec.ts`
- `src/styles.css`
- `vite.config.ts`
- `.superpowers/sdd-responsive-pwa/task-5-report.md`

Installed dev dependency: `@playwright/test@1.61.1`.

No Git commit was created.

## Remaining limitations

- Current statistical readiness still has only three valid-current snapshots; the UI/PWA work does not increase model evidence.
- Production authentication, PostgreSQL, VM collectors, HTTPS/reverse proxy and backups are deliberately outside this UI phase and belong to the follow-on production deployment plan.

## Final reviewer-finding remediation (2026-07-16)

### Outcome

- `lastSuccessfulSync` now starts as `null`, is passed into the connectivity state, and changes only after a successful HKJC or HDC response has been consumed. It remains disclosure-only and never bypasses online, health, or source-load gates.
- The Dashboard shows `未有成功同步` until one of those real data loads succeeds.
- HKJC and HDC load status is tracked independently from `/health`. Active opportunities require online status, fresh health, successful HKJC load, and successful HDC load. A later fresh health response cannot revive retained picks after either source fails.
- Source failures have a visible alert and compose with the existing health warning when both fail.
- Dashboard geometry is one column at 820x1180 portrait, two columns at 1180x820 landscape, multi-column at 1440x900 desktop, and one column at 390x844 phone.
- Phone History market/filter controls and visible secondary buttons use the shared 44px touch-target token.
- Added a past, deliberately high-edge fixture and proved it never reaches the Dashboard.
- Added direct black-box assertions that `match-value` presents the highest-edge `主客和 · 客勝` / Book B / 23.29% pick as primary and `大細波 · 大 +2.5 · 17.14%` as the next-ranked alternative.

### Strict TDD RED

Focused unit/integration command before production edits:

`npm.cmd test -- src/dataHealth.test.ts src/pages/BuyDashboard.test.tsx src/App.test.tsx`

- Exit 1: 4 intended failures, 16 passing.
- Missing behaviors: exported per-source load transition/readiness/warning helpers, nullable sync disclosure, and App source-load/sync wiring.

Browser RED against the unchanged production build:

`npm.cmd run test:ui:only`

- Exit 1: 14 failed, 14 passed across 28 cases.
- Tablet portrait cards measured x=24 and x=418, proving the incorrect two-column layout.
- Phone secondary button measured 36px instead of 44px.
- Failed initial loads had no `未有成功同步` disclosure.
- Fresh health plus independent HDC/HKJC failures produced no visible source warning and could retain active picks.
- The new past-fixture and explicit primary/alternative ordering assertions already passed, so no selector/model change was made.

### GREEN progression

- Focused unit/integration GREEN: 3 files, 20/20 passed.
- First rebuilt browser run: 23/28 passed. All new product behavior passed except the all-failed case needed to retain the existing health warning alongside the source warning; the phone History class locator also resolved no elements despite the six accessible buttons being present.
- After composing both warnings: 27/28 passed. The final remaining failure was only the class-based History test locator.
- Corrected the History test to assert exactly six accessible buttons and measure all six; focused phone Playwright passed 1/1.

### Final fresh verification

- Focused Vitest: `npm.cmd test -- src/dataHealth.test.ts src/pages/BuyDashboard.test.tsx src/App.test.tsx` — 3/3 files, 20/20 tests passed.
- Full Vitest: `npm.cmd test` — 22/22 files, 139/139 tests passed.
- Full Playwright: `npm.cmd run test:ui:only` — 28/28 passed across desktop, tablet portrait, tablet landscape, and phone in 13.4s.
- Production build: `npm.cmd run build` — TypeScript and Vite passed; 1,600 modules transformed; PWA generated 9 static precache entries.

### Archive proof after final gates

| Archive | Length | SHA256 | Approved baseline match |
|---|---:|---|---|
| `data/prediction-snapshots.jsonl` | 42,922 | `E55625769E4560B524773BD4A8C2884EFF236540AFC63B2187F3FAE7696617BA` | yes |
| `data/background-hdc-snapshots.jsonl` | 0 | `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855` | yes |

### Files changed for this remediation

- `src/App.tsx`
- `src/App.test.tsx`
- `src/dataHealth.ts`
- `src/dataHealth.test.ts`
- `src/pages/BuyDashboard.tsx`
- `src/pages/BuyDashboard.test.tsx`
- `src/styles.css`
- `src/styles/dashboard.css`
- `tests/ui/dashboard.spec.ts`
- `playwright.config.ts`
- `.superpowers/sdd-responsive-pwa/task-5-report.md`

No model, threshold, backend, API contract, dependency, policy, or archive was changed. No Git commit was created.

## Final tablet touch-target follow-up (2026-07-16)

The final whole-phase review found that History market/filter buttons and visible secondary buttons still inherited a 36px height at the 820x1180 and 1180x820 tablet viewports because the shared 44px override was limited to `max-width: 720px`.

### RED

The responsive Playwright case was first broadened so tablet portrait, tablet landscape, and phone all assert:

- the visible empty-state secondary button is at least 44px high;
- History contains exactly six accessible market/filter buttons;
- every one of those six buttons is at least 44px high.

Soft assertions were used so one undersized group could not prevent measuring the other.

Command:

`npm.cmd run test:ui:only -- --project=tablet --project=tablet-landscape --grep "responsive navigation"`

- Exit 1: 2/2 projects failed as expected.
- Tablet portrait: secondary button measured 36px and all six History buttons measured 36px.
- Tablet landscape: secondary button measured 36px and all six History buttons measured 36px.

### GREEN

The shared touch-target override for `.history-market-tabs button`, `.history-filters button`, and `.secondary-button` now applies through `max-width: 1180px`. The 1440px desktop remains outside this override and retains its compact styling.

- Focused touch Playwright: tablet portrait, tablet landscape, and phone passed 3/3.
- Focused Vitest: `src/components/AppShell.test.tsx`, `src/pages/BuyDashboard.test.tsx`, and `src/App.test.tsx` passed 27/27.
- Full Vitest: 22/22 files and 139/139 tests passed.
- One first full Playwright attempt had an unrelated desktop-only service-worker registration poll timeout; the same PWA case passed immediately in isolation and had already passed in the other three projects. No PWA code was changed.
- Fresh full Playwright rerun: 28/28 passed in 13.8s.
- Final production build: TypeScript and Vite passed; 1,600 modules transformed; PWA generated 9 static precache entries.

Files changed in this follow-up:

- `tests/ui/dashboard.spec.ts`
- `src/styles.css`
- `.superpowers/sdd-responsive-pwa/task-5-report.md`

No desktop layout, model, threshold, backend, API, dependency, policy, or archive behavior changed. No Git commit was created.
