 # Architecture Cleanup Report — 2026-07-25

 ## Background

 An architecture review of `odds-value-analyzer` identified 7 candidates for
 deepening. Two were verified and executed immediately:

 | # | Candidate | Verdict |
 |---|-----------|---------|
 | C1 | Kill dual recommendation engines | **Strong — executed** |
 | C2 | Strip App god-module of dead card pipeline | **Strong — executed** |
 | C3 | One identity + market vocabulary seam | Worth exploring |
 | C4 | Shared Asian settlement | Worth exploring |
 | C5 | Live-odds adapters: one flat DTO | Worth exploring |
 | C6 | Fence or delete off-path LOO analyzers | Worth exploring |
 | C7 | Split backtest god-module | Speculative |

 ## C1: Kill dual recommendation engines

 ### Problem

 Two parallel "what to buy" pipelines existed:

 - **Live:** `shared/unified-recommendations.mjs` → `evaluateUnifiedOdds` →
   `GET /api/v1/recommendations/current` → `App` → `TodayPage` → `PickCard`
 - **Shadow:** `src/buyCandidates.ts` → `src/buyOpportunities.ts` →
   `src/stakeDisplay.ts` — a client-side selector engine with zero production
   callers, kept alive only by its own unit tests.

 The unified pipeline was cut over as the sole production engine in
 unified-buyable-v1 (2026-07-23). The shadow pipeline was dead code causing:
 duplicated `BUY_EDGE_THRESHOLD = 0.03`, agent confusion, and ~17K of
 unnecessary test maintenance.

 ### Action

 Deleted 8 files (4 modules + 4 test suites):

 - `src/buyCandidates.ts` + `src/buyCandidates.test.ts`
 - `src/buyOpportunities.ts` + `src/buyOpportunities.test.ts`
 - `src/picks.ts` + `src/picks.test.ts`
 - `src/stakeDisplay.ts` + `src/stakeDisplay.test.ts`

 Created ADR 0001: `docs/adr/0001-sole-recommendation-engine-is-unified.md`

 ## C2: Strip App dead card pipeline

 ### Problem

 `App.tsx` (~365 lines) computed `totalCards`, `cornerCards`, and
 `handicapCards` via `useMemo` but never passed them to any child component.
 These three dead computations ran on every render, along with associated
 `useState` stores and `mergeById` calls in `refreshHdcOdds`.

 ### Action

 Removed from `App.tsx`:
 - 3 dead `useMemo` blocks (totalCards, cornerCards, handicapCards)
 - 3 unused `useState` declarations (totalEntries, cornerEntries, handicapEntries)
 - 3 dead `mergeById` calls in `refreshHdcOdds`
 - 3 dead `setState` calls in `clearAuthenticatedState`
 - 3 unused imports (buildTotalsCards, buildHandicapCards, cornerPickLabel, AnalysisRow)

 Net: ~30 fewer lines of runtime work.

 ## Verification

 ```
 Build:  ✓ built in 606ms
 Tests:   23 files / 139 tests passed (384ms)
 ```

 ## Git

 ```
 cd4d847 refactor: remove orphan client recommendation engine + strip dead App cards
  10 files changed, 58 insertions(+), 770 deletions(-)
 ```

 Pushed to `origin/master` (GitHub).

 ## Deployment Status

 ⚠️ **Not yet deployed to production.**

 The deploy tarball has been uploaded to the VM at `/tmp/odds-deploy.tar.gz`.
 To complete deployment, SSH into the VM and run:

 ```bash
 printf '#!/bin/sh\necho <sudo-password-redacted>\n' > /tmp/.ap.sh && chmod +x /tmp/.ap.sh
 export SUDO_ASKPASS=/tmp/.ap.sh
 cd /opt/odds-tool/build
 sudo -A rm -rf *
 sudo -A tar xzf /tmp/odds-deploy.tar.gz
 sudo -A docker compose build api caddy
 sudo -A docker compose up -d api caddy collector
 rm /tmp/.ap.sh /tmp/odds-deploy.tar.gz
 ```

 Verify: `curl -s -o /dev/null -w "%{http_code}" https://odds.ballballchu.com.hk/` → `200`

 ## Remaining Candidates (Priority Order)

 | Priority | Candidate | Action | Risk |
 |----------|-----------|--------|------|
 | Next | C6 — LOO analyzers | Delete or quarantine `totals.ts` / `corners.ts` / `marketCalibration.ts` | Low |
 | After | C3 — Identity forks | Unify 4+ identity functions into one shared module | Medium |
 | After | C4 — Asian settlement | Extract `settleResult` / `settleAsian*` to shared | Medium |
 | Later | C5 — Live-odds DTO | Un-Vite collector, unify flat quote format | Medium |
 | Later | C7 — Backtest split | Split 555-line god module | High |
