# Subagents Odds Tool Development Plan

> **For Hermes:** 用 subagent-driven workflow 繼續開發，但每個 agent 只做一條窄任務。Ponytail rule: fewest files, no new dependency unless existing stack/native做唔到。

**Goal:** 用 sub agents 將 `odds-value-analyzer` 繼續開發成可驗證、可監控、少返工嘅賭波賠率工具。

**Current repo:** `C:\Users\itadmin\Documents\Codex\2026-07-06\new-chat\work\odds-tool`

**Tech Stack:** Vite, React 19, TypeScript, Vitest, Node script monitor, The Odds API.

**Current architecture observed:**
- UI main file: `src/App.tsx`
- 1X2 core math: `src/odds.ts`, tests `src/odds.test.ts`
- corners model: `src/corners.ts`, tests `src/corners.test.ts`
- hash route helpers: `src/route.ts`, tests `src/route.test.ts`
- API throttle: `src/apiThrottle.ts`, tests `src/apiThrottle.test.ts`
- monitor daemon: `scripts/odds-monitor.mjs`, config `monitor.config.json`

---

## Working rule

唔好叫一個 subagent「繼續開發成完整系統」。太大，會亂改。

用一個 lead agent 做整合，其他 leaf subagents 每次只做一件事：

1. read exact files
2. make smallest diff
3. add or update one runnable check
4. run `npm test` and `npm run build`
5. return changed files, commands, output, remaining risk

---

## Agent lanes

| Lane | Subagent job | Owns | Cannot do |
|---|---|---|---|
| Product/triage | 將想做嘅功能切成最細 ticket | `.hermes/plans/*` | 不改 production code |
| Domain math | 1X2, Kelly, margin, corners model | `src/odds.ts`, `src/corners.ts`, matching tests | 不碰 UI layout |
| API/import | The Odds API parsing, throttle, quota, error states | `src/App.tsx` API section, `src/apiThrottle.ts`, tests | 不改 staking formula |
| Monitor/alerts | CLI monitor, config validation, alert output | `scripts/odds-monitor.mjs`, `monitor.config.json`, small self-check/tests if added | 不碰 React UI |
| UI/dashboard | dashboard display, navigation, forms | `src/App.tsx`, `src/styles.css`, route tests if needed | 不改 domain math |
| Review gate | Check diff, security, tests, YAGNI | whole diff | 不直接 implement unless asked |

---

## Default development loop

### Step 1. Lead agent creates one narrow task

Template:

```text
Task: <one behavior only>
Scope: <exact files allowed>
Success: <observable result>
Failure signal: <independent thing that proves it is wrong>
Verification: npm test && npm run build
Ponytail constraints: no new dependencies, no speculative config, shortest correct diff.
```

### Step 2. Dispatch implementation subagent

Use `delegate_task` with full context. Example prompt:

```text
You are implementing one narrow change in this repo:
C:\Users\itadmin\Documents\Codex\2026-07-06\new-chat\work\odds-tool

PONYTAIL MODE: smallest root-cause diff. No new dependency. Reuse existing patterns.

Task: <task>
Allowed files: <paths>
Read these first: <paths>
Required checks: npm test && npm run build
Return:
- changed files
- why this is root-cause/minimal
- exact command output
- any skipped work and when to add it
```

### Step 3. Dispatch review subagent after implementation

```text
Review this latest diff only.
Check:
1. Does it satisfy the stated task?
2. Did it touch files outside scope?
3. Any betting/math/security/data-loss issue?
4. Any unnecessary abstraction/dependency/config?
5. Are tests meaningful and minimal?
Return approve/block with exact file:line issues.
```

### Step 4. Lead agent verifies locally

Run:

```bash
npm test
npm run build
git diff --stat
git diff -- src scripts package.json monitor.config.json
```

Only then commit.

---

## Suggested next subagent batches

### Batch A. Stabilize before adding features

#### A1. Monitor config validation

**Why:** `scripts/odds-monitor.mjs` trusts JSON shape. Bad config can silently behave wrong.

**Agent:** Monitor/alerts

**Scope:**
- `scripts/odds-monitor.mjs`
- optional `scripts/odds-monitor.test.mjs` only if npm test can run it cheaply, otherwise add small exported pure helpers only if necessary

**Success:** invalid `pollSeconds`, missing `watchlist`, bad operator fail with clear error.

**Ponytail skip:** no schema library. Add zod only if config grows beyond simple checks.

#### A2. Extract Odds API parser from `App.tsx`

**Why:** API parsing inside UI is harder to test and easy to break.

**Agent:** API/import

**Scope:**
- `src/App.tsx`
- create `src/oddsApi.ts`
- create `src/oddsApi.test.ts`

**Success:** parser handles valid h2h response, skips incomplete bookmakers, preserves quota handling in UI.

**Ponytail skip:** no API client class. Pure parser function only.

#### A3. App smoke build guard

**Why:** UI is mostly in `App.tsx`; build catches TypeScript/JSX regressions.

**Agent:** Review gate or UI/dashboard

**Scope:** no code unless a real failing build exists.

**Success:** `npm test` and `npm run build` clean.

---

### Batch B. Make dashboard more useful without rebuilding system

#### B1. Persist manual entries in localStorage

**Why:** manual data disappears on refresh, but full backend is overkill.

**Agent:** UI/dashboard

**Scope:**
- `src/App.tsx`
- maybe `src/storage.ts` + `src/storage.test.ts` if parsing/validation is non-trivial

**Success:** entries survive reload; corrupt localStorage falls back to sample/empty without crash.

**Ponytail skip:** no database/backend yet. Add backend only when multiple devices/users need shared state.

#### B2. Watchlist editor from current config shape

**Why:** `monitor.config.json` exists, but editing JSON manually is friction.

**Agent:** UI/dashboard or Monitor/alerts, not both at once.

**Scope:** start with UI-only export/copy JSON, not file write.

**Success:** user can create one totals alert rule and copy JSON matching `monitor.config.json`.

**Ponytail skip:** no Electron/server file writer. Add when we actually need one-click save.

---

### Batch C. Betting model improvements, one model at a time

#### C1. Asian handicap or totals parser, not both

**Why:** current app does 1X2 and corners. Add one market only after parser is separated.

**Agent:** Domain math

**Scope:** new pure file + tests, then UI after math passes.

**Success:** model has deterministic examples and does not contaminate 1X2 code.

**Ponytail skip:** no generic market engine. Add generic engine only after 3 markets share real duplicated code.

#### C2. Backtest/import historical CSV

**Why:** better edge validation, but only useful after current data model is stable.

**Agent:** Spike first

**Scope:** throwaway script or one `scripts/backtest.mjs` with fixture data.

**Success:** can run one sample CSV and produce ROI/strike-rate summary.

**Ponytail skip:** no charting/dashboard until numbers prove useful.

---

## Coordination rules

- Never run two agents editing `src/App.tsx` at same time.
- Safe parallel work:
  - Domain math agent on `src/odds.ts` or `src/corners.ts`
  - Monitor agent on `scripts/odds-monitor.mjs`
  - UI agent on `src/App.tsx`
  only if their files do not overlap.
- Every agent returns exact command output. Self-reported “tests pass” is not enough.
- Lead agent owns final merge and verification.
- Commit one task at a time. No mega commits.

---

## Immediate recommended order

1. A2 Extract Odds API parser from `App.tsx`.
2. A1 Add minimal monitor config validation.
3. B1 Persist manual entries in localStorage.
4. B2 Add watchlist JSON generator.
5. Only then consider new betting markets.

Reason: parser/test seam first. Without it, every feature makes `App.tsx` bigger and riskier.

---

## Done criteria for each task

- [ ] Diff is limited to scoped files.
- [ ] No new dependency unless explicitly justified.
- [ ] At least one meaningful test/self-check for non-trivial logic.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] Reviewer approved or blocker fixed.
- [ ] Skipped work is named with “add when” trigger.
