# ADR 0003: Model freeze lifted — parallel model experiments under version labels

**Date:** 2026-08-16  
**Status:** accepted (owner decision, recorded by agent)

## Context

Red line #1 ("模型凍結") previously banned changing weights, Kelly, ROI
definitions, and the 3% edge threshold until each `market + modelVersion`
reached 30 settled distinct matches. The rule protected against overfitting on
small samples, but it also blocked absorbing external research (open-source
Dixon-Coles / Poisson engines, devig calibration methods, Kelly staking
references found on GitHub) into the system.

On 2026-08-16 the owner explicitly lifted the freeze: 「可以取消『模型凍結』紅線」.

## Decision

1. **Freeze lifted for experimentation.** New prediction math (e.g. a
   Poisson / Dixon-Coles expected-goals engine, devig calibration) may be
   developed and recorded.
2. **Existing four models stay byte-for-byte unchanged** (`consensus-v1`,
   `hdc-loo-v2`, `totals-loo-v1`, `corner-loo-v1`). All new math ships under
   **new `modelVersion` labels** and only through `evaluateUnifiedOdds` —
   ADR 0001 (sole unified recommendation engine) still stands. No client-side
   edge calculation (ADR 0002 still stands).
3. **The 30-settled-distinct-matches bar is re-scoped, not deleted**: from
   "permission to change" to "permission to trust". No model — old or new —
   may drive staking decisions or be presented as proven until it clears
   readiness. Readiness is still counted per `market + modelVersion`, one
   settled `fixtureId + market` each.
4. **3% edge threshold stays the default gate.** Any change to it still
   requires explicit per-change owner sign-off; never lower it just to create
   more 推薦.
5. **Training-data infrastructure is additive.** Importing historical
   scorelines for model fitting (new tables / new collectors) does not touch
   archived odds/snapshot data; archive immutability and SHA-256 comparison
   rules are unchanged.

## Consequences

- `unified-sampler` may record observations for additional `modelVersion`
  values; the backtest / performance views already show model versions
  separately, so new engines are comparable against the frozen four.
- 模型實驗自由咗，但「30 場 settled 先至信」嘅紀律變成信任門檻保留落嚟。
- Historical-scoreline imports must follow collector discipline: `--self-test`
  or fixture DB tests, never live-provider calls in tests.
