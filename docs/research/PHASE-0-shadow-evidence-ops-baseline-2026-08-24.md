# Phase 0 研究報告:影子證據累積與營運基線

**日期:** 2026-08-24(同日第三版:部署完成,VM 端驗證進行中)
**狀態:** 監察工具已落地;`de1920e` 已部署(02:20 由 owner 執行 `deploy-now.ps1`);剩低 VM 端 sudo 驗證同埋第一次影子基線
**前置文件:** `docs/MODEL-VALIDITY-IMPLEMENTATION-REPORT-2026-08-23.md`
**目的:** 喺任何新 AI 上馬之前,先確保數據管道健康、今日嘅修復真係上咗線、影子證據持續累積。冇呢個基線,之後 Phase 1–3 嘅驗證全部唔可信。

---

## 1. 背景

2026-08-23 嘅有效度報告判定:四個現行 AI 全部 `not-trusted`,`corner-loo-v1` 實績 ROI -41.7% 被 trust gate 暫停。系統而家嘅價值唔係出推薦,而係**累積乾淨嘅影子證據**,等 Phase 1–3 嘅候選模型有 data 可驗證。

Phase 0 唔開發新模型,只做三件事:部署、驗證、監察。

## 2. 現況考證(2026-08-24 代碼 + VM + 公開端點實查)

| 項目 | 狀態 | 證據 |
|---|---|---|
| Trust gate(`server/domain/model-trust.mjs`) | 已實作,`corner-loo-v1` suspended,其餘 unified AI active | commit `1a91c06`(2026-08-23 23:37) |
| Fixture alias registry + 拆分審計 | 已實作(`server/domain/fixture-aliases.mjs`、`scripts/audit-fixture-splits.mjs`) | 同上 |
| Quota 單一來源(`HDC_MIN_QUOTA=5`) | 代碼同 `deploy/compose.yaml` 已改 | 同上 |
| Session auth 恢復 | 已實作,公開 `/api/v1/session` 回 200 `{"authenticated":false}` | commit `d64da57`;curl 實測 2026-08-24 |
| `deploy-now.ps1` 明文憑證 | **已修復** — 腳本改用 `ssh -t` 互動問 sudo 密碼,無明文、無 askpass 殘留 | `1a91c06` diff 實查(原報告 §10 P0 已關閉) |
| VM 代碼同步 | `/opt/odds-tool/build` 喺 `de1920e` | SSH 唯讀實查 2026-08-24(部署後) |
| **部署狀態** | **已部署** — owner 於 02:20 左右執行 `deploy-now.ps1`;線上 asset hash 同本地乾淨 `de1920e` build 输出完全一致 | curl 線上 HTML + 本地 `npm run build` 比對,2026-08-24 |
| Production API | 對外 `/api/v1/results` 回 401、`/internal/*` 回 404、session 200、HSTS 有(符合設計) | curl 實測 2026-08-24(部署後覆查) |
| 影子策略 | 四條影子線已喺 sampler 入面:`dc-shadow-v1`、`dc-blend-v1`、`dc-xg-shadow-v1`、`market-sharp-v1` | `scripts/unified-sampler.mjs`、`scripts/lib/dc-shadow.mjs`、`scripts/lib/market-sharp.mjs` |
| Collector 循環 | 每 5 分鐘 HDC,每第 3 循環 HKJC,之後一次 sampler | `deploy/collector-entrypoint.sh` |

> 第一版用「本地 `dist/` build 時間戳早過 commit」做未部署證據 — 方法唔啱(部署喺 VM 由 git 源碼 build,本地 dist 無關)。第二版改用 asset hash 比對,判定「未部署」— 都係唔啱:部署後實測證明,22:07 嗰次本地 build 嘅 working tree 已包含後來 `1a91c06` 先 commit 嘅前端改動,所以新舊 build hash 一致係正常;**asset hash 比對只能證明「唔同」,唔能證明「舊」**。部署狀態嘅可靠信號係:VM commit、api log 嘅 build stamp、同埋 `suspensions` 行為。

### 2.1 已知數據覆蓋限制

- **HDC 付費賠率只喺開波前 25 分鐘內收集**(`ODDS_WINDOW_MS`,五大聯賽加開波前 5 分鐘 poll)。影子觀察因此集中喺開波前最後半個鐘 — 呢個係取樣偏差,驗證時要記住:影子證據反映嘅係「臨開波市場」,唔係全日市場。
- dc 引擎只支援五大聯賽(E0/SP1/D1/I1/F1);HKJC 嘅日韓等聯賽冇 fit,影子機會只會來自五大聯賽。
- 角球 live 收集受 `data/priority-teams.json` gate 限制;`HDC_CORNER_ALL=1` 先係全角球。
- `collector_state` 係單行 state document,**冇歷史** — quota 消耗速率要靠每週報告存档對比(見 §3.3)。

## 3. 工作項目

### 3.1 部署 commit `de1920e` 上 production(✅ 已執行 2026-08-24 02:20)

Owner 已執行 `deploy-now.ps1`(互動 — sudo 密碼由 `ssh -t` 即場問,腳本唔會儲)。2026-08-24 已對腳本做咗兩個修正:

- **untracked 檔案唔再誤擋部署**:dirty 檢查改用 `git status --porcelain --untracked-files=no`。之前 working tree 入面嘅 `tmp-*`、`data/` dump、`股神/` 等 untracked 檔會令腳本拒絕執行,但佢哋根本唔會上 VM(遠端 `git reset --hard origin/master`)。
- **smoke test 擴充到 runbook §2 全套公開檢查**:root 200、results 401、internal 404、session 200、HSTS header;任何一項 fail 即 exit 1。

注意:

- 今次有冇新 migration 要確認(006/007 應已上過;trust gate 同 alias registry 係純代碼)。
- 部署前 `pg_dump` 備份(runbook §4):
  `sudo docker exec odds-tool-postgres-1 pg_dump -U postgres -d odds -Fc > /opt/odds-tool/backups/odds-$(date +%F).dump`
- 部署後喺 VM log 確認 build stamp:`sudo docker logs odds-tool-api-1 2>&1 | grep "build commit"` 應見 `commit=de1920e`(`server/entry.mjs:50`)。

### 3.2 部署後 smoke 驗證

公開部分已由 `deploy-now.ps1` 自動做,並已喺部署後覆查全綠(見上)。其餘喺 VM / 已登入 session 做:

1. 容器全 healthy:`postgres`/`api`/`caddy`/`collector`/`cloudflared`。
2. `GET /api/v1/recommendations/current`(已登入 session)回應內 `suspensions` 陣列列出角球 AI(`server/app.mjs:149`)— 證明 trust gate 上咗線。
3. HDC/HKJC freshness 真實(上次觀察時間喺合理範圍)。
4. `node scripts/check-data-integrity.mjs --database` 對 production 係 green(timestamp/identity 假陽性已修)。
5. 三個已確認拆分個案(Daejeon/Gangwon、Machida/Urawa、Gwangju/Incheon)依家共用 `fixtureId`。
6. Quota 433 / reserve 5 時唔再顯示 blocked。
7. ~~前端 hash 檢查~~ — 已證明唔可靠(見 §2 附註),改用 build stamp log。

### 3.3 影子證據監察(已實作:`scripts/shadow-evidence-report.mjs`)

每週跑一次(或部署後即刻跑第一次做基線)。唯讀,三條 SELECT,唔寫唔 migrate:

```bash
# 本機(設咗 DATABASE_URL)
npm run report:shadow

# Production(喺 VM 上,入 api 容器用 app role 直連)
sudo docker exec odds-tool-api-1 sh -c \
  'DATABASE_URL="postgres://odds_app:$(cat /run/secrets/pg_app_password)@postgres:5432/odds" \
   node scripts/shadow-evidence-report.mjs --database'
```

輸出四個部分,有 warning 會 exit 1(方便之後自動化):

1. **每條策略嘅增長** — `unified-buyable-v1` + 四條影子線:snapshots / observations 總數同近 7 日新増(`--days` 可調),同埋有 fresh evidence 嘅 fixture 數,按聯賽拆(E0/SP1/D1/I1/F1/other)。
2. **聯賽目標檢查** — 目標每活躍聯賽每週 ≥10 場新觀察(`--target` 可調)。「活躍」= unified 線喺窗口內評估過嘅聯賽;淡季聯賽唔會誤報。
3. **dc fit 覆蓋率** — 窗口內 unified 評估過嘅五大聯賽 fixture 入面,有幾多 % 出到 dc 家族(dc-shadow / dc-blend / dc-xg)影子行;低過 80% 會 WARN(= alias 或 team_match_history 缺口)。market-sharp 覆蓋並列。
4. **collector 狀態** — `quotaRemaining` / `quotaUsed` / reserve floor / `paidCollectionBlocked` / key rotation(週 anchor + offset)/ state 新鮮度(>6h 會 WARN)。

已知限制:單場比賽日嘅窗口內,離目標 10 場會好遠 — 睇趨勢,唔好睇單次絕對值。開季初 dc fit 唔穩係預期之內(§5)。

測試:`scripts/shadow-evidence-report.test.mjs`(8 個單元測試,純函數,唔使 DB)。

## 4. 驗收標準

Phase 0 完成 = 以下全部成立:

- [x] `de1920e` 部署上 production(2026-08-24 02:20 執行;容器健康、公開 smoke 全綠)— **但 build stamp 係 `unknown`,因 stack compose 漂移(見 §8 問題一),補救後要見到 `commit=` stamp**
- [ ] API `suspensions` 可見,角球推薦唔再出現,觀察繼續寫入(待瀏覽器登入驗)
- [x] Integrity checker green(snapshots=510 results=8138,late/duplicate/future/post-kick 全 0;僅 1 條歷史 post-kickoff invalid 同 93 條 legacy 缺 commenceTime,屬已知)
- [ ] Fixture 合併個案驗證 — **改寫**:三個 8-23 歷史個案(Daejeon/Gangwon、Machida/Urawa、Gwangju/Incheon)仍然拆分,因為 alias registry 唔做追溯合併(審計註明:merges require an approved forward-only migration)。Phase 0 嘅正確驗收係:**部署後嘅新賽事唔再拆分**;歷史合併另開 migration 處理
- [ ] 四條影子線每週有新觀察(有波踢嘅日子)— 用 `report:shadow` 驗;**分佈查詢證實有累積(§8 問題二),待重跑修正版報告攞正式基線**
- [x] `deploy-now.ps1` 明文憑證移除(`1a91c06` 已完成)
- [x] 每週影子監察工具落地(`scripts/shadow-evidence-report.mjs`,2026-08-24)

## 5. 風險

| 風險 | 影響 | 緩解 |
|---|---|---|
| 歐洲聯賽啱啱開季,team history 新季數據少 | dc fit 不穩 | xi time-decay 會自動降舊季權重;開季初幾週影子數據質素唔好係預期之內 |
| 影子觀察集中喺開波前 25 分鐘 | 驗證結論只適用於臨開波市場 | 記錄喺報告;如要全日覆蓋需擴大 HDC 收集窗(使費,需 owner 批准) |
| 部署中途出錯 | production 停頓 | runbook 有 rollback(image tag + pg_dump);`deploy-now.ps1` 每次 build 前自動 tag `:rollback` |
| `collector_state` 無歷史 | quota 消耗速率睇唔到趨勢 | 每週存档 `report:shadow --json` 輸出(建議存入 `docs/research/shadow-baseline/`)對比 |
| **stack compose 漂移**(2026-08-24 實際發生) | `/opt/odds-tool/compose.yaml` 係手維護副本,repo 改咗唔會自動跟 — 今次漏咗 build stamp args 同 `HDC_MIN_QUOTA=5` | `deploy-now.ps1` 而家會 hard-fail;runbook §1 step 0b 有 re-sync 步驟 |
| VM 資源(2026-08-24 觀察) | 磁碟 89.7%、swap 97% | 非緊急但要留意;搵時間清 Docker 舊 image / log |

## 6. 同其他 Phase 嘅關係

Phase 0 係 Phase 1–3 嘅前提:冇乾淨嘅數據流同持續嘅影子累積,任何新模型嘅「驗證」都係假嘅。但 Phase 1 嘅**離線回測部分唔使等 Phase 0** — 歷史數據喺本地,可以即刻開工。

## 7. 2026-08-24 晚驗證紀錄(附錄)

| 檢查 | 方法 | 結果 |
|---|---|---|
| VM 代碼版本(部署前) | `ssh ... git rev-parse --short HEAD` @ `/opt/odds-tool/build` | `1a91c06`(代碼已同步,部署未跑) |
| 容器 / image 狀態(部署前) | `sudo -n docker ps` | ✗ 非互動 sudo 拒絕 — 需 owner 互動確認 |
| ~~線上前端版本判斷~~ | curl asset hash 比對本地 22:07 `dist/` | **誤判已撤回** — 見下方更正 |
| 公開 smoke(部署前) | curl root / results / internal / session / HSTS | 200 / 401 / 404 / 200 / 有 ✓ |
| `deploy-now.ps1` 憑證 | 讀腳本全文 | 無明文密碼,`ssh -t` 互動 ✓ |
| 監察腳本測試 | `node --test scripts/shadow-evidence-report.test.mjs` | 8/8 通過 ✓ |
| 回歸 | `node --test scripts/dc-shadow.test.mjs scripts/market-sharp.test.mjs` | 47/47 通過 ✓ |
| **部署執行** | owner 跑 `.\deploy-now.ps1`(第一次喺 `system32` 目錄 NotFound,轉去 repo 目錄後成功) | ✅ 02:20 左右完成 |
| VM 代碼版本(部署後) | 同上 SSH 唯讀 | `de1920e` ✓ |
| 線上前端(部署後) | 本地乾淨 `de1920e` `npm run build`,hash 比對線上 | `index-B58aoIxD.js` / `index-B9H1itJb.css` **完全一致** ✓ — 同時證明 22:07 舊 build 已含 `1a91c06` 前端改動,之前嘅「未部署」判斷撤回 |
| 公開 smoke(部署後覆查) | 同上 curl | 200 / 401 / 404 / 200 / 有 ✓ |

## 8. 部署後驗證發現嘅兩個真問題(2026-08-24 02:30,owner 提供嘅 VM 输出)

### 問題一:stack compose 漂移 → build stamp `unknown` + quota reserve 冇落實

- 部署用嘅 compose 檔**唔係 repo 入面嗰份**:`/opt/odds-tool/build/` 冇 compose 檔,Docker Compose 向上搵到 `/opt/odds-tool/compose.yaml` — 一份 root-owned 手維護副本(2026-08-23 05:42,早過 `1a91c06`)。
- diff 證實佢漏咗 `1a91c06` 嘅三樣嘢:build stamp args、`HDC_MIN_QUOTA: "5"`、同埋 context 路徑改寫。
- 後果實測:api log 顯示 `build commit=unknown builtAt=unknown`;`collector_state` 顯示 `quotaMinimum: 50`(代碼預設值)而唔係預期嘅 5。`paidCollectionBlocked: false`、`quotaRemaining: 242` 係好消息。
- 補救:修正版(`context: ./build` 改寫)已上傳到 VM `/home/hugo/compose.yaml.new`;`deploy-now.ps1` 已加 hard-fail 檢查;runbook §1 step 0b 已補 re-sync 步驟。

### 問題二:~~sampler 從未喺 Postgres 寫過 unified / shadow 記錄~~ → 撤回,係報告腳本嘅 bug

- 第一次 `report:shadow` 基線顯示五條線全 0 — 初判「sampler 冇寫入」。
- 覆查查詢(`prediction_snapshots` 按 `strategy_version` 分佈)推翻咗:`unified-buyable-v1` 221 條、`dc-xg-shadow-v1` 68、`dc-shadow-v1` 55、`market-sharp-v1` 52、`dc-blend-v1` 16;dc 家族最新記錄 2026-08-23 18:20:57 UTC = 部署後第一個 collector cycle,**影子證據有正常累積**。
- 真正嘅 bug 喺報告腳本:pg 落嚟嘅 row 用 snake_case(`strategy_version`),分析函數齋讀 camelCase(`strategyVersion`),靜靜雞 drop 咗所有 row;當時嘅 snake_case 測試亦寫漏呢個欄位所以捉唔到。已修(兩種 casing 都接受)+ 補咗真正純 snake_case 嘅回歸測試(8/8 通過)。
- 教訓寫低:對住 production 讀數嘅新工具,第一次输出一定要同獨立查詢(如直接 psql)交叉驗證先好信。

### 問題三(觀察,非阻塞)

- 歷史 fixture 拆分個案 65 組仍在(審計係 read-only;合併要 approved forward-only migration)。
- VM 磁碟 89.7%、swap 97% — 要排期清理。
