# Task 1: Canonical buy-opportunity selector

## Context

This is the first task in the approved responsive Dashboard/PWA phase. It creates the pure, localized-string-independent selector that later UI tasks consume. Work in `C:\Users\itadmin\Documents\賭`. There is no usable Git repository, so do not commit and do not initialize Git. Follow strict RED/GREEN TDD and use `apply_patch` for source edits.

## Global constraints

- The buy threshold is exactly `0.03`; export `BUY_EDGE_THRESHOLD = 0.03 as const` and do not make it user-adjustable.
- Only pre-match, finite, valid candidates may be selected.
- When `dataFresh` is false, return no opportunities.
- Same match produces one opportunity. Primary pick is highest edge; remaining picks are alternatives.
- Opportunity sort: primary edge descending, kickoff ascending, `matchId` ascending.
- Pick sort within a match: edge descending, market ascending, numeric line ascending with missing line last, then selection ascending, then bookmaker ascending.
- Do not parse status from localized labels such as `pickLabel.startsWith("買")`.
- Do not touch archives or call paid providers.

## Files

- Create `src/buyOpportunities.ts`
- Create `src/buyOpportunities.test.ts`
- Modify `src/route.ts`
- Modify `src/route.test.ts`

## Required interfaces

```ts
export const BUY_EDGE_THRESHOLD = 0.03 as const;
export type BuyMarket = "主客和" | "大細波" | "角球" | "亞洲讓球";
export type BuyPick = {
  market: BuyMarket;
  selection: string;
  line?: number;
  odds: number;
  chance: number;
  edge: number;
  bookmaker: string;
};
export type BuyCandidate = BuyPick & {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
};
export type BuyOpportunity = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  primary: BuyPick;
  alternatives: BuyPick[];
};
export function selectBuyOpportunities(
  candidates: BuyCandidate[],
  options: { now: number; edgeThreshold: typeof BUY_EDGE_THRESHOLD; dataFresh: boolean },
): BuyOpportunity[];
```

Valid candidates require non-empty identity/team/selection/bookmaker strings, parseable future `commenceTime`, `0 < chance <= 1`, finite `edge >= edgeThreshold`, finite `odds > 1`, and a finite numeric line when line is present. Malformed rows are excluded without throwing. Do not mutate input arrays or objects.

Extend route type to `"dashboard" | "fixtures" | "history" | "analysis"`. `#/fixtures` resolves to fixtures; empty, unknown and `#/dashboard` resolve to dashboard. Existing history/analysis and dashboard fixture-detail parsing remain compatible.

## Required RED/GREEN coverage

1. Exactly `0.03` included; `0.029999` excluded.
2. Commence time equal to or before `now` excluded.
3. `dataFresh: false` returns `[]`.
4. All four markets can group under one match; primary and alternatives follow deterministic ordering.
5. Opportunity tie breaks follow kickoff then match ID.
6. Invalid odds/chance/edge/line/date and blank identity fields are excluded.
7. Inputs remain deeply equal after selection.
8. Route coverage for fixtures and all legacy routes.

Run focused tests and then `npm.cmd test`. Record exact commands, observed RED reason, GREEN totals and concerns in `.superpowers/sdd-responsive-pwa/task-1-report.md`. Return status `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED` plus one-line test summary.
