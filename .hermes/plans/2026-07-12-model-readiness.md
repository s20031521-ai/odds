# Model readiness improvement plan

Hypothesis: snapshot-level readiness makes the Analysis page useful before performance samples mature.

Success: each market/model shows snapshot, settled/pending, odds/chance completeness, source and prediction balance; legacy/current stay separate.

Independent failure signals: pending is counted as settled, missing odds appear complete, one-sided predictions are not flagged, or the browser calls a paid provider.

Ablation: removing a result increases pending by one; removing odds decreases priced by one; adding one-sided predictions raises dominant share.

Evidence: server self-test, frontend helper tests if needed, full tests/build, browser smoke, paid-request count.
