# Task 5 reviewer findings to fix

## Important

Failed reloads retain stale backtest state. `loadBacktest()` only sets `historyError` in its catch and does not clear `resultEntries`, `readiness`, or `snapshotQuality`. History renders warning/statistics/counts before the error branch, so success followed by failed retry displays stale quality/statistics alongside backend unavailable.

Required fix: clear all three response-owned states on failure and cover the success-to-failure transition with a focused regression.

## Test gap

Add focused coverage for the runtime snapshot-quality guard, including malformed, negative, fractional, array, and nonnumeric reason counts. Keep backward compatibility for missing quality data.

## Still pending after code fix

Controller will perform Browser black-box verification. The fixer should run focused tests, full Vitest, and build, but does not need Browser automation.
