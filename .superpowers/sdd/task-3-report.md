# Task 3 Report: `displayStake` 注碼顯示 helper

## What was implemented
- `src/stakeDisplay.ts` — display-only Kelly staking helper, verbatim from the brief:
  - `StakeSettings` type (`bankroll`, `fractionalKelly`, `stakeCapPercent`)
  - `DEFAULT_STAKE_SETTINGS` = `{ bankroll: 1000, fractionalKelly: 0.25, stakeCapPercent: 0.02 }` (frozen mirror of analyzer defaults)
  - `displayStake(pick, settings?)`: validates inputs (odds > 1, 0 < chance ≤ 1), computes full Kelly `(chance*odds-1)/(odds-1)`, clamps negative to 0, applies fractional Kelly, caps at `stakeCapPercent`, returns `Math.round(bankroll * fraction)` (integer amount).
- `src/stakeDisplay.test.ts` — the brief's 6 test cases, verbatim.
- `src/buyOpportunities.ts` NOT touched (model freeze red line respected); `BuyPick` imported as type only.

## Tests + results
- Command: `node node_modules/vitest/vitest.mjs run src/stakeDisplay.test.ts`
- Result: **6 passed (6)** in one test file.

## TDD evidence
- **RED** (Step 2): `node node_modules/vitest/vitest.mjs run src/stakeDisplay.test.ts`
  - Output: `FAIL src/stakeDisplay.test.ts — Error: Cannot find module './stakeDisplay' imported from .../src/stakeDisplay.test.ts`; `Test Files 1 failed (1)`, `Tests no tests`.
  - Expected because `src/stakeDisplay.ts` did not yet exist.
- **GREEN** (Step 4): same command
  - Output: `✓ src/stakeDisplay.test.ts (6 tests) 2ms` — `Test Files 1 passed (1)`, `Tests 6 passed (6)`.

## Files changed
- Created `src/stakeDisplay.ts` (new)
- Created `src/stakeDisplay.test.ts` (new)
- Commit: `2c176f6 feat: add displayStake helper for pick cards` (2 files changed, 59 insertions)

## Self-review findings
- Implementation and tests copied verbatim from the brief; all expected values verified by the passing suite (cap case → 20, below-cap case → 10, negative edge → 0, invalid inputs → 0, custom bankroll 5000 → 50, defaults object equality).
- Input guard uses `!(pick.odds > 1) || !(pick.chance > 0) || !(pick.chance <= 1)` which also rejects `NaN`, matching the brief exactly.
- `git status` shows only pre-existing unrelated modifications (`.superpowers/sdd/*`, untracked data/scripts files from other work); my commit contains only the two intended files.
- Not gated on full `tsc --noEmit` per instructions (known pre-existing errors elsewhere).

## Concerns
- None. Task 4 `PickCard` can now consume `displayStake(primary)`.
