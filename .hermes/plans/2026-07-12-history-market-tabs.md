# History Market Tabs Implementation Plan

**Goal:** Split 完場對比 into 主客和／角球／大細波／亞洲讓球 tabs and show selected-market win/loss percentages at the top right.

**Hypothesis:** Filtering the existing canonical backtest rows by market and deriving summary percentages from settled comparable rows will make the page readable without changing storage or backend contracts.

**Success:** Each tab shows only its market; top-right displays 中/錯 percentages; pushes are listed separately and excluded from the percentage denominator; comparable/all remains scoped to the selected market.

**Independent failure signals:** A tab leaks another market; rows without snapshots affect percentages; zero settled rows render NaN; browser console errors; existing tests/build fail.

**Ablation expectation:** Without the market filter helper, mixed rows remain. Without the stats helper, tabs work but no reliable percentages appear.

**Evidence plan:** RED/GREEN focused Vitest, full `npm test`, `npm run build`, browser click-smoke all four tabs and console check.

## Tasks

- [ ] Add failing tests for market filtering and hit/miss/push percentage summary.
- [ ] Add minimal pure helpers in `src/marketDisplay.ts`.
- [ ] Wire market tabs, scoped comparable/all counts, and right-aligned summary into `src/App.tsx`.
- [ ] Add minimal responsive CSS in `src/styles.css`.
- [ ] Run full verification and update `docs/prediction-log.md`.
