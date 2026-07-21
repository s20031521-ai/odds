# Task 4 Report: `PickCard` 精選盤卡（原生 `<details>` 原地展開）

**Branch:** `today-first-phase-a`
**Status:** DONE
**Commit:** `76a0b74 feat: add PickCard with native details expansion`

## What I implemented

- `src/components/PickCard.tsx` — verbatim from the brief:
  - `PickCard` component: native `<details>/<summary>` in-place expansion (SSR-assertable, Playwright-clickable, no JS state, works offline).
  - Collapsed summary: TeamLogo + zh-preferred team names ("阿仙奴 vs 車路士"), kickoff `<time>`, `買：{selection}`, odds, `詳情▾` toggle.
  - Expanded details: Edge %, model vs bookmaker probability comparison, suggested stake via `displayStake`, odds sync time (or `未有成功同步`), alternatives list, `#/fixtures/{encodeURIComponent(matchId)}` analysis link.
  - Exported helpers: `formatSelection`, `formatOdds`, `formatKickoff`; private `formatLine`, `formatPercent`, `pickKey`.
- `src/components/PickCard.test.tsx` — verbatim from the brief (7 tests).

## Tests + results

- Command: `node node_modules/vitest/vitest.mjs run src/components/PickCard.test.tsx`
- Result: **7 passed (7)** in 9ms. Test file: 1 passed (1).

## TDD evidence

**RED** (before implementation existed):
- Command: `node node_modules/vitest/vitest.mjs run src/components/PickCard.test.tsx`
- Output: `FAIL src/components/PickCard.test.tsx` — `Error: Cannot find module './PickCard' imported from .../PickCard.test.tsx:5:1`; 0 tests collected, 1 failed suite.
- Expected because: implementation module did not exist yet — exactly the brief's Step 2 expectation.

**GREEN** (after writing `PickCard.tsx` from the brief):
- Command: same.
- Output: `✓ src/components/PickCard.test.tsx (7 tests) 9ms` — Test Files 1 passed (1), Tests 7 passed (7).

**Commit:** `git add src/components/PickCard.tsx src/components/PickCard.test.tsx && git commit -m "feat: add PickCard with native details expansion"` → `[today-first-phase-a 76a0b74]` (2 files, 163 insertions).

## Files changed

- `src/components/PickCard.tsx` (new)
- `src/components/PickCard.test.tsx` (new)

No other project files touched. Pre-existing working-tree modifications (`.superpowers/sdd/*` docs, `data/*`, `scripts/tmp-*`, `webbridge-req-*`) belong to earlier tasks and were left alone.

## Self-review findings

- Implementation matches the brief's code verbatim; test file matches verbatim.
- Verified dependencies before writing: `BuyOpportunity`/`BuyPick` in `src/buyOpportunities.ts` (untouched, model-freeze respected), `displayStake` in `src/stakeDisplay.ts` (defaults 1000/0.25/0.02 → $20 cap matches test comment), `TeamLogo`/`TeamLogoMap` in `src/components/TeamLogo.tsx`.
- `formatSelection`/`formatOdds`/`formatKickoff`/`pickKey` duplication of SimpleDashboard's private helpers is intentional and owner-approved per the task context.
- Stake math sanity: `displayStake` for chance 0.58 / odds 1.95 → fullKelly = (0.58×1.95−1)/0.95 ≈ 0.1379, ×0.25 ≈ 0.0345, capped at 0.02 → $20 ✓.
- Bookmaker probability: 1/1.95 ≈ 0.5128 → `51.3%` ✓; edge 0.131 → `+13.1%` ✓.
- Per instructions, did not gate on full `tsc --noEmit` (known errors from earlier tasks elsewhere).

## Concerns

None.
