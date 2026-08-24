# Phase 3 實作報告:報價質素閘門(Quote Quality Gate)— 實作完成

**日期:** 2026-08-24
**狀態:** ✅ 五個實作步驟全部落地;測試全綠;replay 腳本待用 production 數據跑一次出參數結論
**前置文件:** `docs/research/PHASE-3-quote-quality-gate-2026-08-24.md`(設計原則、死因證據、紅線全部跟足)
**代碼:**
- `shared/quote-gate-config.mjs`(新)— 參數表 `quote-gate-v1`
- `shared/quote-quality-gate.mjs`(新)— 閘門純函數模組
- `shared/quote-quality-gate.test.mjs`(新)— 21 個單元測試
- `scripts/replay-quote-gate.mjs`(新,read-only)— replay + 參數 grid
- `scripts/unified-sampler.mjs`(additive)— 影子線 gated/ungated 雙版本
- `server/domain/backtest.mjs`、`server/domain/model-trust.mjs`(additive)— `-gated` 策略歸類為 shadow
- `server/app.mjs`、`server/app.test.mjs`(additive)— API 閘門過濾 + 審計
- `src/apiClient.ts`、`src/App.tsx`、`src/pages/TodayPage.tsx`(additive)— 前端閘門提示

---

## 0. 一句講晒

閘門已經裝喺推薦出街前最後一步:任何模型(unified / market-sharp / dc 家族 / 將來嘅新模型)出嘅報價都要過五道錯價檢查,被擋嘅報價唔會出現喺 Today 頁,但每次擋截都帶原因碼留痕。影子線而家每條自動多一條 `-gated` 雙生線,做預先登記嘅向前 A/B。

## 1. 交付物對照(研究文檔 §5)

| 步驟 | 內容 | 狀態 |
|---|---|---|
| 1 | Replay 分析 `scripts/replay-quote-gate.mjs` | ✅ 已建,self-test 過;**production 數據要喺 VM 行一次**(見 §4) |
| 2 | 閘門模組 `shared/quote-quality-gate.mjs` | ✅ 純函數,輸入 opportunity+quotes+context rows,輸出保留 quotes + 剔除原因碼 |
| 3 | Sampler 雙版本 | ✅ 每條影子線自動出 `-gated` 雙生(`market-sharp-v1-gated`、`dc-shadow-v1-gated`、`dc-blend-v1-gated`、`dc-xg-shadow-v1-gated`);identity 以 strategyVersion 分隔,唔會撞 |
| 4 | API/UI | ✅ `GET /api/v1/recommendations/current` 過閘;被擋推薦唔顯示;response 帶 `quoteGate` 審計(擋咗幾多、原因分佈);Today 頁加咗閘門提示條 |
| 5 | 參數表獨立成檔 | ✅ `shared/quote-gate-config.mjs`,每個參數有註釋講低邊條死因 |

**紅線確認:** 冇郁任何模型數學、冇郁 3% 下限、冇郁歷史 snapshot。閘門只係過濾層。

## 2. 閘門設計(已實作)

### 2.1 共識側:allowlist 定義「真相」

`CONSENSUS_ALLOWLIST` = pinnacle、marathonbet、betfair、matchbook、bet365、williamhill、unibet、betsson、betway。軟莊家(superbet、1xbet、US books)同 HKJC(買入目標)永遠唔入共識。共識用 Shin de-vig(主客和)/ power de-vig(兩邊盤),allowlist 內等權 — allowlist 本身就係篩選,唔再加權。最少 2 間齊盤先成立,唔夠就 fail-open(偏離檢查 skip,其餘檢查照做)。

### 2.2 買入側:五道檢查,每個剔除帶原因碼

| 檢查 | 參數(quote-gate-v1) | 原因碼 |
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
- 每個 gated opportunity 帶 `quoteGate: { rejectedQuotes, reasons }` 審計欄位,存入 sample raw JSON,之後可以答「閘門擋咗咩」。

## 4. Replay 驗證:腳本就緒,等 production 跑一次

`scripts/replay-quote-gate.mjs` 做嘅嘢:

1. Read-only 拉晒 `unified-buyable-v1` 已結算 samples(含每個 sample 最後一個開波前 observation 嘅 quotes + inputs)同埋 results。
2. 用已知賽果 settle 每個推薦(沿用 `backtest.mjs` 嘅結算函數,Asian 盤半贏半輸照計)。
3. 跑 72 個參數組合(角球 cap {4,5,6,8,10,∞} × edge cap {10%,15%,20%,∞} × sharp 偏離 band {10%,15%,∞}),輸出每個組合:**擋咗幾多 % 虧損 vs 誤擋幾多 % 盈利**,按擋虧損排序。
4. 單獨報告現行 `quote-gate-v1` 配置嘅過濾效果同原因分佈。

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
| `shared/quote-quality-gate.test.mjs` | 21/21 通過(五道檢查、fail-open、單調方向、雙生線、config sanity) |
| `server/app.test.mjs` | 5/5 通過(含新 case:12.0 賠率陷阱被擋 + 審計計數正確) |
| `server/domain`(backtest、model-trust) | 21/21 通過 |
| `scripts/*.test.mjs`(dixon-coles、market-sharp、dc-shadow、backtest-metrics 等 8 檔) | 113 通過、0 失敗 |
| `unified-sampler --self-test`(含 gated 雙生斷言) | 通過 |
| `server/entry.mjs --self-test` | 通過 |
| vitest(src,22 檔) | 151/151 通過 |
| `tsc --noEmit` + `vite build` | 通過 |

需要一次性測試 DB(`127.0.0.1:55432`)嘅 48 個測試喺本機照舊 skip/fail — 同改動無關,係環境前置(同 Phase 2 時一樣);部署後喺有 DB 嘅環境先跑到。

## 6. 參數而家係「保守起步」,唔係結論

`quote-gate-v1` 嘅數字(6.0/8.0 cap、15% edge 上限、15% sharp band、15 分鐘新鮮度)係按死因證據推嘅保守起點:**實際 cap 應該由 §4 嘅 replay 輸出話事**。Replay 會話我哋知邊個組合「大比例擋虧損、細比例誤擋」— 到時改 `shared/quote-gate-config.mjs` 一個 commit 搞掂,留痕。

> **後續(2026-08-24 下午):replay 已跑,參數已按結果收緊做 `quote-gate-v2`,見 §9。**

## 7. 後續行動

1. ~~**部署 + 喺 VM 跑 replay**(§4 命令),將結果寫入本文件或另開 `PHASE-3-replay-2026-08-XX.md`。~~ ✅ 2026-08-24 下午完成,結果同參數決定見 §9。
2. ~~按 replay 結果調 `quote-gate-config.mjs`(如需)。~~ ✅ 已出 `quote-gate-v2`(corners cap 4.0、corners edge cap 0.10;其他玩法維持 8.0/0.15)。
3. 影子 A/B 收數:`dc-blend-v1` vs `dc-blend-v1-gated` 等,幾個月後用 shadow-evidence-report 同 backtest 比較 — 呢個係閘門嘅向前證據,唔係事後揀贏家。
4. 注意:unified 線(角球以外)而家出街前都過閘 — 如果 replay 顯示誤擋率太高,第一步係放寬 config,唔係拆閘。(今次 replay 誤擋率係零 — 冇一注被擋嘅係贏錢嘅;見 §9。)

## 9. Replay 結果(2026-08-24 下午,production 已結算推薦)

部署後喺 VM 行 `replay-quote-gate.mjs --database`,200 個已結算推薦(189 個角球):

**基線(無閘門):** ROI [-34.4%, -34.1%],總虧損 -68.90u。

**v1 配置(corners cap 6.0 / edge 0.15)已經好有效:** 擋 112/200 推薦(133 個報價),被擋嗰批蝕咗 [-54.88, -54.58]u ≈ 全池 80% 嘅虧損;保留嘅 88 個仲係 ROI [-15.9%, -15.5%]。擋截原因:odds-cap×127、edge-cap×52、sharp-deviation×1 — **賠率 cap 係主力**,sharp 偏離幾乎冇貢獻(但成本係零,留住做保險)。

**Grid 頭部(corners cap 梯度係單調嘅):**

| 配置 | kept | kept ROI |
|---|---:|---:|
| corners≤4, edge≤0.10 | 40 | **+11.6%..+12.1%** |
| corners≤5, edge≤0.10 | 62 | -1.2%..-0.9% |
| corners≤6(v1) | 88 | -15.9%..-15.5% |

Edge cap 喺 corners≤4 之下:0.10 → +11.6%;0.15 → +3.2%;0.20 → +3.8% — edge 10–15% 區間仲係蝕緊。全部配置**誤擋盈利 = 零**(冇一注被擋嘅係贏錢嘅)。

**參數決定 → `quote-gate-v2`:** corners maxOdds 6.0→**4.0**;maxEdge 改做每玩法,corners 0.15→**0.10**,其他玩法維持 0.15;maxSharpEdge 0.15 不變;新鮮度/單調不變。

**誠實 caveat(寫低防之後自己都呃自己):**

1. 呢 200 個推薦就係當初促使起閘門嘅同一批屍體 — 喺佢哋身上揀 grid 第一名本質係 in-sample 揀贏家。所以採納嘅係**單調梯度**呢個穩健訊號(cap 越緊越好、4/5/6 三點方向一致),唔係「+11.6% 呢個數會重現」。
2. 189/200 係角球 — 證據只係角球嘅;其他玩法嘅 cap 唔郁,等 `-gated` 影子線向前收數。
3. 閘門嘅真考試係向前 A/B:gated vs ungated 影子線幾個月後嘅實際 ROI 對比(§7.3)。

## 8. 可重現性

```bash
node --test shared/quote-quality-gate.test.mjs     # 閘門單元測試
node scripts/replay-quote-gate.mjs --self-test     # replay pipeline sanity
node scripts/unified-sampler.mjs --self-test       # 含 gated 雙生斷言
node --test server/app.test.mjs                    # API 閘門 + 審計
```
