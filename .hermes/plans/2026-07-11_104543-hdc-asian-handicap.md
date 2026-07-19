# HDC 亞洲讓球 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 加入 HKJC HDC 與 The Odds API spreads 同盤比較、買入判斷、snapshot 及完場 settlement。

**Architecture:** 新增一個聚焦 `handicap.ts` 模組處理 line parsing、跨來源賽事配對、value card 與 settlement。Importer/API parser 只負責輸出一致 HDC entry；App 負責顯示及保存 snapshot；backend settlement 重用相同 Asian split semantics。

**Tech Stack:** TypeScript, React, Vitest, Node.js，零新 dependency。

## Global Constraints

- 只做 HDC，不做 HHA。
- 只有同賽事、同盤口可比較。
- 冇跨莊同盤資料就 `資料不足，唔買`。
- edge 必須達到現有 `settings.edgeThreshold`。
- 所有歷史判斷只用 immutable snapshot。

---

### Task 1: HDC domain logic

**Files:**
- Create: `src/handicap.ts`
- Create: `src/handicap.test.ts`

**Interfaces:**
- `HandicapEntry { id, matchId, homeTeam, awayTeam, homeTeamEn?, awayTeamEn?, commenceTime, bookmaker, line, homeOdds, awayOdds }`
- `parseHandicapLine(value: string | number): number | null`
- `settleAsianHandicap(side: "主" | "客", line: number, homeGoals: number, awayGoals: number): AsianSettlement | null`
- `buildHandicapCards(entries, edgeThreshold): HandicapCard[]`

- [ ] Write tests for `-1.5/-2.0 -> -1.75`, `0.0/+0.5 -> 0.25`, invalid values, whole/half/quarter settlement, same-line grouping and threshold.
- [ ] Run `npm test -- src/handicap.test.ts --run`; expect RED because module is absent.
- [ ] Implement minimum line parser, settlement and market-consensus card builder using existing no-vig probability pattern.
- [ ] Run targeted test; expect PASS.

### Task 2: Import HKJC HDC and The Odds API spreads

**Files:**
- Modify: `scripts/hkjc-import.mjs`
- Modify: `src/oddsApi.ts`
- Modify: `src/oddsApi.test.ts`

**Interfaces:**
- `public/hkjc-odds.json.handicapEntries: HandicapEntry[]`
- `parseOddsApiHandicaps(payload): HandicapEntry[]`

- [ ] Add RED assertions for HKJC `HDC` combinations `H/A`, English team names and quarter-line parsing.
- [ ] Add RED Vitest cases for `spreads` home/away point normalization.
- [ ] Add `HDC` to HKJC GraphQL enum arrays and emit `handicapEntries`.
- [ ] Request `h2h,totals,spreads` and parse spread entries without changing existing parsers.
- [ ] Run importer self-test and `src/oddsApi.test.ts`; expect PASS.

### Task 3: Dashboard, snapshots and backtest

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/predictionSnapshots.ts`
- Modify: `src/predictionSnapshots.test.ts`
- Modify: `server.mjs`

**Interfaces:**
- Dashboard tab key `handicap`, label `亞洲讓球`.
- Snapshot market `亞洲讓球`, prediction `主` or `客`, line from home perspective, modelVersion `hdc-market-v1`.
- Result actual stores final score; settlement uses snapshot side and line.

- [ ] Add RED snapshot/server self-test for HDC win, half-win, push, half-loss and loss.
- [ ] Load/merge HKJC and Odds API handicap entries in App.
- [ ] Render HDC cards, enforcing same fixture/same line and `edgeThreshold`.
- [ ] Save only HKJC cards with a real buy decision.
- [ ] Extend backend settlement for market `亞洲讓球`.
- [ ] Run targeted tests and server self-test; expect PASS.

### Task 4: Live verification and log

**Files:**
- Modify: `docs/prediction-log.md`
- Modify: `.hermes/plans/2026-07-11_104543-hdc-asian-handicap.md`

- [ ] Run `npm run import:hkjc`; confirm HDC rows exist.
- [ ] Run `npm test -- --run`, `npm run build`, server/importer/monitor self-tests.
- [ ] Browser smoke `#/dashboard`: 亞洲讓球 tab loads, cards show matched value or honest no-buy, console has zero JS errors.
- [ ] Probe `/api/backtest` and confirm existing summaries do not regress.
- [ ] Update prediction log with actual row counts and evidence.
- [ ] Mark every plan checkbox complete only after fresh evidence.
