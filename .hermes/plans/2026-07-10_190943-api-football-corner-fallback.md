# API-Football corner-result fallback

## Baseline read set
- Source of truth: `scripts/hkjc-import.mjs`, `data/result-archive.jsonl`, API-Football `/fixtures` and `/fixtures/statistics`.
- Boundary: keep HKJC as odds/match owner; API-Football may only add missing final corner totals.
- Compatibility: no new dependency; Node fetch and existing JSONL archive.
- Verification: importer `--self-test`, live API probe/import, `/api/backtest`, full tests, build.

## Hypothesis
API-Football can match a completed HKJC fixture using English team names plus kickoff time and supply home/away `Corner Kicks`, allowing a durable `角球` result row without changing HKJC odds snapshots.

## Success
- Parser maps a matched API-Football fixture/statistics payload to the existing `{matchId, market:"角球", actual:"N 角球"}` row.
- Existing HKJC corner result wins on duplicate ID; fallback only fills missing rows.
- Live key authenticates and fixture coverage can be measured.
- Existing importer/test/build remain green.

## Independent failure signals
- API key rejected or quota unavailable.
- No API-Football fixture match for HKJC English team names/kickoff.
- Fixture exists but `Corner Kicks` statistics are absent.
- Import removes or rewrites existing archive rows.

## Ablation expectations
- No `API_FOOTBALL_KEY`: HKJC import behaves exactly as before.
- API key present but no fixture match: zero fallback rows, no fabricated result.
- One valid matched fixture with both teams' corners: one corner result using the summed total.

## Evidence plan
1. Probe API account and dated fixtures with the real key without printing it.
2. Add one failing self-test for fixture matching/stat extraction.
3. Implement the smallest fallback and run self-test green.
4. Run live import, inspect archive/result counts, then run backend self-test, project tests, and build.
