# Phase 1 研究報告:市場錨定混合模型(Market-Anchored Blend)

**日期:** 2026-08-24
**狀態:** ❌ 已有結果(2026-08-24):blend 思路離線證偽,任何 w 都贏唔過純市場 — 詳見 `PHASE-1-results-2026-08-24.md`
**目的:** 解決「純模型贏唔到市場」呢個核心問題 — 唔再叫模型單打獨鬥,而係用 sharp 市場做錨,模型只學市場嘅系統性偏差。

---

## 1. 核心論點

你自己嘅 walk-forward 已經證明咗:

| 預測者 | Brier(主客和,越低越好) |
|---|---:|
| Pinnacle 收盤去水 | **0.5777** |
| dc-xg-v1(xG 版) | 0.5899 |
| dc-v1(比數版) | 0.5942 |

> **勘誤(2026-08-24,見結果報告 §2.1):** 上表「Pinnacle 收盤」實為 **pre-closing** 價(PSH/PSD/PSA);真收盤(PSCH 等)去水 Brier 係 **0.5760**,比 0.5777 更強。結論方向不變 — 模型落後市場嘅距離比本表顯示嘅更大。同樣,§4 引用嘅大細波 ROI -2.07% 亦係對住 pre-closing 價計。

純模型打唔贏市場,呢個同學術文獻一致 — 足球主流市場接近有效率。但文獻同實務都指出另一條路:**市場 + 模型嘅混合,好過任何一邊單獨**。模型嘅價值唔係「代替市場」,而係喺市場有已知弱點嘅地方(例如熱門-冷門偏差、某類聯賽、開盤初期)做細微修正。

## 2. 好消息:基建已經行得比預想前

代碼實查發現,呢個 Phase 唔係由零開始:

| 組件 | 狀態 | 位置 |
|---|---|---|
| Sharp 加權市場共識(Pinnacle 權重 1.0,HKJC 只 0.1) | 已實作 | `scripts/lib/market-sharp.mjs` `BOOKMAKER_WEIGHTS` |
| Shin 去水(主客和,處理熱門-冷門偏差) | 已實作 | `shinProbabilities` |
| Power 去水(兩邊盤:大細/讓球/角球) | 已實作 | `powerNoVigTwoWay` |
| 混合定價:30% 模型 + 70% 市場 | **已以影子策略上線** | `dc-blend-v1`/`dc-v2`,`DC_BLEND_MODEL_WEIGHT = 0.3` |
| 混合嘅市場錨 | 已實作 | `marketReferenceChance`(sharp 加權共識) |
| Walk-forward 回測框架 | 已實作 | `scripts/dc-v1-backtest.mjs` |
| Pinnacle 收盤價(做離線驗證基準) | **已喺本地 CSV** | `PSCH/PSCD/PSCA`、`PC>2.5/PC<2.5`、`PCAHH/PCAHA` |

即係話:blend 嘅即時影子版本已經喺度儲緊證據,而**離線驗證嘅所有材料都齊** — 35 個 CSV、五聯賽、七季、Pinnacle 收盤齊三個玩法。

## 3. 研究問題(按價值排序)

### RQ1 — 最佳混合權重 w 係幾多?

而家 `w = 0.3` 係文獻常見起點,唔係你數據嘅答案。用現有 walk-forward harness 掃 `w ∈ {0, 0.1, 0.2, 0.3, 0.4, 0.5}`:

- `w = 0` = 純市場(基線)
- `w = 1` = 純模型(已知輸)
- 每個 w 計 Brier / log-loss / RPS,同埋喺 Pinnacle 收盤價嘅模擬 ROI

**預期:** 某個細 w(0.1–0.3)會好過 w=0,如果連呢個都唔成立,blend 思路就要停,唔好再投資。

### RQ2 — 市場錨用邊個?

離線回測入面有兩個選擇:

1. **Pinnacle 收盤**做錨(最強,但係「事後」資訊 — 你實戰買嗰陣見唔到收盤價)
2. **開盤/早段市場共識**做錨(貼近實戰,但 CSV 只有收盤)

誠實做法:用 Pinnacle 收盤做錨嚟答「模型有冇增量資訊」(學術問題),然後承認實戰個錨係臨開波 live 共識(即影子模式而家收集緊嘅嘢)。兩個答案都正,先至可以升格。

### RQ3 — 對 HKJC 價錢嘅可投注性

最終推薦係要喺 HKJC 落到注。HKJC 係高抽水 recreational book,混合模型嘅 edge 要**大過 HKJC 抽水 + 3% 閘門**先有意思。離線實驗要加一條線:blend 概率 vs HKJC 實際價(HKJC 歷史賠率喺 archive 有冇夠長嘅歷史要查 — 冇嘅話呢條線只能靠影子模式向前收集)。

### RQ4 — 邊個玩法最有增量?

讓球係你最常玩嘅玩法,而且 dc 引擎有完整嘅五態結算分佈(win/half-win/push/half-loss/loss)可以精準定價亞洲盤(包括四分之一盤)。大細波 walk-forward ROI -2.07% 係三個玩法入面輸最少嘅 — 離市場最近,最值得試 blend。

## 4. 離線實驗設計

### 4.1 數據切割(預先登記,唔准事後改)

- **訓練/調參:** 2019/20–2023/24(五季)
- **驗證(揀 w):** 2024/25
- **最終 holdout(一次性開封):** 2025/26

### 4.2 度量

每個 (玩法, w) 組合報:

- Brier / log-loss / RPS vs Pinnacle 收盤去水
- 模擬 ROI(喺 Pinnacle 收盤價 flat-stake 過 3% 閘)
- 校準曲線(預測概率分桶 vs 實際命中率)
- Edge 分桶單調性(edge 大嘅桶應該 ROI 高啲 — corner-loo-v1 就係死喺呢度)

### 4.3 基線(全部要齊)

1. 永不下注(ROI 0%)
2. 純市場(w=0)
3. 純模型(w=1,已知輸,做對照)
4. 現行 `consensus-v1` LOO(舊思路嘅代表)

## 5. 實作計劃

| 步驟 | 內容 | 涉及檔案 |
|---|---|---|
| 1 | 新回測 script:blend walk-forward + w sweep | `scripts/dc-blend-backtest.mjs`(新) |
| 2 | 重用 dc harness 嘅資料切割同度量 | `scripts/dc-v1-backtest.mjs`、`scripts/lib/backtest-metrics.mjs` |
| 3 | 加入校準曲線同 edge 分桶輸出 | `scripts/lib/backtest-metrics.mjs`(additive) |
| 4 | 結果寫入報告,預先登記嘅 holdout 一次性開封 | `docs/research/PHASE-1-results-*.md` |
| 5 | 如離線通過:影子模式繼續,夠 30+ 場先談升格 | 現有 trust gate 流程 |

**紅線:** 唔改四個舊模型嘅數學(ADR 0003);新結果用新 `modelVersion`(blend 已經係 `dc-v2`);3% 閘門唔郁。

## 6. 通過/不通過嘅判定(預先登記)

**通過(可進入升格程序):**
- 某個 w 喺驗證季好過 w=0,且 holdout 唔反轉
- Holdout 模擬 ROI 點估計 >0,bootstrap 區間唔好明顯負
- 校準唔持續高估;edge 分桶有合理單調性

**不通過(停止投入):**
- 任何 w 都贏唔到純市場 → blend 思路證偽,资源轉去 Phase 2/3
- 只係單一聯賽/單一方向有效 → 視為過擬合,唔升格

## 7. 風險同限制

| 風險 | 說明 |
|---|---|
| 覆蓋只得五大聯賽 | dc fit 依賴 team history;HKJC 嘅日韓波等冇 fit,blend 幫唔到嗰啲場 |
| 離線贏 Pinnacle 收盤 ≠ 實戰贏 HKJC | 兩層驗證要分開講,唔好混為一談 |
| 期望要現實 | 就算成功,主流玩法長遠 ROI 上限大約 0–3%;blend 嘅真正價值可能係「少輸當贏」變「微贏」 |
| 影子證據集中喺開波前 25 分鐘 | 見 Phase 0 §2.1;實戰錨係臨開波共識 |

## 8. 預期成果

1. 一份有預先登記切割嘅 blend 離線驗證報告(可以答「模型對市場有冇增量資訊」)
2. 最佳 w 同適用玩法嘅明確結論
3. 通過嘅話:`dc-v2` 由影子進入升格程序;唔通過嘅話:乾淨嘅否定結論,唔使再浪費時間
