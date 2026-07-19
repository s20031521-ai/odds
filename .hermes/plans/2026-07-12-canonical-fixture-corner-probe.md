# Canonical fixture matching and corner market probe

## Hypothesis
English normalized home/away names plus kickoff within 10 minutes can merge HKJC and The Odds API safely. The Odds API event endpoint may expose corner markets for matched soccer events.

## Success
- Same fixture with different provider IDs renders once and prefers HKJC ID for settlement.
- Different or non-Latin empty-normalized names never merge accidentally.
- One bounded live corner request records status, cost, bookmakers and parsed rows.

## Failure signals
- Reversed teams or fixtures over 10 minutes apart merge.
- Existing snapshots lose HKJC settlement IDs.
- Corner request exceeds 20 credits or collector starts polling unavailable markets.

## Ablation
- Without English normalization: accented/suffix variants stay separate.
- Without kickoff bound: same-team fixtures on another date can merge.

## Evidence
Focused RED/GREEN tests, importer/collector/server self-tests, full tests/build, one live event request, browser smoke.
