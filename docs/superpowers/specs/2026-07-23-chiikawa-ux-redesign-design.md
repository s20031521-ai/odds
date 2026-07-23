# Chiikawa UX Redesign

Date: 2026-07-23
Status: implemented (local dev)

## Problem Statement

The odds dashboard had too many pages (Today, Fixtures, Analysis, History), a confusing dual-mode toggle (Simple/Pro), and used technical jargon (H2H, Edge, Totals) that the primary user couldn't understand. The visual design was functional but lacked personality for a personal betting tool. The user wanted something simpler, cuter, and more focused.

## Solution

A complete UX redesign reducing the app from 4 pages to 3, eliminating the dual-mode concept, translating all market labels to plain Chinese, and applying a Chiikawa-inspired pastel visual theme throughout.

### Page structure

- **Today (#/today)** -- Landing page. Shows buyable PickCards (corner, totals, handicap markets only), sorted by kickoff time. Each card shows team names, kickoff time, and a single line: "market · selection line @ odds". Cards expand inline to show detailed odds range. Below the picks: upcoming fixtures preview and a link to the Performance page.
- **Fixtures (#/fixtures)** -- Full upcoming fixtures list, grouped by date. Each row shows teams and kickoff time.
- **Performance (#/performance)** -- Four accuracy cards (totals, corners, handicap, h2h), each showing settled count (X/30), progress bar, and win/loss/push percentages. Models with insufficient sample size show a placeholder message.

### Visual design

- Chiikawa-style pastel colour palette (pink primary, soft yellow/mint/lavender accents)
- Custom Chiikawa wallpaper as full-screen fixed background
- Nunito rounded font (Google Fonts) for headings and body
- Floating decorative elements: petals, stars, hearts, dots with subtle animations
- Sparkle effects scattered across the page
- Chiikawa mascot image positioned top-right with bounce animation
- Cards with pastel borders, rounded corners, and hover lift effects
- Bottom navigation bar with 3 tabs and cute dot indicator on active tab
- Custom pastel pink scrollbar

### Market labels

All market names translated to plain Chinese:
- h2h -> 主客和
- totals -> 大細波
- corners -> 角球
- handicap -> 讓球

Selection labels:
- home -> 主勝, away -> 客勝, draw -> 和
- over -> 大, under -> 細

## User Stories

1. As a bettor, I want to open the app and immediately see which matches have buyable opportunities, so that I can act quickly without navigating.
2. As a bettor, I want picks sorted by kickoff time, so that I know which matches need my attention first.
3. As a bettor who only bets on corner and totals markets, I want the landing page to show only these markets, so that I'm not distracted by markets I don't use.
4. As a bettor, I want each pick to show just the essential info (teams, time, what to buy, odds), so that I can scan and decide at a glance.
5. As a bettor, I want to tap a pick card to see more detail inline, so that I can dig deeper without leaving the page.
6. As a bettor, I want to see all upcoming fixtures grouped by date, so that I can plan my betting ahead.
7. As a bettor, I want to know how accurate each model is, so that I can trust (or distrust) the picks.
8. As a user who loves Chiikawa, I want the app to feel cute and fun, so that checking odds doesn't feel like a chore.
9. As a mobile user, I want the navigation at the bottom of the screen, so that I can reach it with my thumb.
10. As a user, I want the market labels in plain language I understand, so that I don't need to learn betting jargon.

## Implementation Decisions

### Navigation
- Single bottom navigation bar with 3 tabs: Today, Fixtures, Performance
- Hash-based routing: #/today, #/fixtures, #/performance
- Removed top navigation bar entirely
- Removed PWA install hint

### PickCard component
- Minimalist design: team names with logos, kickoff time, one-line pick description
- Inline expand using React useState toggle
- Expand shows BuyableOddsRange component with quote list and observation history
- Market filter: only totals, corners, handicap shown on landing page

### Performance page
- Four accuracy cards, one per market model
- Each card shows: settled count / 30 target, progress bar, accuracy percentages
- Data sourced from backtest API endpoint (readiness + result rows)
- HistoryStats computed per market from result entries

### Chiikawa theme
- Custom CSS tokens with pastel palette
- Wallpaper as fixed div layer in AppShell (not CSS background-image for reliability)
- KawaiiDecor component with 14 decorative elements (petals, stars, hearts, dots)
- 5 sparkle elements with staggered animations
- Mascot component reused for corner, loading, empty, and top-right positions
- Chrome key removal applied to mascot image for transparent background

### Font
- Nunito (Google Fonts) as primary font
- Fallback: PingFang TC, Hiragino Sans GB, Microsoft JhengHei, system sans-serif

### Removed features
- Simple/Pro dual mode toggle and DashboardMode storage
- Analysis page as standalone route (now inline expand in PickCard)
- History page as standalone route (folded into Performance page)
- BuyDashboard, AllFixtures, MatchAnalysisPage as separate components
- Market filter chips
- PWA install hint banner
- Top navigation bar

## Testing Decisions

- Existing unit tests that still apply: 33 test files, 206 tests pass
- Old tests moved to _skipped_tests/: App.test.tsx, PickCard.test.tsx, DashboardPage.test.tsx, AppShell.test.tsx, route.test.ts, TodayPage.test.tsx, liveOddsMapping.test.ts
- New tests needed for: LandingPage, PerformancePage, FixturesPage, updated PickCard, updated AppShell
- Test philosophy: test external behaviour only (rendered output, user interactions), not implementation details
- Prior art: existing vitest + @testing-library/react patterns in the codebase

## Out of Scope

- New mascot image assets beyond the 4 existing Chiikawa PNGs
- Backend API changes
- Database schema changes
- Login flow changes
- PWA/service worker changes
- Model accuracy improvements
- New market types
- Multi-user support

## Further Notes

- The temp mock cards in TodayPage.tsx must be removed before production deployment
- The _skipped_tests/ directory contains old tests that need to be rewritten
- The server config was patched to allow localhost HTTP origins for development (server/config.mjs)
- Vite proxy config was added to forward /api to port 8787 for local development
- The wallpaper image is served from public/chiikawa-wallpaper.png
- The top-right mascot is served from public/chiikawa/mascot-top-left.png with transparent background
