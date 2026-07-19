# Task 7 Report: Authenticated Same-Origin PWA Client

## Scope

Implemented the frontend migration from legacy browser runtime data paths to the secure same-origin `/api/v1` contract from Task 6.

Created:

- `src/apiClient.ts`
- `src/apiClient.test.ts`
- `src/pages/LoginPage.tsx`
- `src/pages/LoginPage.test.tsx`
- `src/liveOddsMapping.test.ts`

Modified:

- `src/App.tsx`
- `src/App.test.tsx`
- `src/predictionSnapshots.ts`
- `src/predictionSnapshots.test.ts`
- `src/components/AppShell.tsx`
- `tests/ui/dashboard.spec.ts`

No archive JSON/JSONL data, model threshold, provider quota, DNS, VM filesystem, or production secret was changed.

## API Client Route Inventory

All browser runtime routes are relative same-origin `/api/v1` routes with `credentials: "same-origin"`:

- `GET /api/v1/session`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/odds/live`
- `GET /api/v1/results`
- `GET /api/v1/backtest`
- `POST /api/v1/predictions`

Legacy runtime paths removed from production frontend source:

- `http://127.0.0.1:8787/*`
- `/hkjc-odds.json`
- `/api/backtest`
- `/api/hdc-live`
- `/api/predictions`

`public/hkjc-odds.json` remains in place as existing migration/static data, but it is no longer read by the runtime app.

## Auth, Session, and CSRF Behavior

- App calls `apiClient.session()` on first mount.
- Protected odds/history/model requests do not start until the session is authenticated.
- Unauthenticated users see `LoginPage`.
- Login form keeps username/password only in component state, disables submit while pending, clears password after submit, and displays generic invalid/offline/cooldown messages.
- CSRF is in memory only.
- CSRF header is sent only on mutation routes: logout and prediction save.
- Logout calls `/api/v1/auth/logout` when a CSRF token exists, then clears UI state.
- Protected `401` responses clear authenticated UI state and return to login.
- Passwords are not stored in localStorage/sessionStorage.

## Live Odds Mapping

`src/App.tsx` now normalizes live odds payloads before writing UI state.

Supported shapes:

- Already-grouped arrays: `entries`, `totalEntries`, `cornerEntries`, `handicapEntries`, `resultEntries`.
- Flat provider rows under `entries`, grouped by `matchId`, market, line, and bookmaker.

Supported flat market aliases:

- `主客和` / `h2h`
- `大細波` / `totals`
- `角球` / `alternate_totals_corners` / `corners`
- `亞洲讓球` / `spreads`

Malformed flat rows are dropped rather than coerced into state.

## Fix Found During Playwright Verification

Initial Playwright migration revealed a real freshness-gate bug:

- The app authenticated successfully and loaded same-origin live odds, but `dataFresh` could remain false because the old health timing path did not recompute after the new HKJC/HDC load-state updates.
- Added a failing regression test in `src/App.test.tsx`.
- Fixed by recomputing `dataFresh` whenever `dataLoads` changes.
- Re-ran Vitest/build/Playwright successfully.

## Playwright Migration

`tests/ui/dashboard.spec.ts` now mocks the new API contract and explicitly fails if the app touches:

- `/hkjc-odds.json`
- `http://127.0.0.1:8787/**`

Covered in four viewport projects:

- authenticated dashboard buy-worthy picks;
- guest login and login POST body;
- responsive nav/touch/detail flow;
- empty and failed live data fail closed;
- protected `401` returns to login;
- backtest failure safe display;
- logout with CSRF;
- production PWA manifest and service worker.

## Verification

Final controller verification:

- `npm.cmd run test` — 25 files / 149 tests passed.
- `npm.cmd run build` — passed, production bundle generated.
- `npm.cmd run test:ui:only` — 32 Playwright tests passed.
- `node --test server/app.test.mjs` — 2/2 passed.
- `npm.cmd run server:self-test` — passed.
- `npm.cmd run check:data` — passed: 183 snapshots, 853 results, 0 late snapshots, 0 duplicate keys, 180 legacy missing `commenceTime` rows still classified as legacy/invalid as before.
- `npm.cmd audit --audit-level=high` — found 0 vulnerabilities.

Source scan:

- Runtime frontend source has no `127.0.0.1:8787`, `/hkjc-odds.json`, `/api/backtest`, `/api/hdc-live`, or `/api/predictions`.
- Remaining matches are tests/config guards and server legacy-denylist tests.

Archive SHA-256 values unchanged:

- `data/prediction-snapshots.jsonl`: `E55625769E4560B524773BD4A8C2884EFF236540AFC63B2187F3FAE7696617BA`
- `data/result-archive.jsonl`: `DF9B758D5EA22BA656B97B3C78F366F3120EBC4D6BFDA6F535AE0CE94DFBA424`
- `data/background-hdc-snapshots.jsonl`: `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`
- `data/background-result-archive.jsonl`: `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`
- `public/hkjc-odds.json`: `2B33822E22AEF9C112287C56613401774592313DE047DC5FF16699D8BBF2EB8E`

## Known Minor Debt / Limitations

- `public/hkjc-odds.json` is still present as an existing artifact, but no longer used by runtime browser code.
- `handleLogout()` skips the server logout call if the in-memory CSRF token is unexpectedly empty, then clears local UI state. This is defensive and was reviewed as minor only.
- `server.mjs` still contains old legacy code below its Task 6 early handoff; normal package execution enters `server/entry.mjs`.
