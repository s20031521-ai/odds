# Backtest Integrity Implementation Plan

**Goal:** Make prediction/result records durable and correctly settled before tuning the football models.

**Scope:** Fix verified data-integrity blockers. Do not invent team statistics or add a data provider.

**Success:** first pre-kickoff snapshot is immutable and stores odds; historic results persist; draws and Asian lines settle correctly; backtest reports real ROI/yield.

**Steps:**
1. TDD: draw and Asian settlement tests in `src/predictionSnapshots.test.ts`.
2. Implement shared frontend settlement helpers in `src/predictionSnapshots.ts`.
3. TDD through `server.mjs --self-test`: immutable snapshot upsert, settlement, ROI.
4. Upsert snapshots in `server.mjs`; persist result archive and read it for backtest.
5. Archive imports and normalize draw labels in `scripts/hkjc-import.mjs`.
6. Update `docs/prediction-log.md`.

**Verification:** targeted RED/GREEN tests, importer/server self-tests, `npm test`, `npm run build`, duplicate POST smoke test.
