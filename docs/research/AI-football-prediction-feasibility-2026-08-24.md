# 用歷史足球數據＋賠率做 AI 預測／盈利推薦：可行性判定

**日期：** 2026-08-24  
**研究問題：** 「用大量過去數據同賠率，經 AI／量化處理得出足球預測，並長期產生可盈利推薦」究竟行唔行得通？  
**判定：** **做概率預測可行；持續比市場更準屬條件式可行；扣除水位後長期正回報只屬低把握、必須用新資料證明嘅研究假說。現有 repo 證據不支持將任何 AI 當成盈利推薦引擎。**

## 已確認待辦（先完成核心可行性決策，暫緩實作）

- [ ] 將正式推薦 trust gate 改為動態證據門檻：只有 `performance-trusted` 先可出推薦，未達標一律顯示收集中／未驗證。
- [ ] 將「市場預測」同「正式推薦」拆成兩個產品概念及畫面狀態。
- [ ] 停止再微調或升格現有 DC／xG／blend family；保留只作已證偽對照。
- [ ] 賠率收集擴展為 point-in-time 時間線（建議 24h／6h／60m／15m／5m），所有資料保存當時已知時間。
- [ ] 報價質素閘門繼續獨立 forward A/B；未通過前不得接入正式推薦。

以上五項已 mark 為要做，但依賴本文第 7 節核心 POC 決策；先確認系統有冇可提取預測力，再執推薦流程同 UI。GitHub issue 因本機 `gh` 尚未登入而未能建立，登入後可直接將本 checklist 搬入 issue tracker。

---

## 1. 先拆開三個唔同問題

「預測到」、「比市場更準」同「賺到錢」唔係同一件事，亦唔一定係簡單直線關係。

| 問題 | 真正要證明嘅嘢 | 可行性 | 本 repo 現況 |
|---|---|---|---|
| 1. 預測賽果／概率 | 每場輸出主勝／和／客勝、入球或角球嘅合理概率分佈 | **可行** | 市場去水概率本身已經可以做強基線；DC／Poisson 亦能輸出概率 |
| 2. 比市場更準 | 喺同一預測時間點，長期用 proper scoring rule（log-loss／Brier）贏去水後 sharp 市場 | **條件式可行，但難** | Phase 1 所有 model weight `w > 0` 都輸純市場；Phase 2 角球只同聯賽均值打和 |
| 3. 扣水後正回報 | 喺實際可買價、扣佣／水位／失配後，out-of-sample ROI 仍為正 | **原理上可行；現系統未證明，而且成功先驗機會低** | 主流玩法回測全負；角球 live 證據大負；Phase 3 只係 in-sample 候選 |

兩個重要細節：

1. **整體比市場更準，唔保證會盈利。** Reade、Singleton、Vaughan Williams 嘅英超研究發現統計模型喺精確比數概率上有較佳預測證據，但約 12% overround 足以令簡單投注策略無持續正回報。[作者手稿／University of Reading](https://centaur.reading.ac.uk/89738/1/reade_singleton_scorelines.pdf)
2. **整體分數略差過市場，亦唔邏輯上排除局部可盈利。** Holmes、McHale 嘅球員評分模型測試中，Bet365 仍有最好整體 accuracy／Brier，但球員模型喺經 validation 選定嘅下注規則下，1,350 場 test set 中報告正 ROI；即係盈利可以來自一小撮局部錯價，而唔係全場概率全面壓過市場。[International Journal of Forecasting 原文](https://doi.org/10.1016/j.ijforecast.2023.03.002)

所以系統唔應該用「命中率高」代替第 2 或第 3 個問題，亦唔應該用一次正 ROI 代替長期可複製證據。

---

## 2. 點解第 1 層肯定可行

### 2.1 足球概率模型係成熟方法

Dixon–Coles 早於 1997 年已用隨時間變動嘅 Poisson 強度估計足球比數同賽果概率，亦討論投注市場偏差。呢類模型可以將球隊攻守、主場優勢同近期權重轉成完整比分分佈；所以「歷史數據 → 概率預測」本身冇技術障礙。[JRSS Series C 原文](https://doi.org/10.1111/1467-9876.00065)

但「可以估概率」只代表有一個 forecast，唔代表個 forecast 比市場好。市場賠率亦係一套概率預測，只係要先移除莊家水位。Štrumbelj 用 37 個賽事、5 種團隊運動比較由賠率還原概率嘅方法，發現 Shin 方法整體比簡單正規化同回歸式方法準；市場愈大，不同莊家／去水法嘅差距愈細。[International Journal of Forecasting 原文](https://doi.org/10.1016/j.ijforecast.2014.02.008)

### 2.2 「大量數據」有用，但資料內容比模型名稱重要

Arntzen、Hvattum 將球隊 Elo 同正選球員 plus-minus 評分分開測試：單獨用球隊或球員評分表現相若，但兩者合併顯著較好。即係真正增量可能來自「今場邊個落場」而唔係再換一個更複雜分類器。[Statistical Modelling 原文](https://doi.org/10.1177/1471082X20929881)；[作者補充材料](https://www.statmod.org/smij/Vol21/Iss5/Arntzen/Supplement.pdf)

Holmes、McHale 進一步用球員能力同對位互動直接描述球隊動態實力，報告預測模型對莊家比較及 Kelly 型下注均有顯著正回報；佢哋嘅 test 結果包含數百至逾千注，視乎門檻／staking 設定。[International Journal of Forecasting 原文](https://doi.org/10.1016/j.ijforecast.2023.03.002)

呢兩篇係支持「AI 足球預測有可行性」最直接嘅平衡證據；但佢哋支持嘅係**球員／正選陣容級特徵**，唔係「只加更多歷史比分同舊賠率就會贏」。單一歷史研究亦唔等於喺 2026 年 HKJC 價格、現有聯賽同實際執行條件下仍保有同一 edge。

---

## 3. 點解第 2、3 層難好多

### 3.1 賠率唔只係一個 feature，而係市場集體 forecast

Forrest、Goddard、Simmons 用接近 10,000 場英格蘭足球比較包含大量量化變數嘅統計模型同莊家賠率；賠率預測能力喺五年間提高，bootstrap 版本嘅統計模型都未能超越莊家。[International Journal of Forecasting 原文](https://doi.org/10.1016/j.ijforecast.2005.03.003)

Elaad、Reade、Singleton 用 2010–2018 年超過 16,000 場英格蘭賽事、51 間莊家測試市場效率：整體市場無顯著可拒絕嘅偏差；其他莊家價雖可顯著改善單一莊家，但只解釋該莊家 forecast error 最多約 0.1%。即係跨莊家差異可以係訊號，但量級非常細。[Finance Research Letters 作者手稿](https://centaur.reading.ac.uk/86111/1/betting_efficiency_elaad_reade_singleton.pdf)

Croxson、Reade 用 1,206 場、second-by-second Betfair 價格研究入球消息，發現價格迅速而完整更新。呢個係提醒：陣容、入球、傷停等有價值資訊一公開，edge 可能好快被市場吸收。[The Economic Journal 作者頁／手稿](https://centaur.reading.ac.uk/34884/)

### 3.2 模型目標錯咗，accuracy 高都可以輸錢

投注期望值係：

`EV = 模型概率 × 實際可買賠率 − 1`

只優化「猜中邊隊贏」會忽略概率校準、莊家水位同模型同市場嘅相關性。Hubáček、Šourek、Železný指出，如果模型同莊家預測高度相關，即使預測唔差亦會因 margin 輸；佢哋改為同時減低同莊家預測嘅相關性，並用 portfolio 方法分配注碼。不過該實證係 NBA 2007–2014，方法論可以借，ROI 唔可以直接移植去足球。[International Journal of Forecasting 作者原文](http://ida.felk.cvut.cz/zelezny/pubs/ijf.2019.pdf)

因此下一個 AI 唔應再以「預測實際賽果」作唯一 target；應該研究：

- 市場去水概率已解釋咗幾多；
- 新特徵可唔可以穩定預測 `actual outcome − market probability` 嘅殘差；
- 預測 edge 有冇同之後市場移動（CLV）及實際 ROI 同方向。

### 3.3 水位係一道真實數學門檻

莊家各結果倒數概率加埋通常大於 1；多出部分係 overround。就算模型比隨機、聯賽均值或舊模型準，改善幅度若細過水位，仍會負期望。Reade 等人嘅研究正正展示「概率預測較好」但不足以穿過高 overround。[作者手稿](https://centaur.reading.ac.uk/89738/1/reade_singleton_scorelines.pdf)

交易所亦唔係零成本：Betfair 官方規則係只對一個市場嘅 net winnings 收 commission，實際率視地區／方案而定。[Betfair 官方 commission 說明](https://support.betfair.com/app/answers/detail/413-exchange-what-is-commission-and-how-is-it-calculated/)

### 3.4 見到歷史盈利，好容易只係多重測試撞彩

Winkelmann、Ötting、Deutscher、Makarewicz用模擬同五大聯賽 14 季數據檢查市場偏差：單一季度會出現「顯著」失效，但跨聯賽、跨時間並不持續；喺完全有效市場模擬中，以 10% 顯著水平逐季檢查，14 季內至少見一次假陽性嘅機率可達 77.63%。[Journal of Sports Economics 原文](https://doi.org/10.1177/15270025231204997)

呢點直接否定「試幾十個 feature、玩法、edge 門檻、聯賽，再揀 ROI 最高嗰格」作證明。所有門檻、玩法、切割同停止規則要預先登記，final holdout 只開一次。

---

## 4. 市場並非絕對不可打敗：正面證據代表乜

以下研究顯示局部、特定時期嘅 edge 可能存在；但每個案例都有清楚來源，並非「AI」三個字本身創造盈利。

| edge 來源 | 一手證據 | 對本系統嘅含意 | 限制 |
|---|---|---|---|
| 球員能力、實際正選、對位 | Holmes、McHale 報告 player-based 模型喺 test set 用 Kelly／flat 策略得到正回報。[原文](https://doi.org/10.1016/j.ijforecast.2023.03.002) | 值得做唯一一輪有實質新資訊嘅模型 POC | 一篇歷史測試唔保證 2026 HKJC 可複製；要有 point-in-time 陣容資料 |
| 球隊＋正選球員評分 | 合併 team Elo 同 starting-lineup player ratings 顯著優於各自單獨使用。[原文](https://doi.org/10.1177/1471082X20929881) | 下一代模型應由「隊名」深入到「今場落場球員」 | 論文證明預測改善，唔等同扣水後盈利 |
| xG 表現與賽果過度／不足表現差 | Flepp、Merz、Franck 用 2018/19 外部測試：back underperformers、lay overperformers 共 1,305 注，報告扣 4% commission 後 ROI 2.2%。[Economic Inquiry 原文](https://doi.org/10.1111/ecin.13163)；[公開研究資料說明](https://doi.org/10.3886/E187181V2) | 可以重現一條「市場殘差／outcome bias」研究線 | 只係一個 holdout season；原數據有授權限制；edge 可能隨 xG 普及衰減 |
| 賠率共識與單一莊家錯價 | Kaunitz、Zhong、Kreiner 唔同莊家競爭預測，而係用跨莊家 aggregate 當真實概率，再買偏離價；佢哋報告 10 年歷史、paper trading 同 5 個月真金白銀均盈利，亦報告成功後戶口被限額。[arXiv 原文](https://arxiv.org/abs/1710.02824)；[作者重現代碼](https://github.com/Lisandro79/BeatTheBookie) | 支持「市場共識＋HKJC 錯價 scanner」可能比純賽果 AI 更貼近目標 | 可買價、延遲、莊家限額同資料完整性都係 production 問題；舊結果要重新 forward 驗證 |
| 市場對近期賽果過度反應 | Wheatcroft 用 20 個聯賽、12 季建立 COD 指標，報告長期買入相對預期表現差嘅球隊有正回報。[Journal of Quantitative Analysis in Sports 原文](https://doi.org/10.1515/jqas-2019-0009) | 可以作一條預先登記、低自由度嘅 bias replication | 同其他市場效率研究有衝突；未喺本系統 target 價格重現 |

所以答案唔係「市場百分百有效，永遠冇可能」，而係：**edge 若存在，通常細、局部、會衰減，並依賴市場未完全吸收嘅資料或執行差異。**

---

## 5. 現 repo 證據對原構想嘅判定

### 5.1 Phase 1：歷史入球／xG 加入市場，冇增量

[Phase 1 結果](./PHASE-1-results-2026-08-24.md)用 12,644 場五大聯賽、walk-forward、tune／validation／holdout，比較純市場同 DC／xG blend：

- 主客和所有 scope、open／close 錨、兩種模型都係 `w = 0`（純市場）最好；任何 `w > 0` 都令 Brier／log-loss 轉差。
- level-drift 修補後，`dc-v1` 主客和 Brier 只由 0.5942 改善到 0.5932，仍差過市場 pre-closing 0.5777；主客和／大細／讓球 ROI 分別約 -9.68%／-3.66%／-3.66%。
- edge 分桶非單調；模型同市場分歧越大，唔係越有價值。

呢個係對**現有 DC／xG family ＋現有 feature set**嘅有力否定。唔係證明所有 AI 永遠失敗，但足以停止再微調同一模型權重。

### 5.2 Phase 2：角球模型冇每場可提取訊號

[Phase 2 結果](./PHASE-2-corner-results-2026-08-24.md)用 10,954 場五大聯賽 walk-forward：角球 DC validation log-loss 2.6319，只同聯賽均值 Poisson 2.6316 打和；逐聯賽三負兩勝，大細盤差距只係噪音級。即係喺現有歷史角球／球隊層資料，增加隊伍結構冇帶來可用增量。

### 5.3 Production 舊 AI 同 Phase 3 都未提供反證

[有效度實作報告](../MODEL-VALIDITY-IMPLEMENTATION-REPORT-2026-08-23.md)記錄：`corner-loo-v1` 33 場／164 推薦 ROI 約 -41.7%，edge 越高反而越差；其餘現行 AI 樣本不足。

[Phase 3 結果](./PHASE-3-results-2026-08-24.md)將報價上限收緊後，舊 200 個推薦 replay 有改善，但 189 個係角球，而且用同一批「屍體」揀參數，明確屬 in-sample。呢個只係值得 forward A/B 嘅 quote-cleaning 假說，唔係 AI 新預測力。

### 5.4 ADR 0003 嘅含意

[ADR 0003](../adr/0003-model-freeze-lifted-parallel-model-experiments.md)容許新 AI 用新 `modelVersion` 平行實驗，但 30 場只係最低 readiness，唔係有效證明；舊模型不可改名洗底。呢個方向正確，但「可實驗」同「值得信」仍須分開。

### 5.5 總判定

- **已證偽：** 「只靠現有歷史比分／聯賽 xG／角球數，再調 DC 或同市場混合權重，就能形成穩定推薦。」
- **未被證偽、值得一次有界測試：** 「加入 point-in-time 正選球員／傷停／球員級表現，再直接學市場殘差，可能找到局部 edge。」
- **未被證明：** 「跨莊家共識可穩定辨認 HKJC 可買錯價。」Phase 3 必須 forward 驗證。
- **不可承諾：** 「大量歷史數據＋任何 AI 會自動產生長期盈利。」資料量唔會自己創造市場未有嘅資訊。

---

## 6. 原構想要點樣改，先成為可檢驗假說

原構想「歷史數據＋賠率 → AI → 預測」可以保留，但核心目標應改成：

> **以同一時間點嘅去水市場概率作 baseline，AI 只負責估計市場未包含嘅 residual；推薦層再用當刻實際可買價檢查扣水後 EV。**

```text
point-in-time 歷史資料 ─┐
                        ├─> 市場 baseline + residual AI ─> 校準概率
同一時間點市場賠率 ────┘                              │
                                                       v
實際 HKJC 可買價 + 結算規則 + freshness ───────────> EV／不下注
```

必要條件：

1. **新資訊，而唔係新算法包裝。** 優先順序應係正選陣容、球員傷停／停賽、球員級 xG／plus-minus、休息日／旅程／賽程密度、天氣；每欄要有「當時已知時間」。
2. **同時點比較。** 24h、6h、60m、15m、5m snapshot 要分開；唔可以用 closing probability 解釋早段可買價，否則係未來洩漏。
3. **市場 baseline 必須夠強。** 主客和用 sharp 多莊／exchange 去水共識；讓球／大細要同一盤口、同一結算語義；HKJC 只係買入目標，唔應加入「真實概率」共識。
4. **直接驗證增量。** 先測 residual AI 有冇喺 final holdout 改善 log-loss／Brier、校準同 edge 分桶；唔通過就唔應睇 ROI 揀故事。
5. **production economics。** ROI 必須使用當刻真實可買賠率、佣金／水位、push／half-win、報價延遲、void、限額；另報 CLV，避免靠短期賽果運氣冒充 edge。
6. **低自由度預先登記。** 特徵、玩法、聯賽、edge threshold、下注規則、validation 同一次性 holdout 全部實驗前鎖定；所有嘗試都要留喺 experiment registry，防止只展示贏家。

---

## 7. 建議唯一一輪核心可行性 POC

目標唔係即刻整新推薦，而係用最低成本回答：**我哋有冇市場之外嘅資訊優勢？**

### POC A：球員／正選陣容 residual 模型（首選）

- 只做主客和，避免一次開四個玩法增加多重測試。
- baseline：同時間點 sharp consensus 去水概率。
- 新 feature：預計／正式正選、球員 rating、缺陣、休息日；資料必須 point-in-time。
- 模型先由 regularized multinomial logistic／gradient boosting 開始；深度學習唔係必要前提。
- target：相對市場概率嘅 residual；另做「市場-only」同「球隊-only」ablation。
- primary gate：final holdout proper score 相對市場有穩定改善，並有 paired／cluster uncertainty。
- economic gate：只用預先定義規則，HKJC 真實可買價扣水後 ROI／CLV 為正，edge bucket 合理單調；唔可以因結果唔好再抽單一聯賽或方向。

選呢條線嘅原因唔係潮流，而係 Arntzen–Hvattum 同 Holmes–McHale 都直接指出球員／正選資訊有增量，而現 repo 尚未測呢一層。[Arntzen–Hvattum](https://doi.org/10.1177/1471082X20929881)；[Holmes–McHale](https://doi.org/10.1016/j.ijforecast.2023.03.002)

### POC B：市場 overreaction replication（只作後備）

若球員資料不可取得，可預先照抄一個低自由度假說：用 xG 表現相對賽果／賠率預期嘅 over-／under-performance，重現 Wheatcroft 或 Flepp 嘅方向，再用完全未見 HKJC forward data 測試。[Wheatcroft](https://doi.org/10.1515/jqas-2019-0009)；[Flepp 等](https://doi.org/10.1111/ecin.13163)

呢條線比自由搜索 100 個 bias 可信，但因公開 xG 已普及，2026 年 edge 可能已衰減。

### POC 停止規則

- market-only 仍然最好 → **停止 outcome AI 投入**，唔再換另一個黑盒重跑。
- 概率有增量但 ROI 穿唔過 HKJC 水位 → AI 留作預測／分析產品，唔叫推薦。
- backtest 正但 forward CLV／ROI 負 → 判定歷史 edge 已衰減或不可執行，停止升格。
- 只有 final holdout 同獨立 forward period 都通過，先討論 `performance-trusted`；30 場本身絕不等於合格。

---

## 8. 如果盈利 AI 唔成立，仍然有咩替代產品

### 方案 1：市場概率預測器（高可行、誠實）

將 sharp 多莊／exchange 去水後概率當「市場預測」，顯示主勝／和／客勝、預期入球、概率區間同賠率移動。用途係理解賽事，唔聲稱打敗市場。

市場 odds 作 forecast 有強實證基礎；Štrumbelj 顯示合適去水方法可產生高質概率，[原文](https://doi.org/10.1016/j.ijforecast.2014.02.008)；Forrest 等亦發現 odds-setter 隨時間成為更強 forecaster，[原文](https://doi.org/10.1016/j.ijforecast.2005.03.003)。

### 方案 2：跨莊家錯價／報價質素 scanner（中等可行）

唔預測邊隊贏，改為問：「HKJC 呢個價同市場共識差幾多？報價夠唔夠新鮮？有冇跨盤口矛盾？」呢個同 Kaunitz 等人嘅成功路線最接近，[原文](https://arxiv.org/abs/1710.02824)，亦可以承接 Phase 3，但必須 forward A/B 後先叫推薦。

### 方案 3：價格發現／CLV 研究助手（高可行）

預測 60m 價會唔會向 5m／close 移動，而唔係直接預測賽果。CLV 係較快嘅訊號，方便分辨「模型有資訊」同「短期啱啱中波」；但 closing 價只可做事後 label，唔可偷放入早段 feature。

### 方案 4：純追蹤與決策支援（高可行）

保留後補、實際 ROI、風險暴露、價格比較、模型可信度同「不下注」提示。呢個產品有用，亦唔需要假設存在永久市場 edge。

---

## 9. 最終答案

你原本個方向**唔係根本上不可行**，但要改一句先準確：

> 唔係「AI 從大量舊數據計出未來」，而係「市場已經提供一個很強概率 forecast；我哋要證明新增、當時可得嘅資料能否穩定解釋市場剩餘錯誤，並且改善幅度足以穿過實際水位」。

以現有資料同模型，答案係 **未得，而且已有相當強負面證據**。再執 trust gate、UI 或推薦流程只會令系統更誠實，唔會創造預測力。

但文獻顯示仍有一條合理、有限嘅最後測試路線：**球員／正選陣容級 point-in-time 資料＋市場 residual 模型＋嚴格 holdout／forward 驗證**。若呢條線都無法改善市場概率或穿過 HKJC 水位，就應正式停止「盈利 AI 推薦」作核心承諾，轉型做市場預測、錯價掃描同個人投注決策支援。呢個唔係工程失敗，而係用證據確認產品邊界。

---

## 10. 一手來源索引

- Dixon & Coles (1997), *Modelling Association Football Scores and Inefficiencies in the Football Betting Market*: [DOI](https://doi.org/10.1111/1467-9876.00065)
- Forrest, Goddard & Simmons (2005), *Odds-setters as forecasters: The case of English football*: [DOI](https://doi.org/10.1016/j.ijforecast.2005.03.003)
- Štrumbelj (2014), *On determining probability forecasts from betting odds*: [DOI](https://doi.org/10.1016/j.ijforecast.2014.02.008)
- Croxson & Reade (2014), *Information and Efficiency: Goal Arrival in Soccer Betting*: [作者手稿頁](https://centaur.reading.ac.uk/34884/)／[DOI](https://doi.org/10.1111/ecoj.12033)
- Elaad, Reade & Singleton (2020), *Information, prices and efficiency in an online betting market*: [作者手稿](https://centaur.reading.ac.uk/86111/1/betting_efficiency_elaad_reade_singleton.pdf)／[DOI](https://doi.org/10.1016/j.frl.2019.09.006)
- Reade, Singleton & Vaughan Williams (2020), *Betting markets for English Premier League results and scorelines*: [作者手稿](https://centaur.reading.ac.uk/89738/1/reade_singleton_scorelines.pdf)
- Arntzen & Hvattum (2021), *Predicting match outcomes in association football using team ratings and player ratings*: [DOI](https://doi.org/10.1177/1471082X20929881)
- Holmes & McHale (2024), *Forecasting football match results using a player rating based model*: [DOI／open-access 原文](https://doi.org/10.1016/j.ijforecast.2023.03.002)
- Flepp, Merz & Franck (2024), *When the league table lies*: [DOI／open-access 原文](https://doi.org/10.1111/ecin.13163)
- Winkelmann, Ötting, Deutscher & Makarewicz (2024), *Are Betting Markets Inefficient?*: [DOI／原文](https://doi.org/10.1177/15270025231204997)
- Wheatcroft (2020), *Profiting from overreaction in soccer betting odds*: [DOI／原文](https://doi.org/10.1515/jqas-2019-0009)
- Kaunitz, Zhong & Kreiner (2017), *Beating the bookies with their own numbers*: [arXiv 原文](https://arxiv.org/abs/1710.02824)／[重現代碼](https://github.com/Lisandro79/BeatTheBookie)
- Hubáček, Šourek & Železný (2019), *Exploiting sports-betting market using machine learning*: [作者原文](http://ida.felk.cvut.cz/zelezny/pubs/ijf.2019.pdf)／[DOI](https://doi.org/10.1016/j.ijforecast.2019.01.001)
- Betfair Exchange commission: [官方說明](https://support.betfair.com/app/answers/detail/413-exchange-what-is-commission-and-how-is-it-calculated/)
