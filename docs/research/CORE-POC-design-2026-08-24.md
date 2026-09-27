# 核心 POC 決策文件：point-in-time 正選／球員資料＋市場 residual AI

**查閱日期：** 2026-08-24  
**目的：** 用最少、可審計嘅實驗回答：「兩隊正式正選公布後，加入只由過去賽事計出嘅球員能力，AI 能否比同一時間嘅市場概率更準？」  
**目前建議：** **有條件 GO，但只批准資料 POC；未批准成為推薦模型。** 首選係 **Sportmonks Starter＋Historical add-on＋現有／付費 The Odds API 歷史 1X2**。低成本後備係 **API-Football Pro＋The Odds API**。任何供應商若不能書面確認內部儲存及 ML 訓練用途，均不得進入正式 POC。

> 呢次要驗證嘅唔係「邊種 AI 最勁」，而係我哋有冇一種市場未完全吸收、而且可以合法及 point-in-time 重建嘅資訊。Arntzen–Hvattum 發現球隊評分加正選球員評分顯著優於只用其中一種；Holmes–McHale 亦報告球員模型喺獨立測試有正投注回報。兩篇只證明呢條研究路線值得測，唔保證可以喺 2026 年複製。[Arntzen–Hvattum 原文](https://doi.org/10.1177/1471082X20929881)；[Holmes–McHale 原文](https://doi.org/10.1016/j.ijforecast.2023.03.002)

---

## 1. 先確認現有系統嘅真正資料缺口

現有 repo **唔係一個完整 point-in-time odds database**：

- `replaceProviderSnapshot()` 每次先讀舊價作 `previousOdds`，之後按 provider `DELETE` 全部舊 `live_odds` 再插入新 snapshot；即係只保留最新狀態及一級前價，冇完整時間線。[`server/db/odds-repository.mjs`](../../server/db/odds-repository.mjs#L6)
- The Odds API collector 主要喺 **T-25** 同 **T-5** 收價，冇 T-60 正式 snapshot。[`scripts/hdc-collector.mjs`](../../scripts/hdc-collector.mjs#L51)
- repo 亦冇「某球員喺 T-60 被報 injured／doubtful」、「正選首次 confirmed 嘅時間」歷史表。

所以現有資料不能公平回答核心問題。賽後見到嘅實際正選，唔等於模型知道供應商幾時確認；用賽後修正版傷停名單亦會造成未來資料洩漏。

**POC 必須新增兩個 audit 時間：**

1. `source_updated_at`：供應商聲稱該 record 何時更新（有就保存）；
2. `observed_at`：我哋實際收到該 payload 嘅時間（永遠要有）。

原始 payload 只可 append，不能覆蓋。最低 POC 唔估「預計正選」：`decision_at` 定義為兩隊都被我哋實際觀測到 `lineup_confirmed=true` 嘅第一個 snapshot，而且必須喺 T-75 至 T-30 之間；T-30 仍未齊就排除該場。所有 feature 同市場價都要以同一 `decision_at` 截止。

---

## 2. 供應商比較

價格全部係 **2026-08-24 官方公開價**；`contact sales` 代表冇可靠公開價，本文冇估算。

| 供應商 | 歷史正選／球員事件及統計 | 傷停 | point-in-time 時間資料 | 五大聯賽 | 免費／試用 | 公開價 | 儲存／訓練判定 |
|---|---|---|---|---|---|---|---|
| **API-Football** | 有 lineups、events、fixture player stats；每場球員有 0–10 rating；歷史深度按 league-season coverage | 有 injuries、sidelined history | 有賽事／事件時間及更新頻率；**公開 schema 未提供「正選首次公布」audit history**，要自行 snapshot | coverage 表列 season-specific 能力；五大聯賽要逐季抽驗 | Free：100 calls/day | Free $0；Pro **US$19/mo** 7,500/day；Ultra $29；Mega $39 | Terms 容許用資料建立 app/project、禁直接轉售；同時聲明唔提供發佈 license。**ML 訓練未明文，須書面確認** |
| **Sportmonks** | 有歷史 fixtures、lineups、events、player statistics；超過三季要 Historical add-on；實際欄位逐聯賽有差異 | `sidelined`／`sidelinedHistory` 有 start/end、category | 有 fixture processing time、`lineup_confirmed` 狀態；**未見 first-confirmed timestamp 歷史**，要自行 snapshot | 公開覆蓋包括 Premier League、La Liga、Bundesliga、Serie A、Ligue 1；Starter 可揀 5 leagues | Forever-free 兩個指定聯賽；付費 plan 14-day trial | Starter **€29/mo**；Growth €99；Pro €249；Historical add-on **from €29 one-time** | Terms 明文容許喺自己產品儲存／轉移／展示資料，禁直接轉售。**內部 ML derived model 仍應取得書面確認** |
| **StatsBomb Open Data／商業 Data API** | Open Data 有 matches、lineups、event-level data、部分 360；可自行計球員 rating。商業版另有 player match/season stats | Open Data 冇傷停；公開商業資料亦未確認完整 pre-match injury feed | 有 match/event timestamp、`last_updated`；唔係賽前 publication audit trail | **Open Data 只係碎片**：目前官方 catalog 有 Bundesliga 2023/24、La Liga 多季至 2020/21、Ligue 1 2021/22–2022/23 等，但唔係同步五大聯賽完整樣本 | Open Data $0 | Open Data **$0**；商業 **contact sales** | README 將 Open Data 定位為研究／足球分析興趣並要求 attribution；商業／永久模型用途未清楚，正式產品要另行許可 |
| **Stats Perform／Opta** | 公開產品資料確認深歷史、lineups、事件、詳細球員 stats、live player ratings、xG／Power Rating | 公開 feed docs 未確認一套適合本 POC 嘅 point-in-time injury archive | 具實時 feed，但 timestamp、revision history、保留權須按合約 scope 確認 | 覆蓋規模遠超五大聯賽；Opta 亦係部分主要聯賽官方合作夥伴 | 未見適用本 POC 嘅公開免費方案 | **contact sales** | 價格、儲存年期、模型訓練及 derived model 權利均屬合約事項；未簽書面權利前不可假設 |
| **Sportradar** | 有 Season／Sport Event Lineups、player stats、timeline events | 有 Season Missing Players；包含 injury/suspension reason、status、start date | payload 有 `generated_at`，events 有 updated time；lineups 通常 T-60 至開賽後 15 分鐘先齊，故仍要自行 snapshot | Soccer API 650+ competitions；Advanced Analytics 明列五大聯賽 | 30-day trial；官方指 trial 上限 1,000 calls、1 qps | **contact sales** | 公開 master terms 對 free trial、衍生／內部產品及產品使用限制嚴格，Order Form 決定權利；**必須書面批准 ML 訓練** |
| **SportsDataIO** | confirmed lineups、formation、player game stats；lineup 通常 T-60 至 T-10 | 官方足球 guide 明列五大聯賽 injury coverage | Game／player records 有 `UpdatedUtc`；但要自行保存首次觀測，先能重建 T-60 | 官方 injury coverage 明列英、西、德、意、法頂級聯賽 | Free Trial 為 scrambled realistic data；另有 Replay | **contact sales** | 官方 Vault 明列「training machine learning models」為用途，係公開資料中最清楚；但實際保存、商業及 derived model 權利仍要落入 sales agreement |

### 2.1 API-Football

- 官方 endpoint／coverage 包括 fixtures、events、lineups、players statistics、injuries、odds。[coverage](https://api-sports.io/sports/football)
- 官方 guide 指 lineups 通常開波前 30–60 分鐘先有；`/fixtures/players` 每分鐘更新並提供 0–10 rating；injuries 每 4 小時更新；pre-match odds 只可回看 7 日，**唔適合做多年 odds backfill**。[官方 integration guide](https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide)
- 所有 plan 包全部 competitions/endpoints，Free 只限制 seasons；公開月費及 daily quota 見 [pricing](https://www.api-football.com/pricing)。
- [Terms](https://www.api-football.com/terms) 禁直接轉售資料，亦明言供應商本身唔授予公開發佈所需權利。對私人、內部 POC 風險較低，但「保存多年＋訓練模型＋保留 derived model」並未明文。

**判定：** 最平、最快驗資料；但 timestamp 同授權係兩個硬缺口。只可做 Plan A，不能未問就當 production data foundation。

### 2.2 Sportmonks

- Fixture 可 include lineups、events、statistics；lineup 可分 starter／bench，並有 `lineup_confirmed`；sidelined 有 start/end、games missed 及 history。[lineups](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/lineups-and-formations)；[player/sidelined schema](https://docs.sportmonks.com/v3/endpoints-and-entities/entities/team-player-squad-coach-and-referee)
- 所有核心 plan 特徵相同，按 leagues 及 rate limit 分級；Starter 正好可揀 5 leagues。超過三季 historical data 係一次性 add-on，公開最低 €29。[plans/pricing](https://www.sportmonks.com/football-api/plans-pricing/)
- Terms 明文容許將供應商資料儲存喺自己 database、喺自己產品展示及商業化衍生產品，但禁止將原始資料當 feed 轉售。[Terms](https://www.sportmonks.com/terms-of-service/)；[plain-language data use](https://www.sportmonks.com/integrity-support/)

**判定：** 目前最合適嘅 self-serve shortlist。正式付款前仍要用 sample fixtures 證明五大聯賽指定季嘅 lineup、player stats、sidelined coverage，並電郵確認內部 ML 訓練權。

### 2.3 StatsBomb

- [Open Data repo](https://github.com/hudl/open-data) 免費提供 JSON matches、lineups、events 及部分 360，足夠建立 plus-minus／event-based player rating 原型。
- 但官方 [`competitions.json`](https://raw.githubusercontent.com/hudl/open-data/master/data/competitions.json) 顯示五大聯賽年份唔同步，亦冇傷停同賠率；所以最多只係 **$0 pipeline sandbox**，不能做 decisive five-league POC。
- 商業版有更完整 player match／season stats，但價錢、歷史範圍及使用權都要 [contact sales](https://statsbomb.com/contact/)。

**判定：** 用嚟證明工程可以跑，唔可以用嚟證明 2026 可盈利。

### 2.4 Stats Perform／Opta、Sportradar

- Opta 公開資料確認有歷史、lineups、詳細 player statistics、live ratings 及 advanced metrics，並以 API/feed 供應。[Opta FAQ](https://www.statsperform.com/faqs/stats-perform-faqs-opta-brand-data-products/)；[API/data delivery](https://www.statsperform.com/stats-perform-faqs-apis-and-data-delivery/)
- 但 Opta 冇公開 POC 價、合約保存年期、ML 訓練權，亦未見一個公開 pre-match injury archive 可以直接滿足 T-60。要 [contact sales](https://www.statsperform.com/contact/) 後先判斷。
- Sportradar 公開 API 更清楚：lineups、season missing players、player stats、event timestamps 都有；lineups 可能 T-60 先開始出，甚至開賽後才完整。[lineups/injuries](https://developer.sportradar.com/soccer/docs/soccer-ig-rosters-lineups-transfers)；[update frequencies](https://developer.sportradar.com/soccer/docs/soccer-ig-update-frequencies)
- Sportradar 有 30 日 free trial，但官方指 1,000 total calls、1 qps，只適合 schema 測試；正式價要報價。[trial](https://sportradar.com/content-hub/blog/best-practices-for-integrating-sportradars-sports-data-apis/?lang=en-us)
- Sportradar [Master Terms](https://developer.sportradar.com/sportradar-updates/page/terms-and-conditions) 將 free trial 限於非商業內部測試；資料、內部衍生產品及 properties 受 Order Form 限制，唔可以自行推論模型訓練權。

**判定：** 質素可能最好，但現階段無法用公開資料計成本，亦未證明比 self-serve 方案多出嘅資料會產生 edge。只保留作 enterprise quote。

### 2.5 SportsDataIO：值得一併詢價嘅替代

- 官方 soccer workflow 明列 confirmed lineups 開波前 10–60 分鐘、五大聯賽傷停、formation 同球員資料。[soccer workflow](https://sportsdata.io/developers/workflow-guide/soccer)
- data dictionary 有 lineup、player game stats、`UpdatedUtc`、injury start date。[data dictionary](https://sportsdata.io/developers/data-dictionary/soccer)
- Vault 公開說明有 10+ 年資料，使用例包括 backtesting、research 及 **training machine learning models**。[developer access/Vault](https://sportsdata.io/developers)
- 然而 production／Vault 都係 contact sales；Free Trial 資料係 scrambled，只能測 integration，不能測 accuracy。

**判定：** 如果 owner 願意接觸 sales，應同 Sportmonks 同時索取 sample/quote；佢係公開文件上最直接支持 ML training 嘅候選。

---

## 3. Odds：現有 The Odds API 夠唔夠？

### 結論

**對呢個最小 POC 嘅 1X2 市場 baseline，The Odds API 足夠；對完整 bookmaker audit、HKJC 執行價及永久原始歷史，單靠目前 repo 不足夠。**

The Odds API 官方 historical endpoint：

- 歷史由 2020-06-06 開始；2022-09 起每 5 分鐘一個 snapshot，之前每 10 分鐘；
- 會回傳最接近、但不遲於指定時間嘅 snapshot；每個 bookmaker 有 `last_update`；
- historical 只限 paid plans；一個 market × 一個 region 每次 historical call 用 **10 credits**；
- 公開 plans：20K **US$30/mo**、100K **$59/mo**、5M **$119/mo**、15M **$249/mo**。[官方 docs](https://the-odds-api.com/liveapi/guides/v4/)；[pricing](https://the-odds-api.com/)

POC 只需要 `h2h`／1X2、一個預先鎖定 region、每場決策時間附近一個 snapshot。按每場一次最保守拉取法：一場＝10 credits；20K 同 100K 公開 tiers 可以分別包住約 2,000 同 10,000 次單市場單 region historical calls。最終揀 plan 要按實際 match count 同現有 account 剩餘 quota 計，唔需要預購最高 plan。

The Odds API [Terms](https://the-odds-api.com/terms-and-conditions.html) 容許網站、dashboard、analytical tools 及商業應用使用資料，禁止將原始資料重新包裝／轉售。條文未明文處理「永久 training corpus／subscription 結束後保留 derived model」，購買前仍要電郵確認。

### 其他歷史 odds 路徑

| 來源 | 可用性 | 成本／限制 | POC 用途 |
|---|---|---|---|
| **Betfair Historical Data** | 2015-05 起 time-stamped Exchange data；Basic 1-minute last traded price，無 volume | Basic 公開為 **free**，但要合資格 Betfair customer；Advanced/Pro 公開頁只寫 monthly fee，實際價登入後先見，本文不估 | 免費 sharp exchange 對照；唔係多莊 consensus，亦受地區／戶口資格限制 |
| **Sportmonks Premium Odds** | 120+ bookmakers、約 1-min、每次轉價有 timestamp | Lite **€129/mo**，Pro **€199/mo**；但歷史只保留至開賽後 7 日 | 適合由今日開始 forward 收集；**唔能夠買返多年 archive** |
| **SportsDataIO Vault／Sportradar／Opta** | 官方均有歷史／betting data 產品 | **contact sales** | 只有合約同 sample 明確優於 The Odds API 時先考慮 |

Betfair 官方確認 historical data 可用作分析、backtest 同 simulation，並有 free samples／Basic route。[Betfair Historical Data](https://apps.betfair.com/data/betfair-historical-data/)；[official data specification](https://historicdata.betfair.com/Betfair-Historical-Data-Feed-Specification.pdf)

**Odds shortlist：** retrospective POC 保留 The Odds API；Betfair Basic 只作額外 sensitivity check；唔建議為今次 POC 買 Sportmonks Premium Odds，因為佢冇多年 backfill。

---

## 4. 三個可拍板資料方案

### 方案 A：最低現金成本

**API-Football Pro＋The Odds API 100K**

- 公開成本：**US$19/mo + US$59/mo = US$78/mo**。
- 取得：五大聯賽 fixture／confirmed lineup／player stats／rating，加歷史決策時間附近 1X2 snapshots。
- 優點：最平、現有 repo 已經有兩個 provider 嘅 integration 經驗。
- 缺點：API-Football 冇公開 lineup first-published audit trail；coverage 必須逐季抽驗；ML 訓練權需書面確認。
- 適用：budget 優先，接受自己由而家開始建立 `observed_at` forward archive。

### 方案 B：推薦

**Sportmonks Starter＋Historical add-on＋The Odds API 100K**

- 公開成本：首月最低 **€29/mo + from €29 one-time + US$59/mo**；其後最低 **€29/mo + US$59/mo**，未含 VAT。不同貨幣不作估算兌換。
- 取得：五大聯賽 lineups／player stats，加 The Odds API 多莊決策時間附近歷史 1X2。sidelined history 只作資料研究，唔進最低 POC feature。
- 優點：五個 leagues 剛好落 Starter；storage/product use 條文最清楚；schema 有 lineup confirmation 及 sidelined history。
- 缺點：超過三季資料要 add-on；歷史 first-confirmed timestamp 仍未見；ML derived-model 權須書面確認。
- 適用：想用最低合理風險做一次正式 POC。

### 方案 C：企業級／授權優先

**SportsDataIO Vault 或 Sportradar／Opta＋歷史 odds feed**

- 公開成本：**contact sales**；不得估價。
- 優點：SportsDataIO 明列 ML training use case；Sportradar／Opta 有較深、較一致嘅商業資料及支援。
- 缺點：未有 quote、sample、合約前，無法證明性價比；free/scrambled trial 不能測真實 accuracy。
- 適用：owner 願意承擔 sales cycle，而且合約可明確授予多年保存、內部訓練、derived model retention 及 betting analytics 用途。

### $0 sandbox（不算正式方案）

StatsBomb Open Data＋Betfair Basic 可以測 pipeline、player rating 同 exchange odds parser，公開資料成本 $0；但 coverage 唔同步、冇傷停、無法代表五大聯賽 2026 市場，**不能作 GO 證據**。

---

## 5. 預先鎖定嘅 confirmed-lineup M0／M1／M2／M3 實驗

### 唯一研究範圍

- 市場：只做全場 **1X2 主／和／客**；唔同時試讓球、大細、角球。
- 決策時間：**兩隊正式正選首次被 collector 確認嘅 `decision_at`**，只接受 T-75 至 T-30；每個 feature 同 odds 必須係該刻可見。
- baseline：固定一組 sharp bookmakers／exchange，多莊去水 consensus；HKJC 價不加入 baseline，只喺之後測可買 EV。
- target：唔係直接由零估賽果；M1–M3 只學對 market log-odds 嘅 residual，最後再 normalize 成三項概率。

| 模型 | 輸入 | 回答嘅問題 |
|---|---|---|
| **M0 Market-only** | `decision_at` 去水市場共識 | 市場本身有幾準；所有模型必須贏佢 |
| **M1 Team residual** | M0＋只用 `decision_at` 前已完成賽事計嘅 team Elo／攻守／休息日／賽程密度 | 現有 team-level history 有冇市場外增量 |
| **M2 Lineup residual** | M1＋兩隊 confirmed XI、位置／陣式、正選連續性及相對常用陣容變化 | 「今場實際邊個落場」本身有冇增量 |
| **M3 Player residual** | M2＋只由過去比賽學到嘅 player plus-minus／rolling event stats／出場時間、今場 XI aggregate 及有限 interaction | 球員能力＋今場組合有冇再多增量 |

歷史 injury／suspension snapshot 同 expected lineup 因為多數供應商冇可靠 `first_seen_at`，**不進最低 POC**。確認正選已經反映最終 availability；只有日後取得真正 as-of archive，先可以另開一個預先登記實驗測「比正式正選更早」嘅預測。

**禁止事項：**

- 唔可以將賽後實際正選假裝已被 collector 確認；未 confirmed 到 T-30 就排除，唔用 expected lineup 補位。
- 唔可以用 `decision_at` 後 odds、closing line、今場事件或賽後修正 injury record 做 feature。
- 唔可以試完再改聯賽、threshold、去水法、模型 family 或挑贏嘅 subgroup。
- M3 先用 regularized multinomial model；只有 M2 已有增量先容許試一個預先指定 gradient boosting challenger。深度學習不在最小 POC。

### 資料完整性 gate（建模前）

以下任何一項不達標，先修資料，唔准用模型結果拍板：

- 五大聯賽 fixture cross-provider join rate ≥ **98%**；
- 至少 **95%** 合資格賽事有 `decision_at` ±5 分鐘內、且 bookmaker `last_update` 不遲於 cutoff 嘅 M0 odds；
- 至少 **90%** 原定五大聯賽賽事可喺 T-30 前確認兩隊 XI；未確認場次要排除及獨立報告，不能用賽後值填補；
- 每個 training row 可重現原始 payload、`source_updated_at`（如有）及 `observed_at`；
- 抽樣 audit 冇任何 cutoff 後資料進 feature；發現 leakage，整次 run 作廢。

---

## 6. 一次性 holdout＋forward 設計

### Retrospective 部分

1. 依時間排序；最舊資料 train，中間一段 validation，只用嚟定一套固定 feature、regularisation 同去水法。
2. 最新一個完整 season 作 **locked holdout**；預先寫 hash／manifest，整個開發期間不可睇結果。
3. holdout **只開一次**。供應商歷史通常冇 `first-confirmed-at`，所以用歷史 final XI＋T-30 odds 得出嘅 M2/M3 只係 screening，不能冒充 point-in-time 最終證據；最終判定一定靠我哋自己收集嘅 forward archive。

### Forward 部分（M2/M3 最終證據）

- 由 collector 實際保存 T-75、T-60、T-45、T-30、T-15、T-5 snapshots；模型喺兩隊首次 confirmed 時讀取同一刻資料，其他點只供 audit／CLV。
- 預測喺 `decision_at` 自動 sealed，之後任何資料修正不能改 prediction；T-30 仍未齊正選就唔出呢場 POC 預測。
- 最少覆蓋 **一個完整五大聯賽 season 或 1,500 場合資格賽事，以較遲者為準**；期間不得重訓、改 threshold 或揀 subgroup。
- T-5／closing odds 只作 CLV label；實際 HKJC `decision_at` 可買價另存，唔混入 market baseline。

### Primary metrics

1. multiclass log-loss（primary）；
2. multiclass Brier、calibration slope/intercept（secondary）；
3. paired match-level bootstrap 95% CI，比 M1/M2/M3 對 M0；
4. 經濟層另報 HKJC 實際可買價 EV、CLV、ROI、最大回撤及下注數，唔以命中率代替。

---

## 7. 明確停止／升格規則

### 即時 NO-GO

- 供應商拒絕或不肯書面確認：可保存原始資料作內部研究、可訓練模型、subscription 後可保留 derived model、可用於 betting analytics；
- historical／forward data integrity gate 不達標；
- 冇辦法建立同 `decision_at` 對齊嘅 odds baseline，或者冇辦法證明兩隊正選當刻已 confirmed。

### 模型 NO-GO

- locked holdout 或 forward 任一階段，M3 log-loss 未低過 M0；
- forward paired 95% CI 包含 0，即改善未能同噪音分開；
- M2/M3 calibration 明顯差過 M0，或者所謂 edge 只出現喺開發後挑選嘅單一聯賽／賠率區間；
- M1、M2、M3 都冇逐步增量：**停止 outcome AI 路線，唔再換黑盒模型重跑。**

### 只可做「分析預測」，不可叫推薦

- proper score 穩定贏 M0，但 HKJC 實際可買價扣水後 EV／CLV 無正證據；或者 ROI 95% CI 仍跨 0。

### 可討論升格（仍非自動上線）

必須同時滿足：

- locked holdout 同獨立 forward 都係 M3 明確贏 M0；
- forward paired 95% CI 全部落喺改善一側；
- calibration 不差；
- 預先登記下注規則喺真實可買價有正 CLV，並且 ROI 證據方向一致；
- 冇 data leakage、冇事後改 threshold、冇只報贏家 subgroup。

---

## 8. 只需要產品 owner 決定嘅事項

技術、模型、資料清洗、驗證同停止規則由系統團隊負責。Owner 只需喺真正開始前揀一個預算方向：

1. **A／US$78 每月公開價**：最低成本，較高 coverage／授權確認風險；
2. **B／€29 每月＋from €29 一次性＋US$59 每月**：推薦，成本仍屬 self-serve；
3. **C／contact sales**：先索取 SportsDataIO、Sportradar 或 Opta quote/sample，再由實價決定；
4. **不付費／停止**：只做 $0 sandbox，明確接受佢不能回答商業可行性。

**本研究推薦 owner 選 B，但付款前設三個前置條件：**

- Sportmonks 用官方 sample 證明五大聯賽指定三季 lineups、player stats 實際 coverage；
- Sportmonks 與 The Odds API 以書面確認 internal ML training、raw-data retention、derived-model retention 及 betting analytics 用途；
- 先按實際 fixture 數計 The Odds API credits，確認現有 subscription／keys 是否已足夠；只補差額，不重複購買。

若三項任何一項失敗，退回 A 作短期 forward collector，或者向 SportsDataIO 索取 C quote；**唔應用來源不明 scrape、FotMob／SofaScore 非官方 endpoint 或賽後回填資料頂替。**

---

## 9. 最終判定

核心構想仍然有可行性，但只剩一個值得認真驗證嘅版本：

> **兩隊正式正選確認後，以同一刻市場概率做 M0；用 confirmed XI 同只由過去賽事學到嘅球員能力做 residual；用歷史 screening 同不可修改嘅 forward season 判斷。**

資料供應本身可行，公開 self-serve 成本亦未去到必須 enterprise contract 嘅程度，而且最低 POC 毋須購買預計正選 add-on。最大風險係 **歷史資料冇 publication-time audit trail** 同 **ML 訓練權未寫清楚**，唔係模型技術。

因此正確下一步唔係直接寫 AI，而係用方案 B 做一個 **不付款前 data/rights audit**。只有 coverage、timestamp 同授權三關都過，先值得建立 POC dataset。若最終 M3 仍贏唔到 M0，就可以有根據地結束「盈利 outcome AI」，轉做市場概率、錯價／CLV scanner，而唔再將問題歸咎於介面或模型參數。
