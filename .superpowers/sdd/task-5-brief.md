### Task 5: Today, professional, match, and history display

**Files:**
- Create: `src/components/BuyableOddsRange.tsx`
- Create: `src/components/BuyableOddsRange.test.tsx`
- Modify: `src/App.tsx`, `src/pages/DashboardPage.tsx`, `src/pages/TodayPage.tsx`, `src/components/PickCard.tsx`, `src/pages/MatchAnalysisPage.tsx`, relevant CSS and tests
- Must not modify: `src/pages/BuyDashboard.tsx`

**Interfaces:**
- App loads `apiClient.currentRecommendations()` after authentication and uses it as the only Today/pro opportunity source.
- `BuyableOddsRange` renders summary and disclosure rows without recalculating model values.

- [ ] **Step 1: Write failing component/page tests**

  Assert summary copy for exact selection/line, sampled min-max, best quote, bookmaker count and timestamp; expanded rows for bookmaker/provider/price/minimum/edge/observed time; explicit same-line warning; stale/empty current response hidden; Today uses server data rather than locally computed candidates; pro mode renders a sibling range panel; match/history links lazy-load observations; and `BuyDashboard.tsx` content hash remains unchanged.

- [ ] **Step 2: Run RED UI tests**

  Run: `npm.cmd test -- src/components/BuyableOddsRange.test.tsx src/pages/TodayPage.test.tsx src/pages/DashboardPage.test.tsx src/pages/MatchAnalysisPage.test.tsx src/App.test.tsx`

- [ ] **Step 3: Implement progressive disclosure**

  Keep the first layer compact: selection/line, sampled range, best, count, evaluated time. Native `<details>` shows exact per-bookmaker thresholds. Match analysis/history fetch observations only on explicit navigation or expansion. Do not infer that a different line is buyable.

- [ ] **Step 4: Remove browser writes for the new strategy**

  Stop the App effect that creates/posts recommendation snapshots. Retain legacy local snapshot helpers only where historical compatibility tests still require them. Map recorded opportunity summaries into the existing `BuyOpportunity` shape solely for the unchanged professional dashboard.

- [ ] **Step 5: Run GREEN tests, build, and commit**

  Run: `npm.cmd test -- src/components/BuyableOddsRange.test.tsx src/pages/TodayPage.test.tsx src/pages/DashboardPage.test.tsx src/pages/MatchAnalysisPage.test.tsx src/App.test.tsx`

  Run: `npm.cmd run build`

  ```powershell
  git add src
  git commit -m "feat: show server-recorded buyable odds ranges"
  ```

