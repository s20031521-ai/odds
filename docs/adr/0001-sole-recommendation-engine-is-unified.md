 # ADR 0001: Sole recommendation engine is unified

 **Date:** 2026-07-25
 **Status:** accepted

 ## Context

 odds-value-analyzer had two parallel "what to buy" pipelines:

 1. **Unified (live):** `shared/unified-recommendations.mjs` → `evaluateUnifiedOdds` →
    `GET /api/v1/recommendations/current` → `App` → `TodayPage` → `PickCard`
 2. **Shadow (orphan):** `src/buyCandidates.ts` → `src/buyOpportunities.ts` →
    `src/stakeDisplay.ts` — a client-side selector engine kept alive only by its
    own unit tests. No production page or component imported it.

 The unified pipeline was cut over as the sole production engine in
 unified-buyable-v1 (2026-07-23). The shadow pipeline remained in the repo as
 dead code, causing:

 - Agent confusion: grep hits in both paths made it unclear which engine was
   authoritative.
 - Duplicated constants: `BUY_EDGE_THRESHOLD = 0.03` existed in both
   `src/buyOpportunities.ts` and `shared/unified-recommendations.mjs`, creating
   a silent divergence risk.
 - Test maintenance burden: 4 test suites (~17K of test code) exercising a
   pipeline with zero production callers.

 ## Decision

 **Delete the shadow client-side recommendation engine.** The sole engine is
 `shared/unified-recommendations.mjs` (`evaluateUnifiedOdds`), consumed via the
 server API. The client is a presentation adapter only.

 ### Deleted modules

 - `src/buyCandidates.ts` + `src/buyCandidates.test.ts`
 - `src/buyOpportunities.ts` + `src/buyOpportunities.test.ts`
 - `src/picks.ts` + `src/picks.test.ts`
 - `src/stakeDisplay.ts` + `src/stakeDisplay.test.ts`

 ## Consequences

 - **Single source of truth** for buy recommendations: `evaluateUnifiedOdds`
   and its `BUY_EDGE_THRESHOLD` in `shared/unified-recommendations.mjs`.
 - **Deletion test passes:** complexity vanishes with no effect on the product.
 - Agents and future contributors cannot accidentally patch the wrong engine.
 - If a client-side selector is ever needed again, it should be rebuilt against
   the shared evaluation interface, not resurrected from git history.
