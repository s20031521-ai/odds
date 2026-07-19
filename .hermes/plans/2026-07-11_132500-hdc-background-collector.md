# Quota-aware HDC Background Collector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立不依賴 Dashboard、quota-aware、涵蓋五大聯賽及歐洲賽的 HDC background collector。

**Architecture:** Node collector 由 Hermes script-only cron 每 3 分鐘喚醒，免費 discovery 決定是否進行 paid odds/scores calls。Collector 透過 Vite SSR 載入現有 TypeScript parser/domain，寫入隔離 JSONL；backend 合併 UI、HKJC 及 background 檔案。

**Tech Stack:** Node.js、Vite SSR、TypeScript domain、Hermes cron。

## Global Constraints

- 不新增 npm dependency。
- 只收 `regions=us&markets=spreads`。
- 只在開賽前 30 分鐘每 3 分鐘拉 paid odds。
- 免費 discovery 每 15 分鐘。
- Immutable snapshot identity，不以重複輪詢增加樣本。
- API key 不進入 log／snapshot／config。

---

### Task 1: Collector policy and self-test

**Files:** Create `scripts/hdc-collector.mjs`

- [ ] 實作純函數 `shouldDiscover`、`dueOddsSports`、`dueScoreSports`、`mergeImmutable`。
- [ ] `--self-test` 驗證 15m discovery、30m window、3m cooldown、150m score delay、60m retry、quota stop、immutable identity。
- [ ] 跑 `node scripts/hdc-collector.mjs --self-test`。

### Task 2: Live collector and isolated persistence

**Files:** Modify `scripts/hdc-collector.mjs`; create `scripts/run-hdc-collector.sh`

- [ ] 讀 env、state、lock、active sports/events。
- [ ] 用 Vite SSR 載入 `importOddsApiHandicaps` 及 `buildHandicapCards`。
- [ ] 保存 background snapshots/results，atomic write，成功 stdout 空白。
- [ ] 實作 `--dry-run`，驗證免費 discovery且不寫 production data。

### Task 3: Backend merge

**Files:** Modify `server.mjs`

- [ ] `/api/backtest` 合併 UI/background snapshots及 HKJC/background results。
- [ ] self-test 驗證 stable dedupe。
- [ ] 跑 server self-test及全套 tests/build。

### Task 4: Cron and live verification

**Files:** Modify `docs/prediction-log.md`

- [ ] 建立每 3 分鐘 script-only cron，stdout 空白成功、非零 exit 告警。
- [ ] 手動 run cron 一次，驗證 output/state/quota。
- [ ] 驗證 cron job、collector self-test、full suite/build。
- [ ] 更新 prediction log；workspace 無 Git metadata，跳過 commit。
