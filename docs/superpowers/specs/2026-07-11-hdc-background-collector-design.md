# Quota-aware Multi-league HDC Background Collector 設計

**日期：** 2026-07-11

## 目標

在 Dashboard 關閉時仍持續收集 HDC leave-one-out snapshots，覆蓋五大聯賽及主要歐洲賽，同時將 The Odds API 用量控制在現有低 quota 可長期運行的水平。

## 聯賽

固定 allowlist，並以免費 `/v4/sports` active 狀態決定當刻是否查詢：

- `soccer_epl`
- `soccer_spain_la_liga`
- `soccer_germany_bundesliga`
- `soccer_italy_serie_a`
- `soccer_france_ligue_one`
- `soccer_uefa_champs_league_qualification`
- `soccer_uefa_champs_league`
- `soccer_uefa_europa_league`

歐洲賽資格賽、正賽及歐霸屬同一「歐洲賽」範圍；inactive key 不消耗 odds quota。

## 排程與節流

Hermes script-only cron 每 3 分鐘執行一次 wrapper。Collector 用 state file 決定實際工作：

1. 每 15 分鐘讀一次 `/sports` 及 active allowlist 的 `/events`。官方文件確認兩者不計 usage quota。
2. 只有存在 `0 < commenceTime - now <= 30 分鐘` 的聯賽才拉一次 `spreads`。
3. 同一聯賽兩次 odds request 至少相隔 3 分鐘；過開賽時間停止。
4. Scores 在賽事開賽 150 分鐘後拉一次；未 completed 才每 60 分鐘重試。
5. 每個 response 記錄 `x-requests-last / remaining / used`；remaining 太低或收到 429 時停止 paid requests，但免費 discovery 繼續。
6. 以 lock file 防止 cron overlap；前一輪未完，新一輪靜默退出。

## 資料流程

- `scripts/hdc-collector.mjs` 讀 `.env.local` 的 `ODDS_API_KEY`。
- 只請求 `regions=us&markets=spreads`。
- 用 Vite `ssrLoadModule` 載入現有 `src/oddsApi.ts`、`src/handicap.ts`，避免複製 parser 或 leave-one-out 邏輯，亦不新增 dependency。
- 只保存 `pickLabel` 為買入且 `edge >= 3%` 的 snapshot。
- Snapshot 保存 event ID、side、line、bookmaker、odds、chance、edge、`hdc-loo-v2`、savedAt。
- Identity 沿用 `matchId|market|line|modelVersion`，第一個 snapshot immutable；重複輪詢不灌水增加 sample。
- 完場 scores 轉成外圍 event ID HDC result，供現有 Asian handicap settlement 使用。

## 持久化隔離

為避免 collector 與正在運行的 backend 同時改同一檔案：

- Collector snapshots：`data/background-hdc-snapshots.jsonl`
- Collector results：`data/background-result-archive.jsonl`
- Runtime state：`data/hdc-collector-state.json`
- Lock：`data/hdc-collector.lock`

Backend `/api/backtest` 讀取並合併 UI snapshot、HKJC archive 及 background collector 檔案。Snapshot/result 均按穩定 identity 去重。

## 執行與輸出

- `scripts/run-hdc-collector.sh` 由 Hermes cron 執行 Node collector。
- 正常且無新 pick 時 stdout 為空，Telegram 不發訊息。
- 新 snapshot 亦保持安靜，只寫檔；錯誤、quota exhausted、持續 429 才由 cron 非零 exit 告警。
- 提供 `--self-test`、`--dry-run` 及一次性 live run，方便驗證而不寫 production data。

## 不做

- 全日每 3 分鐘輪詢所有聯賽。
- 加入新 npm dependency。
- 自動修改 edge threshold。
- 因重複輪詢同一賽事製造多個 training samples。
- 將 API key 寫入 config、log 或 snapshot。

## 驗收

- Self-test 覆蓋 30 分鐘窗口、3 分鐘 cooldown、150 分鐘 score delay、60 分鐘 retry、inactive sport、immutable dedupe及 quota stop。
- Dry-run 顯示將查詢的 active leagues/events，但不寫 snapshots/results。
- Live run 能拉 active league events；沒有 30 分鐘內賽事時不消耗 odds quota。
- Synthetic fixture 經現有 parser/domain 產生 background snapshot，backend backtest 能讀取。
- Cron 每 3 分鐘存在且 script-only，成功無 stdout。
- `npm test -- --run`、`npm run build`、server/importer/monitor/collector self-tests 全過。
