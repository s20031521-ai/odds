# HANDOFF — Session 總結：架構瘦身 + 表現頁 drill-down

| 欄位 | 內容 |
|------|------|
| 日期 | 2026-07-25 |
| Branch | `master` @ **`6d968eb`**（已 push `origin/master`） |
| 環境 | 本機 `C:\Users\itadmin\Documents\賭` · Production `https://odds.ballballchu.com.hk`（已多次 deploy） |
| 狀態 | **已上線**；下一批架構候選未做（#4 identity 起） |

---

## 1. 一句講晒

呢個 session 做咗三條主線：

1. **裝 Matt Pocock skills**，喺 `賭` repo 確認／沿用 setup  
2. **架構加深（兩輪）**：C1+C2 雙引擎／死卡 → 再 #1+#2+#3 LOO／orphan／App 分析尾  
3. **表現頁**：同頁 drill-down 睇已結算 result + UI 對比／wallpaper／隊名回填  

全部已 commit、push，production 已 deploy 到含 `6d968eb` 的 build。

---

## 2. 時間線與 commits（由舊到新）

| Commit | 主題 |
|--------|------|
| `cd4d847` | **C1+C2**：刪 client 雙推薦引擎 8 檔 + App 死卡；ADR 0001 |
| `1658013` | **表現頁 drill-down**（+ handoff 文件） |
| `1dc9a62` | Settlement badge 對比（pill 底色） |
| `899c157` | Wallpaper 50% opacity（後被改） |
| `c6cacd4` | 表現 detail **實心底**（字唔被 wallpaper 沖淡） |
| `67b275d` | Wallpaper **20% 透明**（`opacity: 0.8`） |
| `05b11c0` | 已結算 row **隊名**回填（snapshot / fixtures registry） |
| `6d968eb` | 架構 **#1+#2+#3**：刪 LOO/orphan；App 只 `upcomingFixtures`；mapper 只 h2h |

> 註：`1658013` 之後 amend 過 handoff hash；以 `git log` 為準。中間 UI-only 亦有 redeploy。

---

## 3. 主線 A — Skills 與 repo setup

### 做過
- 全域安裝 `mattpocock/skills`（`npx skills add mattpocock/skills -g --all --copy`）
- 在 `賭` 跑 `/setup-matt-pocock-skills` 探索 → **設定已存在，用戶選擇維持現狀**

### 生效設定（未改）
- Issue tracker：**GitHub**（`s20031521-ai/odds`）+ `gh`
- Triage 標籤：預設五個
- Domain：single-context（`CONTEXT.md` 仍可懶建立）
- 文件：`AGENTS.md` · `docs/agents/*`

---

## 4. 主線 B — 架構加深

### 第一輪（C1 / C2）— 已執行

| ID | 內容 | 結果 |
|----|------|------|
| **C1** | 砍雙推薦引擎 | 刪 `buyCandidates` / `buyOpportunities` / `picks` / `stakeDisplay`（+tests） |
| **C2** | 清 App 死卡 | 刪 total/corner/hdc cards + state + merge |
| ADR | `docs/adr/0001-sole-recommendation-engine-is-unified.md` | production 只信 unified + API |

Decision / 清理報告（temp，未必在 repo）：
- `%TEMP%\deepening-1-dual-engine-decision-report.md`
- `docs/adr/architecture-cleanup-report-2026-07-25.md`（untracked 可能仍在；**含 sudo 密碼則勿 commit／應刪密**）

### 第二輪（HTML 報告）— 候選掃描

報告：`%TEMP%\architecture-review-20260724-174321.html`

| # | 候選 | Session 結果 |
|---|------|----------------|
| 1 | 刪 LOO analyzers | ✅ `6d968eb` |
| 2 | 刪 marketDisplay / predictionSnapshots runtime | ✅ |
| 3 | 收乾 App 分析尾 + h2h-only mapper | ✅ |
| 4 | 單一 identity + 盤口詞彙 | ⏳ 未做 · **建議下一步** |
| 5 | 共用亞洲結算 | ⏳ |
| 6 | Live-odds 扁平 / 脫 Vite | ⏳ |
| 7 | 拆 backtest 神模組 | ⏳ 推測性 |

### 第二輪實作要點（#1–#3）

**刪檔：**  
`totals` · `corners` · `marketCalibration` · `marketDisplay` · `predictionSnapshots`（+ 對應 tests）

**改動：**
- `PredictionSnapshot` 型別 → `src/apiClient.ts`
- `App`：只 `upcomingFixtures(entries)`（**kickoff 序**，唔再 `analyzeEntries` / edge sort）
- `liveOddsMapping`：只組 **h2h `entries`**（唔再 re-pair totals/corners/spreads）
- ADR：`docs/adr/0002-delete-off-path-loo-and-orphan-client-modules.md`

**仍保留（留給 #6）：**  
`oddsApi` / `handicap` / `asianTotals` — hdc-collector 仍 Vite SSR `src/oddsApi.ts`

**產品取捨：**「即將開賽」同賽程列表按開賽時間，唔按 h2h edge。

---

## 5. 主線 C — 表現頁 drill-down

### 決策（grilling）
- 同頁 drill-down，**唔改** hash  
- 只已結算 `resultEntries`  
- 行：對賽 · 開賽 · 揀邊 · 結果 · 比分；開賽新→舊  
- 四卡都可撳；空狀態一句 + 返回  
- Detail 頂迷你摘要  

詳細：`docs/HANDOFF-2026-07-25-performance-drilldown.md`  
Temp 決策報告：`%TEMP%\performance-page-drilldown-decision-report.md`

### 檔案
| 檔案 | 角色 |
|------|------|
| `src/pages/PerformancePage.tsx` | overview/detail · `formatSettlementLabel` · `formatMatchLabel` · `formatPrediction` |
| `src/pages/PerformancePage.test.tsx` | unit tests |
| `src/readinessModels.ts` | `READINESS_MODELS` 單一來源 |
| `src/App.tsx` | 傳 `results={resultEntries}` |
| `src/styles/today.css` | 可撳卡、白底 table 面板、settlement pills |
| `src/styles/layout.css` | `.app-wallpaper { opacity: 0.8 }` |

### UI 迭代（對比）
1. Settlement 改 pill 有底色  
2. 發現表字仍淡 → **整表 + header 實心白底**（根因係叠 wallpaper）  
3. Wallpaper 由 0.5 → **0.8**（20% 透明）  

### 隊名缺 ID 問題
- **現象：** 第二行顯示 UUID 而非「A vs B」  
- **原因：** UI fallback 用 `matchId`；result raw 冇隊名，且 `unifiedPerformanceRow` 未從 snapshot 抄隊名；`listForBacktest` 未 join `fixtures`  
- **修：** `05b11c0` — snapshot/registry 補名 + `formatMatchLabel`（zh > en > id）

**仍可能顯示 ID：** fixtures + snapshot raw 都冇隊名嘅極舊／殘缺資料。

---

## 6. Deploy 筆記

### 流程（本 session 慣用）
```text
git push origin master
git archive → %TEMP%\odds-deploy.tar.gz
scp -P 169 → hugo@118.140.60.206:/tmp/odds-deploy.tar.gz
VM: extract → sed 去 entrypoint CRLF → docker compose build api caddy → up
```

### 坑
1. **entrypoint CRLF** → `exec ... no such file or directory`；extract 後要 `sudo sed -i 's/\r$//' deploy/*-entrypoint.sh` 再 build（必要時 `--no-cache api`）  
2. 建議本機加 `.gitattributes`：`*.sh text eol=lf`（未做）  
3. **勿把 sudo 密碼寫入 repo / handoff / cleanup report**；舊 cleanup 報告若含密碼應刪密並清文件  

### 驗證
- `curl` 公開站 → `200`  
- api log：`listening on 0.0.0.0:8787` · healthy  

---

## 7. 測試水位（最後一 commit）

```text
npm.cmd test  →  19 files / 121 tests passed（刪 LOO/orphan 後 file 數下降）
npx tsc --noEmit → 0 errors
```

---

## 8. 明確不做／未做

| 項目 | 狀態 |
|------|------|
| 表現頁 pending（未結算） | 未做 |
| win/loss 篩選 chip | 未做 |
| `#/performance/...` deep link | 未做 |
| Identity 統一 #4 | 未做 |
| Shared settlement #5 | 未做 |
| Collector 脫 Vite #6 | 未做 |
| 拆 backtest #7 | 未做 |
| `CONTEXT.md` / `docs/adr` 完整 domain 詞彙 | 仍薄（只有 0001/0002） |
| `.gitattributes` LF for shell | 未做 |

---

## 9. 建議下一 session

1. **架構：** `/grilling` → **#4 identity + market vocab**（最高槓桿正確性）  
2. **或產品：** `/grill-with-docs` → 表現頁 pending / 中文揀邊  
3. **衛生：**  
   - 檢查 untracked `docs/adr/architecture-cleanup-report-*.md` 有冇密碼  
   - 加 `.gitattributes` 防 CRLF deploy 炸  
   - 勿 commit `.ssh-key`、tmp scripts、`data/*` 本地檔  

---

## 10. 關鍵檔案速查

```
docs/adr/0001-sole-recommendation-engine-is-unified.md
docs/adr/0002-delete-off-path-loo-and-orphan-client-modules.md
docs/HANDOFF-2026-07-25-performance-drilldown.md
docs/HANDOFF-2026-07-25-session-architecture-performance.md  ← 本文件
docs/agents/issue-tracker.md | triage-labels.md | domain.md
src/pages/PerformancePage.tsx
src/readinessModels.ts
src/liveOddsMapping.ts
shared/unified-recommendations.mjs   ← sole buy engine
server/domain/backtest.mjs
```

---

## 11. 一句給下一位 agent

> Production 已係 **unified-only 買盤** + **表現頁 drill-down 已結算列表**；client LOO/orphan 已清，fixtures 用 kickoff 序。下一步優先 **identity 縫（#4）** 或 **表現 pending 產品**；deploy 記得 **entrypoint LF**。

---

*本 handoff 由 2026-07-25 長 session 整理；以 `git log` / production HEAD 為準。*
