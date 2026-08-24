# Phase 3 實作報告：賠率質素閘門（Quote Quality Gate）— shadow A/B 完成

**日期:** 2026-08-24
**狀態:** 🟡 shadow A/B、審計同 replay 工具已完成；未有獨立 forward validation，所以未套入 live `unified-buyable-v1`
**前置文件:** `docs/research/PHASE-3-quote-quality-gate-2026-08-24.md`(設計原則、死因證據、紅線全部跟足)
**代碼:**
- `shared/quote-gate-config.mjs`(新)— 預先登記 shadow 參數表 `quote-gate-v1-shadow`
- `shared/devig.mjs`(新)— gate／market-sharp 共用去水算法
- `shared/quote-quality-gate.mjs`(新)— 閘門純函數模組
- `shared/quote-quality-gate.test.mjs`(新)— 21 個單元測試
- `scripts/replay-quote-gate.mjs`(新,read-only)— replay + 參數 grid
- `scripts/unified-sampler.mjs`(additive)— 影子線 gated/ungated 雙版本
- `server/domain/backtest.mjs`、`server/domain/model-trust.mjs`(additive)— `-gated` 策略歸類為 shadow
- `db/migrations/009_quote_gate_audit.sql`、`server/db/opportunity-repository.mjs`— 每個 observation 保存全部盤口 context、gate 版本及原因碼

---

## 0. 一句講晒

閘門目前只運行於 versioned shadow 雙生線：同一批 inputs 同時產生 gated／ungated 證據。未通過 forward A/B 前，live `unified-buyable-v1` 保持 byte-for-byte 行為不變。

## 1. 交付物對照(研究文檔 §5)

| 步驟 | 內容 | 狀態 |
|---|---|---|
| 1 | Replay 分析 `scripts/replay-quote-gate.mjs` | ✅ 已建,self-test 過;**production 數據要喺 VM 行一次**(見 §4) |
| 2 | 閘門模組 `shared/quote-quality-gate.mjs` | ✅ 純函數,輸入 opportunity+quotes+context rows,輸出保留 quotes + 剔除原因碼 |
| 3 | Sampler 雙版本 | ✅ 每條現行影子線自動出 `-gated` 雙生；identity 以 strategyVersion 分隔 |
| 4 | API/UI | ⏸️ forward A/B 通過前不啟用；避免同一 `unified-buyable-v1` identity 出現兩種決策 |
| 5 | 參數表獨立成檔 | ✅ `shared/quote-gate-config.mjs`,每個參數有註釋講低邊條死因 |

**紅線確認:** 冇郁任何舊模型數學、冇郁 3% 下限、冇改寫歷史 snapshot；gate 證據只寫入新 `-gated` identities。

## 2. 閘門設計(已實作)

### 2.1 共識側:allowlist 定義「真相」

`CONSENSUS_ALLOWLIST` = pinnacle、marathonbet、betfair、matchbook、bet365、williamhill、unibet、betsson、betway。軟莊家(superbet、1xbet、US books)同 HKJC(買入目標)永遠唔入共識。共識用 Shin de-vig(主客和)/ power de-vig(兩邊盤),allowlist 內等權 — allowlist 本身就係篩選,唔再加權。最少 2 間齊盤先成立,唔夠就 fail-open(偏離檢查 skip,其餘檢查照做)。

### 2.2 買入側:五道檢查,每個剔除帶原因碼

| 檢查 | 參數(`quote-gate-v1-shadow`) | 原因碼 |
|---|---|---|
| 賠率上限 | 角球 6.0 / 其他 8.0 | `odds-cap-exceeded` |
| Edge 上限 | 15%(同 3% 下限對稱) | `edge-cap-exceeded` |
| 偏離 sharp 共識 | 對住 allowlist 共識嘅 implied edge > 15% | `deviates-sharp-consensus` |
| 相對新鮮度 | 舊過同場同盤口最快報價 > 15 分鐘 | `stale-vs-peers` |
| 盤口單調 | 同莊家跨盤口違反單調,且本報價係「太慷慨」嗰邊 | `non-monotonic-line` |

一個報價可以同時觸發多個原因,全部記低。

### 2.3 單調檢查嘅方向(實作決定,值得留底)

單調違反係成對出現嘅;剔除邊一邊有講究。實作只剔除「太慷慨」(賠率偏高 = 隱含概率偏低)嗰邊 — 例如同一莊家 over@9.5 賠 2.20 但 over@10.5 只賠 1.95,違反單調,被擋嘅係 9.5 嗰個 2.20(疑似過期好價),唔係 10.5 嗰個 1.95(貴價冇人買,唔係陷阱)。有測試守住兩邊行為。

## 3. 影子 A/B 接線(向前驗證)

- 每條影子線出埋 gated 雙生,兩條線用同一個 evaluation 嘅數據 — 將來直接比較 `-gated` vs 原版嘅實際 ROI,就係閘門價值嘅預先登記證據。
- `-gated` 策略喺 `backtest.mjs` / `model-trust.mjs` 都歸類為 shadow(證據收集,永遠唔出推薦),唔會污染 legacy 桶。
- 每個 gated observation 保存 `quoteGate: { version, rejectedQuotes, reasons }`，並保存同場同玩法全部盤口 inputs，可重建跨盤口單調判斷。

## 4. Replay 驗證:腳本就緒,等 production 跑一次

`scripts/replay-quote-gate.mjs` 做嘅嘢:

1. Read-only 拉晒 `unified-buyable-v1` 已結算 samples(含每個 sample 最後一個開波前 observation 嘅 quotes + inputs)同埋 results。
2. 用已知賽果 settle 每個推薦(沿用 `backtest.mjs` 嘅結算函數,Asian 盤半贏半輸照計)。
3. 跑 72 個參數組合，使用逐賠率 gross 盈虧作分母；盈利不會抵銷虧損，部分賠率被擋亦會歸因。
4. 單獨報告預先登記 `quote-gate-v1-shadow` 配置嘅過濾效果同原因分佈。

**本機行唔到真 replay**:164 個推薦嘅 observations 只喺 production PostgreSQL;本機冇 DATABASE_URL,而 VM 上跑要 sudo(docker exec 要密碼,唔可以自動化)。喺 VM 行:

```bash
sudo docker exec odds-tool-api-1 sh -c \
  'DATABASE_URL="postgres://odds_app:$(cat /run/secrets/pg_app_password)@postgres:5432/odds" \
   node scripts/replay-quote-gate.mjs --database'
# 加 --market corners 淨係角球;加 --json 出機讀結果
```

前提:呢份代碼先部署上 VM(腳本喺 api image 入面)。Self-test 已驗證 pipeline 邏輯(陷阱報價被擋、合理報價保留、結算正確)。

## 5. 測試結果

| 層 | 結果 |
|---|---|
| `shared/quote-quality-gate.test.mjs` | 通過(五道檢查、fail-open、單調方向、雙生線、config sanity) |
| `scripts/replay-quote-gate.test.mjs` | 通過（gross 盈虧分開、部分報價剔除仍正確歸因） |
| `server/app.test.mjs` | 通過；live `unified-buyable-v1` contract 保持不變，影子 gate 不會改名借殼 |
| `server/domain`(backtest、model-trust) | 21/21 通過 |
| `scripts/*.test.mjs`(dixon-coles、market-sharp、dc-shadow、backtest-metrics 等 8 檔) | 113 通過、0 失敗 |
| `unified-sampler --self-test`(含 gated 雙生斷言) | 通過 |
| `server/entry.mjs --self-test` | 通過 |
| vitest(src,22 檔) | 151/151 通過 |
| `tsc --noEmit` + `vite build` | 通過 |

完整 Node suite 內嘅 PostgreSQL integration cases 需要 controller 提供、同 `DATABASE_URL` 完全一致嘅 disposable `odds_test`；本機未設定時不可執行。其餘 Node、Vitest、build 同 data integrity checks 已通過。

## 6. 參數而家係「保守起步」,唔係結論

`quote-gate-v1-shadow` 嘅數字(6.0/8.0 cap、15% edge 上限、15% sharp band、15 分鐘新鮮度)係預先登記起點。Retrospective replay 只可產生候選假設，唔可以直接改 runtime 配置；任何收緊要由獨立 forward A/B 支持。

> **Review 修正(2026-08-24):同一批 200 條 settled 推薦只可做 retrospective 診斷。`quote-gate-v2` 降格為候選;runtime 保留預先登記嘅 `quote-gate-v1-shadow`,待獨立 forward A/B。見 §9。**

## 7. 後續行動

1. ~~**部署 + 喺 VM 跑 replay**(§4 命令),將結果寫入本文件或另開 `PHASE-3-replay-2026-08-XX.md`。~~ ✅ 2026-08-24 下午完成,結果同參數決定見 §9。
2. Replay 得出嘅 cap 4／edge 10% 只列作 `quote-gate-v2` 候選，唔寫入 runtime config。
3. 影子 A/B 收數：`dc-blend-v2` vs `dc-blend-v2-gated` 等；forward window 未完成前不升格。
4. Forward gate 通過後，另開新 strategy identity／ADR 再接入 Today 頁，唔覆用 `unified-buyable-v1`。

## 9. Replay 結果(2026-08-24 下午,production 已結算推薦)

部署後喺 VM 行 `replay-quote-gate.mjs --database`,200 個已結算推薦(189 個角球):

**基線(無閘門):** ROI [-34.4%, -34.1%],總虧損 -68.90u。

**舊版 net-P&L replay（只保留作歷史診斷）:** v1 配置擋 112/200 推薦(133 個報價)，保留 88 個推薦。舊報告以推薦級 P&L 區間估算「擋到約 80% 虧損」；修正後須用逐報價 gross 盈虧重跑，呢個百分比唔再當正式結論。擋截原因計數仍可作描述：odds-cap×127、edge-cap×52、sharp-deviation×1。

**Grid 頭部(corners cap 梯度係單調嘅):**

| 配置 | kept | kept ROI |
|---|---:|---:|
| corners≤4, edge≤0.10 | 40 | **+11.6%..+12.1%** |
| corners≤5, edge≤0.10 | 62 | -1.2%..-0.9% |
| corners≤6(v1) | 88 | -15.9%..-15.5% |

Edge cap 喺 corners≤4 之下嘅舊推薦級 ROI 排序係 0.10 → +11.6%、0.15 → +3.2%、0.20 → +3.8%。呢啲數只用嚟提出候選；「誤擋盈利 = 零」因舊 net-P&L／部分剔除歸因有缺陷，已撤回。

**Retrospective 候選（未升格）:** corners maxOdds 4.0、maxEdge 0.10。Runtime A/B 維持 `quote-gate-v1-shadow`；原本用 net P&L 得出嘅「誤擋盈利 = 0」已撤回，須以修正後 gross 指標重跑。

**誠實 caveat(寫低防之後自己都呃自己):**

1. 呢 200 個推薦就係當初促使起閘門嘅同一批屍體 — 喺佢哋身上揀 grid 第一名本質係 in-sample 揀贏家。所以採納嘅係**單調梯度**呢個穩健訊號(cap 越緊越好、4/5/6 三點方向一致),唔係「+11.6% 呢個數會重現」。
2. 189/200 係角球 — 證據只係角球嘅;其他玩法嘅 cap 唔郁,等 `-gated` 影子線向前收數。
3. 閘門嘅真考試係向前 A/B:gated vs ungated 影子線幾個月後嘅實際 ROI 對比(§7.3)。

## 8. 可重現性

```bash
node --test shared/quote-quality-gate.test.mjs     # 閘門單元測試
node scripts/replay-quote-gate.mjs --self-test     # replay pipeline sanity
node scripts/unified-sampler.mjs --self-test       # 含 gated 雙生斷言
node --test server/db/repositories.test.mjs        # 全盤口 context + observation 審計（需測試 DB）
```
