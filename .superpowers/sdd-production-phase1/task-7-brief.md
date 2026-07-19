# Task 7 Brief: Authenticated Same-Origin PWA Client

## Objective

Move the React/Vite PWA from legacy loopback/static data loading to authenticated same-origin `/api/v1` calls, using the Task 6 server contract.

Keep model thresholds and UI product decisions unchanged:

- `BUY_EDGE_THRESHOLD` remains `0.03`.
- Dashboard remains the first screen for buy-worthy fixtures.
- "All fixtures" remains a separate page.
- Existing lighter responsive dashboard style is preserved.

## Scope

Create:

- `src/apiClient.ts`
- `src/apiClient.test.ts`
- `src/pages/LoginPage.tsx`
- `src/pages/LoginPage.test.tsx`
- `.superpowers/sdd-production-phase1/task-7-report.md`

Modify:

- `src/App.tsx`
- `src/App.test.tsx`
- `src/predictionSnapshots.ts`
- `src/predictionSnapshots.test.ts`
- `src/pwaConfig.test.ts`
- `vite.config.ts` only if service-worker/static-cache tests require it
- `tests/ui/dashboard.spec.ts` if Playwright tests are present and practical

Do not call live providers. Do not mutate archive JSON/JSONL data. Do not remove `public/hkjc-odds.json` in this task unless the migration copy/report story is fully handled and verified.

## API Client Contract

Implement:

```ts
createApiClient(fetchImpl = fetch): {
  session(): Promise<SessionState>;
  login(username: string, password: string): Promise<SessionState>;
  logout(csrfToken: string): Promise<void>;
  liveOdds(): Promise<LiveOddsResponse>;
  results(): Promise<ResultsResponse>;
  backtest(): Promise<BacktestResponse>;
  savePredictions(csrfToken: string, snapshots: PredictionSnapshot[]): Promise<PredictionSaveResponse>;
}
```

Rules:

- Every URL is relative and starts with `/api/v1`.
- No production browser code contains `127.0.0.1:8787`.
- Requests use same-origin credentials.
- Non-2xx responses fail closed with stable errors.
- Invalid JSON fails closed.
- `session()` refreshes in-memory CSRF after reload.
- CSRF header appears only on mutations.
- A 401 clears authenticated UI state.
- Passwords are never stored, logged, or persisted.

## App/Auth Requirements

- On first mount, call `apiClient.session()`.
- While session is loading, show a minimal loading state.
- If unauthenticated, show `LoginPage`.
- Authenticated shell must not mount odds/history/model requests until session succeeds.
- Login form: username/password, generic invalid-login copy, cooldown copy if rate limited, disabled submit while pending.
- Logout calls `/api/v1/auth/logout` with CSRF, then clears UI state.
- PWA offline/failed protected data must fail closed and hide active picks.
- Keep existing pages and dashboard/all-fixtures navigation structure.

## Data Mapping Requirements

Map Task 6 API responses into existing state:

- `/api/v1/odds/live` returns live odds entries. Existing App expects combined H2H/totals/corners/handicap arrays. If Task 6 returns only `{ entries }`, use market filtering/grouping compatible with current row types and document any server-response gap.
- `/api/v1/results` returns `{ resultEntries }`.
- `/api/v1/backtest` returns existing domain backtest shape.
- `/api/v1/predictions` accepts immutable prediction snapshots and returns counts.

Do not duplicate model math. Keep existing `collectPredictionSnapshots` and validation behavior except for API transport.

## Required RED Tests

Add/modify tests to prove:

- `apiClient` uses only relative `/api/v1` URLs and `credentials: "same-origin"`.
- CSRF header is used only for `logout` and `savePredictions`.
- 401/non-2xx/invalid JSON fail closed.
- Login does not persist password.
- `session()` returns refreshed CSRF state.
- Source scan/test fails if `127.0.0.1:8787` appears in `src`.
- App does not load protected odds/backtest before authenticated session.
- 401 clears authenticated UI state.
- Login form pending/invalid/cooldown states are present.
- Service worker does not precache API/data responses.

## Verification Gates

Controller will run:

- `npm.cmd run test`
- `npm.cmd run build`
- `node --test server/app.test.mjs`
- `npm.cmd run server:self-test`
- `npm.cmd run check:data`
- `npm.cmd audit --audit-level=high`
- source scan for `127.0.0.1:8787`, `/hkjc-odds.json` runtime use, wildcard CORS in frontend/server runtime
- archive SHA-256 comparison

If Playwright is practical without extra setup, also update/run `npm.cmd run test:ui:only`. If not, document why.

## Report Requirements

Create `.superpowers/sdd-production-phase1/task-7-report.md` with:

- changed files;
- API client route inventory;
- auth/session/CSRF behavior;
- tests and build results;
- source scan results;
- remaining server-response/frontend-mapping limitations;
- archive hashes unchanged.
