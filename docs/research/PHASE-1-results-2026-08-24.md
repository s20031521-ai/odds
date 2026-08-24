# Phase 1 結果報告:市場錨定混合模型 — 離線驗證

**日期:** 2026-08-24
**狀態:** ❌ **不通過 — 依預先登記規則停止投入 blend;`dc-v2` 唔升格**
**前置文件:** `docs/research/PHASE-1-market-anchored-blend-2026-08-24.md`(預先登記嘅切割、度量、判定規則全部跟足)
**機讀結果:** `data/blend-backtest/blend-results.json`(tune+validation)、`data/blend-backtest/blend-results-with-holdout.json`(含 holdout)
**代碼:** `scripts/dc-blend-backtest.mjs`(新,self-test 通過;現有四模型數學零改動,ADR 0003 紅線守住)

---

## 0. 一句講晒

喺 12,644 場五大聯賽(2019/20–2025/26,walk-forward、逐 10 日重估、無未來洩漏)上,**任何 w > 0 都冇喺驗證季贏過純市場(w = 0)** — 概率分數係咁,模擬落注 ROI 都係咁。holdout 一次性開封後冇反轉。按研究文檔 §6,blend 思路證偽,資源轉去 Phase 2 / Phase 3。

## 1. 實驗設置(同預先登記對齊)

| 項 | 值 |
|---|---|
| 數據切割 | tune 2020/21–2023/24(19/20 做 burn-in)· validation 2024/25 · holdout 2025/26(一次性開封) |
| w 網格 | {0, 0.1, 0.2, 0.3, 0.4, 0.5, 1} — 0 = 純市場,1 = 純模型(對照) |
| 模型組件 | `dc-v1`(比數 fit)同 `dc-xg-v1`(xG fit + 借 rho,即 dc-xg-compare 贏出嘅 xg-rho 變種) |
| 市場錨 | `open` = Pinnacle pre-closing(PSH 等,實戰落注前見到);`close` = Pinnacle 收盤(PSCH 等,學術基準) |
| 去水 | 同 production 一致:主客和 Shin、兩邊盤 power(`scripts/lib/market-sharp.mjs`) |
| 混合公式 | 同 production `blendQuoteEvaluation`:`(1−w)·(marketChance·odds − 1) + w·settlementEV(dist, odds)` |
| 落注模擬 | flat 1u,3% edge 閘(冇郁),五態亞洲盤結算同 production 一致 |
| 基線 | 永不下注(任何自身價格 w=0 自然 0 注)✓ 純市場 w=0 ✓ 純模型 w=1 ✓ consensus-v1 代理(Avg 價去水 vs Pinnacle 價)✓ |
| 每場成本 | 每聯賽一次 walk-forward pass 儲 lambda/mu/rho + 原始價格;w sweep 零重估成本 |

**Sanity checks 全過:** w=0 用自身收盤價落注 = 0 注(self-test 強制);一致性回歸 70/70(`backtest-metrics`、`import-historical-scores`、`dc-shadow`、`market-sharp`)。

## 2. 研究途中嘅兩個重要數據發現(影響舊結論嘅措辭)

### 2.1 舊 harness 嘅「Pinnacle 收盤」其實係 pre-closing

football-data.co.uk 由 2019/20 起每場有兩套價:無 `C` 後綴(PSH/PSD/PSA、P>2.5、PAHH)= 開盤後收集嘅 **pre-closing**;有 `C` 後綴(PSCH/PSCD/PSCA、PC>2.5、PCAHH)= **真收盤**。舊 parser(`football-data-csv.mjs`)嘅 `closing*` 欄位食嘅係 PSH — 即之前所有 walk-forward 報告(包括 Phase 1 文檔 §1 引用嘅 Brier 0.5777)入面嘅「Pinnacle 收盤」實為 pre-closing。

影響:**方向唔變,結論更強**。真收盤去水嘅 Brier(tune 0.5760)比 pre-closing(0.5778)仲要低 — 模型落後市場嘅距離比之前講嘅更大。parser 已加 `pinOpen*`/`pinClose*`/`avgOpen*`/`avgClose*` 欄位(additive,舊欄位 byte-identical,舊 harness 結果可重現),並修正咗誤導性註釋。

### 2.2 Pinnacle 2025/26 數據受污染(holdout 解讀前提)

football-data 官方註明:由 2025-07-23 起 Pinnacle 公開 API 唔穩,賠率系統性過時,亦唔再計入市場平均價。實測覆蓋:25/26 季 Pinnacle 只覆蓋 ~50%(E0 210/380、SP1 189/380、D1 150/306、I1 200/380、F1 153/306),AvgC*/B365C* 全覆蓋。後果見 §4.2 — holdout 嘅收盤錨數字要打折睇。

## 3. RQ1 — 最佳 w:唔存在(概率分數)

主客和 Brier(越低越好),三個 scope 都係 **w=0 嚴格最優,單調轉差**:

| scope | 錨 | w=0 | w=0.1 | w=0.2 | w=0.3 | w=0.5 | w=1(純模型) |
|---|---|---:|---:|---:|---:|---:|---:|
| tune (n=7443) | open | **0.5778** | 0.5784 | 0.5792 | 0.5803 | 0.5834 | 0.5958 |
| tune (n=7451) | close | **0.5760** | 0.5766 | 0.5774 | 0.5786 | 0.5820 | 0.5957 |
| validation (n=1752) | open | **0.5726** | 0.5732 | 0.5740 | 0.5750 | 0.5777 | 0.5882 |
| validation | close | **0.5705** | 0.5711 | 0.5719 | 0.5731 | 0.5761 | 0.5882 |
| holdout (n=902) | open | **0.5723** | 0.5725 | 0.5730 | 0.5736 | 0.5756 | 0.5846 |
| holdout (n=898) | close | **0.5732** | 0.5732 | 0.5734 | 0.5739 | 0.5757 | 0.5845 |

LogLoss / RPS 同型;xg 模型(w=1 時 Brier 0.583–0.591)好過 goals(0.584–0.596)但都係單調差過 w=0。大細波 Brier 同型(validation open:w=0 0.2388 → w=0.1 0.2387 → w=0.5 0.2397;w=0.1/0.2 嘅 0.0001 級差異統計上等於零)。

**學術問題嘅答案(RQ2 嗰半):模型對市場冇增量概率資訊。** 唔係「模型啲偏差修正有價值」,係「模型同市場唔同嘅地方就係噪音」。

## 4. RQ1/RQ4 — 模擬落注 ROI(3% 閘,flat 1u)

### 4.1 實戰配置(open 錨,用開盤價落注)— 驗證季

| 玩法 | 模型 | 最佳 w | 注數 | ROI | 95% CI(cluster bootstrap) |
|---|---|---|---:|---:|---|
| 主客和 | goals | 0.2 | 226 | **-21.57%** | [-41.36%, -0.22%] |
| 主客和 | xg | 0.5 | 1019 | **-11.39%** | [-21.77%, -0.19%] |
| 大細 | goals | 0.4 | 671 | +0.49% | [-7.33%, +8.26%] |
| 大細 | goals | 1(純模型) | 1285 | +0.29% | [-5.33%, +6.09%] |
| 讓球 | xg | 0.5 | 599 | -0.79% | [-8.04%, +6.40%] |
| 讓球 | goals | 1 | 1278 | -4.32% | [-9.11%, +0.66%] |

主客和全軍覆沒(w≥0.2 全部雙位數負)。大細/讓球最接近零,但 CI 全部大幅跨零,而且「最佳 w」每個玩法唔同、同概率分數嘅排序矛盾 — 係噪音唔係訊號。

### 4.2 Holdout(2025/26,一次性開封;Pinnacle 覆蓋 ~50%)

| 玩法 | 配置 | 注數 | ROI | 95% CI |
|---|---|---:|---:|---|
| 主客和 | goals w=0.3(現行 dc-v2 權重)open→open | 291 | **-13.00%** | [-32.02%, +7.52%] |
| 大細 | goals w=0.4 open→open | 346 | +1.58% | [-9.14%, +12.28%] |
| 大細 | goals w=0.5 open→open | 447 | +2.42% | [-6.97%, +11.78%] |
| 讓球 | xg w=0.3 open→open | 119 | +3.90% | [-12.43%, +20.26%] |
| 讓球 | xg w=0.3 close→close | 181 | +5.42% | [-7.39%, +18.88%] |

Holdout 冇反轉 validation 嘅結論:主客和繼續大負;大細/讓球點估計微正但 CI 闊到咩都講唔到(±10–20%)。就算想睇「微贏」故事,預先登記條件「某個 w 喺**驗證季**好過 w=0」首先就唔成立,holdout 冇嘢可以救返。

### 4.3 CLV 幻覺(點解 close 錨 bet 喺 open 價會「贏」)

用收盤去水概率落注開盤價(實戰做唔到,收盤價開波先知):tune 主客和 +4.68%、大細 +8.03%(CI[+3.78%, +12.09%]),validation 大細 +11.28%(CI[+2.47%, +19.98%]) — 呢個係市場開盤→收盤移動本身嘅資訊含量,同模型無關(w=0 已經係最佳,w 越大越差)。**Holdout 呢條線反轉**(主客和 -13.00%),同 §2.2 嘅 Pinnacle 污染警告吻合:25/26 嘅「收盤」欄位唔再可靠。教訓:之後任何涉及 25/26 嘅研究要用 AvgC*/B365C* 做 robustness 對照。

### 4.4 consensus-v1 代理基線

注數太少(validation 主客和 20 注、大細 16 注) — Avg 價同 Pinnacle 價太接近,3% 閘幾乎冇交集。離線環境無法公平重現 consensus-v1 嘅多莊 LOO;佢嘅實績由 shadow/performance 管道話事,呢度如實記錄「無結論」。

## 5. 校準同 edge 分桶(預先登記度量)

**校準本身係好嘅** — 呢點重要:blend(goals/open/w=0.3)主客和喺 tune 同 validation 嘅中間桶 gap 全部 |gap| ≤ 0.03,冇持續高估。所以失敗唔係「概率吹大咗」,係「同市場唔同嘅部分冇預測力」。

**Edge 分桶單調性:全部 scope、全部玩法都 `monotone=false`** — 同 corner-loo-v1 死法一致。validation 主客和甚至係完美反單調:edge 3–5% 桶 ROI -3.22%,edge 5–8% 桶 -24.58%,edge 8–12% 桶 -28.10%。「edge 越大」喺呢個框架入面只係「模型同市場分歧越大」= 錯得越多。

**逐聯賽:** 冇單一聯賽故事。validation 主客和 D1 -47.37% vs F1 +19.73% — 純離散噪音;holdout 讓球 E0 +16.52% vs F1 -20.50% 同型。按預先登記,單聯賽/單方向有效 = 過擬合,唔升格。

## 6. RQ3 — 對 HKJC 嘅可投注性

HKJC 歷史賠率喺本地 archive 冇足夠長嘅歷史(收集 2026 年中先開始),離線答唔到,要靠影子模式向前收集 — 同研究文檔預期一致。但推理係單向嘅:**blend 連 Pinnacle(低抽水 sharp 價)都贏唔到,對住抽水更高嘅 HKJC 只會更差**。呢條線唔使等影子數據已經可以判死。

## 7. 預先登記判定對照

| 條款(研究文檔 §6) | 結果 |
|---|---|
| 某個 w 喺驗證季好過 w=0 | ❌ 概率分數全敗;ROI 無配置顯著好過永不下注 |
| Holdout 唔反轉 | ✓ 冇反轉(但前提已唔成立) |
| Holdout ROI 點估計 >0 且區間唔明顯負 | ❌ 主客和 -13%;大細/讓球 CI 全部跨零 ±10–20% |
| 校準唔持續高估 | ✓ 通過(唯獨呢項) |
| Edge 分桶合理單調 | ❌ 全部玩法、全部 scope 非單調 |
| 只係單一聯賽/方向有效 → 過擬合 | 觀察到嘅離散屬噪音,唔構成例外 |

**判定:不通過。** Blend 思路喺離線被證偽 — 唔係「w 揀錯」,係「五大聯賽主流玩法入面,dc 家族模型相對市場冇可提取嘅系統性偏差」。

## 8. 後續行動

1. **`dc-v2` / `dc-blend-v1` 唔升格。** 影子線可以照跑(零成本,繼續儲對照證據),但 trust gate 維持唔信任;就算 30 場後影子 ROI 為正,都要同呢份離線否定對照先好談。
2. **資源轉去 Phase 2(角球可行性)同 Phase 3(報價質素閘)** — 主流玩法嘅市場效率墙已經用三個度量、兩個錨、兩個模型、三個 scope 確認。
3. **修正舊報告措辭:** 引用 dc-v1-backtest「Pinnacle 收盤」嘅地方(Brier 0.5777、大細 ROI -2.07%)應註明係 pre-closing 價;真收盤基準更強,原結論方向不變。
4. **數據基建:** 25/26 起 Pinnacle 欄位唔可信;之後研究預設用 AvgC* 做收盤基準,Pinnacle 只做對照。新 parser 欄位已備妥。
5. **基建保留:** `scripts/dc-blend-backtest.mjs` 嘅 records cache(`data/blend-backtest/records-*.json`)令任何後續 w/錨/玩法實驗唔使重fit;校準/edge 分桶/cluster bootstrap 已入 `backtest-metrics.mjs` 供之後所有回測重用。

## 9. 可重現性

```bash
node scripts/dc-blend-backtest.mjs --self-test                    #  sanity
node --test scripts/backtest-metrics.test.mjs                     #  新度量測試(15 個)
node scripts/dc-blend-backtest.mjs                                #  tune+validation(用 cache)
node scripts/dc-blend-backtest.mjs --rebuild                      #  重建 records(~12s 五聯賽)
node scripts/dc-blend-backtest.mjs --include-holdout \
  --pick model=goals,anchor=open,w=0.3,betPrice=open              #  一次性開封(已執行)
```

12,644 場 records(含 xG join 12,440 場;1 場 join 比分不符,已記 warning)。Walk-forward 規則同 dc-v1-backtest 完全一致:首季 burn-in、每 10 日 warm-start 重估、per-league xi(E0/I1 0.003,SP1/D1 0.001,F1 0.0019)。

## 10. 引擎 level-drift 修補後重跑(2026-08-24 下午,owner 拍板)

**背景:** Phase 2 發現 dc 引擎 level-drift bug(詳見 `PHASE-2-corner-results-2026-08-24.md` §3)— 當時淨係修咗 corners 路徑,goals/xg 保持凍結。Owner 其後拍板修埋 goals/xg;本節記錄修補後嘅量化影響。**判定不變。**

**改動:** `scripts/lib/dixon-coles.mjs` 嘅 level-preserving centring 由 corners-only 推展到全部 response;新回歸測試守住 goals 路徑嘅 in-sample level 無偏(`dixon-coles.test.mjs`,17/17)。**Holdout(25/26)冇重開** — 以下全部係 tune/validation 數字;`blend-results-with-holdout.json` 保留修補前嘅一次性開封紀錄唔郁。

### 10.1 dc-v1-backtest 重跑(10,951 場,pre-closing 錨,同 §3.2 validity 報告口徑)

| 指標 | 修補前 | 修補後 |
|---|---:|---:|
| dc-v1 主客和 Brier | 0.5942 | **0.5932**(微改善;Pinnacle 0.5777 不變) |
| 主客和 ROI(3% 閘) | -9.66% | -9.68% |
| 大細 ROI | -2.07% | -3.66% |
| 讓球 ROI | -4.02% | -3.66% |

修補將 λ 水平拉返落嚟 ~9–13%,Brier 微改善,但模擬 ROI 全部仍然為負 — 水平偏差唔係「輸畀市場」嘅原因,只係令輸嘅形狀唔同。

### 10.2 Blend harness 重跑(tune + validation)

- **概率分數排序完全唔變:** 全部 scope、兩個錨、兩個模型都係 **w=0 嚴格最優、單調轉差**。純模型 w=1 嘅 Brier 微改善(validation open:goals 0.5882→0.5872,xg→0.5822),但仍然大幅落後 w=0(0.5726)。
- **校準疑慮解除:** Phase 2 §3.3 擔心「高咗 13% 嘅入球率模型唔可能校準良好」— 修補後實測主客和中間桶 |gap| ≤ 0.03、大細中間桶 |gap| ≤ 0.012,校準依然良好(校準好係因為混合以市場錨為主,bug 影響嘅係模型嗰 30–50% 權重嘅水平)。
- **Edge 分桶:** 全部玩法、全部 scope 仍然 `monotone=false` — 核心死因唔變。
- **ROI:** 主客和 w≥0.2 繼續雙位數負(validation goals w=0.3:-19.51%,CI[-32.61%, -6.03%])。大細 goals w=0.2 出現 +29.94%(CI[+1.93%, +57.65%])— 但 **n=54**,係 72 個配置入面嘅單點,同概率分數排序矛盾,按預先登記嘅多重比較原則當噪音處理,唔構成反轉。

### 10.3 對生產影子線嘅影響(部署後生效)

下次部署起,`dc-shadow-v1` / `dc-blend-v1` / `dc-xg-shadow-v1` 嘅 λ 水平會降 ~9–13%:

- **修補前後嘅影子證據喺大細盤上唔直接可比**(水平平移);主客和/讓球受影響較細(比率主導)。
- strategyVersion 唔變 — 比較影子 ROI 時以部署日做分界解讀;`-gated` 雙生線反正係部署後先開始儲,冇歷史包袱。
- 修補前嘅 frozen 行為可喺 git history(`95340c4` 之前)重現。
