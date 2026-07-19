# Task 4 TDD report: fail-closed fixture matching

## Scope

- Added `src/fixtureMatch.test.ts`.
- Modified only the matching internals in `src/fixtureMatch.ts`; kept `sameFixture` and `groupByFixture` interfaces unchanged.
- Did not modify archives, snapshot policy, model statistics, thresholds, dependencies, or API integrations.
- No commit was created because this workspace is not a valid Git repository.

## RED

Command:

```powershell
npm.cmd test -- --run src/fixtureMatch.test.ts
```

The first focused run exited 1 with 7 tests: 3 failed and 4 passed. The exact intended failures were:

- `does not match a team name that is only a substring of another`: received `true`, expected `false` for Manchester vs Manchester United.
- `preserves women and men as distinct team identities`: received `true`, expected `false` for Arsenal Women/Chelsea Women vs Arsenal/Chelsea.
- `does not infer the women marker from a W inside another word`: received `true`, expected `false` for AFC Wimbledon/West Brom vs their women's teams.

After strengthening marker coverage, the final pre-implementation RED run exited 1 with 9 tests: 5 failed and 4 passed. In addition to the three failures above:

- `keeps a punctuated standalone W distinct from a men's team`: received `true`, expected `false`.
- `keeps the localized women marker distinct from a men's team`: received `true`, expected `false`.

Before implementation, the accent plus `IF`/`BK` alias at +5 minutes, identical teams at +11 minutes, punctuated `W` matching `Women`/`Ladies`, and an unknown `Utd` alias all already produced their required results.

## Implementation

- Canonicalizes names by removing accents, lowercasing, and tokenizing before punctuation is compacted.
- Detects `women`, standalone `w`, `ladies`, and `\u619f\u553e\u96f2` as women's gender markers before removing tokens.
- Removes only the specified club tokens: `fc`, `afc`, `cf`, `bk`, `if`, and `sk`.
- Compares exact non-empty canonical bases and equal gender markers; substring matching was removed.
- Preserved the existing 10-minute kickoff tolerance and HKJC-preferred grouping behavior.

## GREEN

Focused command:

```powershell
npm.cmd test -- --run src/fixtureMatch.test.ts src/odds.test.ts src/handicap.test.ts
```

Result: exit 0; 3 test files passed and 27 tests passed. This includes the existing HKJC accent/suffix merge.

Full-suite command, run once as requested:

```powershell
npm.cmd test
```

Result: exit 1; 15 test files and all 85 discovered tests passed, but Vitest reported one failed suite because `.superpowers/sdd/task-4-base/fixtureMatch.test.ts` is a zero-byte archived baseline with no test suite. That archive is outside the permitted Task 4 scope and was not changed.

## Concern

The production and focused compatibility tests are green. The repository-wide command remains non-zero solely because Vitest discovers the pre-existing empty archived baseline test file.

## Full-suite rerun after controller cleanup

After the controller removed the accidentally discoverable zero-byte review artifact, the unchanged Task 4 production code was verified again with:

```powershell
npm.cmd test
```

Exact result: exit 0; 15 test files passed and 85 tests passed. No Task 4 production changes were required.

## Review-fix TDD cycle: real `女足` and dotted suffixes

Reviewer findings were reproduced with literal UTF-8 `女足` test data and a dotted `I.F.` / `B.K.` suffix fixture. The pre-existing input-order grouping risk was deliberately left unchanged.

RED command:

```powershell
npm.cmd test -- --run src/fixtureMatch.test.ts
```

Exact RED result: exit 1; 1 test file failed, with 4 failed and 9 passed tests out of 13. The failures were:

- `matches dotted club-suffix acronyms`: received `false`, expected `true`.
- `matches literal 女足 to Women`: received `false`, expected `true`.
- `matches literal 女足 to W.`: received `false`, expected `true`.
- `matches literal 女足 to Ladies`: received `false`, expected `true`.

The separate literal `女足` versus men's-team regression already passed by returning `false`.

Minimal production changes replaced the mojibake marker with literal `女足` and tokenized bounded 2–3 letter dotted acronyms before applying the existing exact club-suffix allowlist.

Matcher GREEN command:

```powershell
npm.cmd test -- --run src/fixtureMatch.test.ts
```

Exact matcher GREEN result: exit 0; 1 test file passed and all 13 tests passed.

Required focused GREEN command:

```powershell
npm.cmd test -- --run src/fixtureMatch.test.ts src/odds.test.ts src/handicap.test.ts
```

Exact focused GREEN result: exit 0; 3 test files passed and all 31 tests passed.

Required full-suite GREEN command:

```powershell
npm.cmd test
```

Exact full-suite GREEN result: exit 0; 15 test files passed and all 89 tests passed.
