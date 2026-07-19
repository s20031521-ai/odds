# Corner result backlog recovery

Hypothesis: four unresolved matches were attempted before statistics became available; once-daily retries delay recovery and snapshot-level readiness inflates four matches to 59 overdue items.

Success: retry unresolved corner results after 12h within existing daily caps; run importer; readiness reports overdue matches separately from snapshot lines.

Independent failures: API calls exceed 90/day or result calls exceed 60/day, same match retries inside 12h, provider still returns no corners, or result rows do not settle all lines.

Ablation: an attempt 11h old stays blocked; 12h old becomes due; one result settles every line for that match.

Evidence: importer self-test RED/GREEN, live importer call/state delta, backtest readiness delta, full tests/build/browser.
