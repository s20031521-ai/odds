# Phase 2 結果報告:角球專用模型 — 離線驗證

**日期:** 2026-08-24
**狀態:** ❌ **唔通過上影子門檻 — 依預先登記規則停止;步驟 5–6(shadow builder、quota 擴展)唔做**
**前置文件:** `docs/research/PHASE-2-corner-model-feasibility-2026-08-24.md`(切割、度量、判定規則全部跟足)
**機讀結果:** `data/corners-backtest/corners-results.json`;walk-forward records cache `data/corners-backtest/records-{league}-xi{xi}.json`
**代碼:** `scripts/dc-corners-backtest.mjs`(新)、`scripts/lib/dixon-coles.mjs`(additive `response:"corners"` + `poissonTotalDistribution`)、`scripts/lib/football-data-csv.mjs`(additive HC/AC/HST/AST 欄位)、`scripts/import-historical-scores.mjs`(additive corners upsert)、`db/migrations/008_team_match_history_corners.sql`(新)

---

## 0. 一句講晒

喺 10,954 場五大聯賽(2019/20–2025/26,walk-forward、逐 10 日重估、無未來洩漏)上,**正確擬合嘅角球 DC 模型同「聯賽均值 Poisson」打和**(validation log-loss 2.6319 vs 2.6316),雖然明顯贏「每隊歷史均值」基線(2.6716),但達唔到預先登記嘅通過條件「明顯好過聯賽均值基線」。角球總數喺賽前可得數據入面冇可提取嘅每場訊號。**唔上影子。**

研究途中仲發現一個**影響成個 dc 引擎嘅 level-drift bug**(見 §3)— 呢個先係今次最重要嘅發現。

## 1. 實驗設置(同預先登記對齊)

| 項 | 值 |
|---|---|
| 數據切割 | tune 2020/21–2023/24(19/20 burn-in)· validation 2024/25 · holdout 2025/26(**未開封**,見 §5) |
| 模型 | `response:"corners"` — 每隊角球產出/被角球評分、主場修正、獨立 Poisson(基數大,唔用 rho 低比分修正);總角球 = Poisson(λ+μ) 解析解 |
| xi tuning | 每聯賽 grid {0, 0.0005, 0.001, 0.0019, 0.003, 0.005},tune scope log-loss 揀 best;多數聯賽 best 落喺 0.001–0.0019(同入球嘅 xi 同量级) |
| 基線 | `leagueMean` = 訓練窗擴展均值嘅 Poisson;`teamMean` = 每隊主/客角球均值(shrinkage k=6 向聯賽均值)相加 |
| 度量 | 總角球 log-loss / RPS(0–40 有序);大細盤 Brier @ 8.5/9.5/10.5/11.5;校準 bins |
| 覆蓋 | E0/SP1 2660/2660、D1 2141/2142、I1/F1 全覆蓋 — HC/AC 喺全部 35 個 CSV 齊 |

## 2. 結果

### 2.1 總角球 log-loss(越低越好;每聯賽 best xi)

| scope | n | dc-corners | leagueMean | teamMean | dc vs leagueMean |
|---|---:|---:|---:|---:|---:|
| tune | 7451 | 2.6232 | **2.6130** | 2.6537 | **+0.39%(輸)** |
| validation | 1751 | 2.6319 | **2.6316** | 2.6716 | +0.01%(打和) |

逐聯賽 validation(dc vs leagueMean):E0 輸(2.6718 vs 2.6694)、SP1 贏(2.5783 vs 2.5847)、D1 輸(2.6109 vs 2.5957)、I1 贏(2.6818 vs 2.6913)、F1 輸(2.6079 vs 2.6048) — 三負兩勝,冇一致方向。tune 期五個聯賽**全部輸**畀 leagueMean。

RPS 同型(validation:dc 0.04747 vs leagueMean 0.04759,差 0.3%)。大細 Brier 四條線互有高低,差異全部喺 0.002 以內 — 噪音級。

### 2.2 點解:每場可預測嘅變化近乎零

- 實際總角球均值 ~9.6–10.9/場(逐季浮動),variance/mean = 1.175 — 只係輕微超泊松。
- dc 每場預測總數嘅散佈(sd 1.35)買唔到任何 log-loss:真正嘅每場率差異細到被泊松噪音同估計噪音蓋過。
- 換句話講:**賽前知道邊隊對邊隊,對總角球分佈嘅幫助 ≈ 0**;一個常數聯賽均值 Poisson 已經係呢個數據環境嘅天花板。

### 2.3 判定對照(研究文檔 §8)

| 條款 | 結果 |
|---|---|
| 通過:總角球 log-loss 明顯好過聯賽均值基線 | ❌ tune 全聯賽輸;validation 打和 |
| 通過:大細盤校準合理 | ✓(通過,但救唔到上條) |
| 通過:聯賽之間穩定 | ❌ 三負兩勝,方向不一致 |
| 失敗:同每隊均值基線打和 | 唔係 — dc 明確贏 teamMean 1.5%,即球隊身份有訊號,但 dc 結構提取唔到比常數均值更多 |

**判定:唔通過上影子。** 落喺兩條預登記規則之間(唔係「完全冇可預測性」),但通過條件係主動門檻:贏唔到聯賽均值就冇理由燒 quota 做影子。一個同常數均值打和嘅模型,對住真實角球盤嘅抽水只會輸。

## 3. 重大副發現:dc 引擎 level-drift bug(影響全部現有模型)

### 3.1 症狀

第一輪角球回測 dc 輸得離譜(log-loss 2.68 vs 基線 2.61)。追查發現:**擬合出嚟嘅比率系統性偏高 ~9–13%**,連 in-sample 都唔匹配 — E0 兩季訓練集實際场均總角球 10.447,模型預測 11.430;入球模式同型(實際 2.708,預測 3.061)。Poisson 迴歸 MLE 嘅 score equation 要求 Σλ = Σy 精確成立,所以呢個係 solver bug,唔係模型特性。

### 3.2 根因

`fitDixonColes` 每個 sweep 嘅順序:attack/defence 更新 → intercept/homeAdv 更新(呢刻 score ≈ 0,水平平衡)→ `centre()` 將 attack/defence 均值強行歸零。但 λ = exp(intercept + homeAdv + attack − defence),centring 等於將所有 log-rate 平移 (meanAttack − meanDefence),**intercept 冇補償呢個平移**。下一輪 sweep 又喺漂移後嘅狀態重新平衡 → 迭代停喺一個穩定循環,而唔係 MLE。attack/defence **之間嘅差異**(實力排序)唔受影響,所以舊測試(排名相關、homeAdv、rho)全部照過,水平偏差一直隱形。

### 3.3 修補同影響範圍

- **修補:** centring 前將 (meanAttack − meanDefence) 吸入 intercept。修補後 in-sample 偏差 < 0.02%(有測試守住:`dixon-coles.test.mjs` "level-unbiased in-sample")。
- **範圍控制(ADR 0003):** 修補**只套用喺新嘅 `response:"corners"` 路徑**。goals/xg 路徑保持逐 byte 不變 — dc-v1、dc-xg-v1、dc-v2、dc-blend-v1 嘅數學同所有歷史回測結果維持可重現。
- **但要知道:** 生產 shadow(dc-shadow.mjs)同一個引擎 — **dc-v2 影子線嘅 λ 很可能一直偏高 ~10% 量级**,佢嘅影子證據同 Phase 1 嘅離線數字都帶住呢個偏差。Phase 1「blend 唔贏市場」嘅結論方向大概率唔變(市場錨冇 bug,模型偏差只會令模型更差),但「模型校準良好」呢點要重新檢查 — 一個高咗 13% 嘅入球率模型喺大細盤上唔可能校準良好。
- **待 owner 決定:** 係咪修 goals/xg 路徑(會改變 frozen 模型輸出,要重跑 Phase 1 harness、重估 dc-v2 影子嘅解讀)。呢個決定唔喺 Phase 2 範圍,報告如實記錄。
 - **後續(2026-08-24 下午):owner 已拍板修。** level-preserving centring 已推展到全部 response,dc-v1-backtest 同 blend harness 已重跑(tune/validation;holdout 唔重開),影響同影子線處理見 `PHASE-1-results-2026-08-24.md` §10 — 判定不變。
  - **Review 修正:** goals/xG 數學改動後已切新 identity：`dc-shadow-v2` / `dc-blend-v2` / `dc-xg-shadow-v2`；舊 v1 證據只作歷史審計，唔再混入 readiness。

## 4. 交付物狀態

| 計劃步驟 | 狀態 |
|---|---|
| 1. Migration 008(可加、nullable) | ✅ 已建 `db/migrations/008_team_match_history_corners.sql`;server 啟動/一次性 migration job 會自動套用 |
| 2. 匯入 HC/AC(idempotent upsert) | ✅ parser + importRows 已加,self-test 過;**未對 DB 執行**(離線判定唔需要;判定唔通過,冇理由而家入庫 — 要入嘅話 `node scripts/import-historical-scores.mjs --dir data/historical`) |
| 3. dc 引擎 `response:"corners"` | ✅ 連 level-preserving centring;測試齊 |
| 4. 離線 walk-forward | ✅ 本報告 |
| 5. Corner shadow builder | ❌ 唔做(判定唔通過) |
| 6. Quota 擴展評估 | ❌ 唔做(同上) |

一致性回歸:`dixon-coles`(13)、`backtest-metrics`、`import-historical-scores`、`dc-shadow`、`market-sharp` 合共 70/70 通過;兩個 self-test 通過。

## 5. Holdout 狀態

2025/26 **未開封**。通過條件要求 validation 明顯贏基線,已確定唔成立,holdout 冇嘢可以反轉;留返封存畀將來真正需要一次性驗證嘅實驗。

## 6. 後續行動

1. **Phase 3(報價質素閘門)成為唯一剩低嘅新開發主線** — 佢唔依賴任何模型成功,直接對治 corner-loo-v1 嘅真死因(錯價當價值),replay 驗證可以即刻做。
2. **corner-loo-v1 維持 suspended**,觀察數據繼續收集(研究用途),唔重啟。
3. ~~引擎 level-drift bug 嘅 goals/xg 路徑修唔修,等 owner 拍板~~(見 §3.3)— **已結案 2026-08-24 下午**:owner 拍板修,已實作並重跑 harness,判定不變(見 `PHASE-1-results-2026-08-24.md` §10)。
4. 角球方向如果將來要翻身,缺口唔喺模型結構而喺**特徵**:臨場數據(陣容、天氣、比賽狀態)先係角球嘅真正驅動;純歷史賽前數據已證明到頂。

## 7. 可重現性

```bash
node scripts/dc-corners-backtest.mjs --self-test          # sanity
node --test scripts/dixon-coles.test.mjs                  # 引擎測試(含 level-drift 防線)
node scripts/dc-corners-backtest.mjs                      # tune xi + tune/validation(用 cache)
node scripts/dc-corners-backtest.mjs --rebuild            # 重建 records(五聯賽 × 6 xi,~2 分鐘)
```

Walk-forward 規則同 dc-v1-backtest / dc-blend-backtest 完全一致:首季 burn-in、每 10 日 warm-start 重估、每場只用嚴格早於佢日期嘅數據(基線都係)。
