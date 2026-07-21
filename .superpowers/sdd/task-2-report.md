# Task 2 Report: AppShell nav labels 改名

## Status: DONE_WITH_CONCERNS (one minor, non-blocking type note — see Concerns)

## What was implemented

Renamed the four AppShell navigation items to the new Today-first routes/labels,
in the exact order and values specified by the brief:

| route     | href          | label |
|-----------|---------------|-------|
| today     | `#/today`     | 今日  |
| fixtures  | `#/fixtures`  | 賽程  |
| analysis  | `#/analysis`  | 分析  |
| history   | `#/history`   | 紀錄  |

The expected array in `AppShell.test.tsx` was updated to the same values first
(TDD RED), then the component was changed (GREEN).

## TDD evidence

### RED (Step 1–2)

Changed `src/components/AppShell.test.tsx:7-12` expected array to the new
`#/today 今日 / #/fixtures 賽程 / #/analysis 分析 / #/history 紀錄` values.

Command:
```
node node_modules/vitest/vitest.mjs run src/components/AppShell.test.tsx
```

Result: **FAIL — 2 failed | 9 passed (11)**, exactly as expected:
- `renders every exact route and label in both labelled navigations` —
  `expected [] to have a length of 2 but got +0` at line 45 (no `#/today`
  anchors exist yet; old labels `值得買/全部賽事/完場紀錄/模型健康` no longer match).
- `marks only the active route current in both navigations` —
  same `+0` anchors failure at line 55.

Failure is expected because the component still rendered the old
`#/dashboard 值得買` nav; the new href/labels were not yet implemented.

### GREEN (Step 3–4)

Changed `src/components/AppShell.tsx:5-10` `navigationItems` to the brief's
verbatim block (`Object.freeze([...] as const)` with route `today` first).

Command:
```
node node_modules/vitest/vitest.mjs run src/components/AppShell.test.tsx
```

Result: **PASS — Test Files 1 passed (1), Tests 11 passed (11)**
(`✓ src/components/AppShell.test.tsx (11 tests) 12ms`, Vitest v4.1.10).

### Commit (Step 5)

```
77da717 feat: rename nav labels to 今日/賽程/分析/紀錄
2 files changed, 8 insertions(+), 8 deletions(-)
```

Only `src/components/AppShell.tsx` and `src/components/AppShell.test.tsx`
were staged and committed, per the brief's exact `git add` command.

## Files changed

- `src/components/AppShell.tsx` — `navigationItems` rewritten (lines 5–10).
- `src/components/AppShell.test.tsx` — expected `navigationItems` array
  rewritten (lines 7–12).

`git show HEAD` diff verified: changes are byte-for-byte the brief's specified
values; no other hunks.

## Self-review findings

1. Diff matches the brief verbatim — order (today → fixtures → analysis →
   history), hrefs, and labels all correct. ✔
2. Scope respected: only the two permitted files touched; Playwright
   `dashboard.spec.ts` label updates deliberately left for Task 11. ✔
3. All 11 tests in the focused file pass, including the unrelated CSS/token
   contract tests — no collateral damage. ✔
4. `tsc --noEmit` was not run / not gated on, per task context. ✔
5. Working tree otherwise untouched (pre-existing untracked data/script files
   remain unstaged). ✔

## Concerns

- **Stale route names in the test helper (minor, non-blocking):**
  `AppShell.test.tsx:15` still types `renderShell` as
  `route: "dashboard" | "fixtures" | "history" | "analysis"` with default
  `"dashboard"`, and two call sites pass `"dashboard"`. Since Task 1 narrowed
  `Page` to `"today" | "fixtures" | "analysis" | "history"`, `tsc` will flag
  this test file (`"dashboard"` not assignable to `Page`). Vitest does not
  type-check, so the suite passes, and the brief's Step 1 explicitly scoped the
  test change to the expected array only — so I left it as instructed. Runtime
  behavior is unaffected (a non-matching route simply renders no
  `aria-current`, which none of the assertions depend on). Suggest a later
  task sweep the `"dashboard"` route references in test/helpers when pages are
  renamed.
