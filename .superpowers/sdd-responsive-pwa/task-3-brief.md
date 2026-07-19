# Task 3: Worth-buying Dashboard and all-fixtures integration

## Context

Task 1 supplies `selectBuyOpportunities`; Task 2 supplies `AppShell`. This task integrates the approved product design into the running app. Work in `C:\Users\itadmin\Documents\賭`. No usable Git: do not initialize or commit. Strict TDD, source edits via `apply_patch`, archives and paid APIs untouched.

## Binding behavior

- Default/`#/dashboard` is `值得買`: only fresh, current, pre-match candidates with edge at least exactly `0.03`.
- `#/fixtures` is `全部賽事`: existing four market tabs, complete upcoming/no-pick cards and fixture detail live here.
- Same match is one Dashboard card. Highest edge is primary. Alternatives must not repeat providers for the same market/line.
- Deduplicate candidates within a match by `market + line` (missing line is one key), keeping the pick that wins the existing deterministic pick comparator. Different totals/handicap lines may remain separate alternatives.
- Dashboard order remains edge descending, kickoff ascending, match ID ascending.
- Do not derive candidate eligibility by parsing localized `pickLabel`; adapters use numeric `bestEdge`, `bestChance`, `bestOdds`, `bestBookmaker`, `bestSide` or H2H row fields.
- If data freshness is false, Dashboard has no active opportunities and shows `資料未更新，暫停顯示買盤。`.
- Empty fresh copy is `暫時未有賽事達到 3% Edge。`; include exact link label `查看全部賽事` to `#/fixtures`.

## Files

- Create `src/buyCandidates.ts`, `src/buyCandidates.test.ts`
- Create `src/pages/BuyDashboard.tsx`, `src/pages/BuyDashboard.test.tsx`
- Create `src/pages/AllFixtures.tsx`, `src/pages/AllFixtures.test.tsx`
- Create `src/styles/dashboard.css`
- Modify `src/buyOpportunities.ts`, `src/buyOpportunities.test.ts`
- Modify `src/route.ts`, `src/route.test.ts`
- Modify `src/App.tsx`, `src/main.tsx`

## Adapter interface

Define focused structural input types inside `buyCandidates.ts`; do not couple the adapter to localized labels.

```ts
export function buildBuyCandidates(input: {
  fixtures: Array<{ matchId: string; homeTeam: string; awayTeam: string; commenceTime: string }>;
  h2hRows: Array<{ matchId: string; outcomeLabel: string; bookmaker: string; odds: number; fairProbability: number; edge: number }>;
  totalCards: Array<{ matchId: string; homeTeam: string; awayTeam: string; commenceTime: string; line: number; bestSide: string | null; bestOdds: number; bestChance: number; bestEdge: number; bestBookmaker: string }>;
  cornerCards: same structural fields as totalCards;
  handicapCards: Array<{ matchId: string; homeTeam: string; awayTeam: string; commenceTime: string; line: number; bestSide: string; bestOdds: number; bestChance: number; bestEdge: number; bestBookmaker: string }>;
}): BuyCandidate[];
```

- H2H joins team/kickoff fields from fixtures and uses market `主客和`.
- Totals uses market `大細波` and selection from numeric `bestSide` (`大`/`細`).
- Corners uses market `角球`, converting side to `大角`/`細角`.
- Handicap uses market `亞洲讓球` and side `主`/`客`.
- Preserve line as a number; selector validation performs final fail-closed checks.

## Dashboard interface and content

```tsx
export function BuyDashboard(props: {
  opportunities: BuyOpportunity[];
  generatedAt: string;
  dataFresh: boolean;
}): React.ReactElement;
```

- Header: `值得買 Dashboard`; sync timestamp uses `generatedAt`.
- KPIs: `值得買賽事`, `合資格買盤`, `平均 Edge`, `下一場開賽`.
- All-market view is default. Render filter buttons `全部市場`, `主客和`, `大細波`, `角球`, `亞洲讓球`; selected filter only hides matches without that market and never recalculates qualification/primary pick.
- Each card shows kickoff, teams, primary selection/line, bookmaker, odds, chance and edge; alternatives are compact chips.
- Use numeric formatting helpers and semantic buttons/articles; do not add confidence scores, stake advice or betting execution.

`AllFixtures` is a semantic page wrapper around the existing market tabs and existing complete market content. It owns the title/copy but may receive the existing tab navigation and content as `ReactNode` props to avoid duplicating data logic in this task.

## Routing/integration

- Wrap the application in `AppShell`; remove the old duplicated topbar/page tabs and duplicate Dashboard data-warning alert.
- Initial data loading and refresh effects run on both dashboard and fixtures routes.
- Move existing market tabs and all four existing market views under the fixtures route.
- Support new fixture detail URLs `#/fixtures/:matchId` and link new cards there.
- Legacy `#/dashboard/:matchId` must still open the corresponding fixture detail under the fixtures page, without a reload loop.
- History and analysis/model-health functionality and existing copy remain behaviorally unchanged.
- Import `dashboard.css` after `layout.css` in `main.tsx`.

## Required RED/GREEN coverage

1. Adapter maps numeric H2H/totals/corners/handicap fields correctly and ignores localized pick labels entirely.
2. Selector deduplicates provider duplicates by market+line and keeps the deterministic best pick.
3. Dashboard fresh populated, fresh empty and stale states; exact KPI calculations; one card per match; alternative chips; link to all fixtures.
4. Market filter helper behavior is pure and non-reclassifying; component renders all exact filter labels.
5. AllFixtures wrapper provides correct heading/semantics and renders passed existing content.
6. Route tests cover fixtures detail and legacy dashboard detail behavior.
7. App source/integration test proves `AppShell`, `BuyDashboard`, `AllFixtures` are wired and old topbar/page tabs are gone.

Run focused new/changed tests, `npm.cmd test`, and `npm.cmd run build`. Record RED evidence, exact GREEN totals, changed files, self-review and concerns in `.superpowers/sdd-responsive-pwa/task-3-report.md`. Return only status, one-line results and concerns.
