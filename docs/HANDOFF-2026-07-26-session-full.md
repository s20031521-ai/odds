# HANDOFF — 2026-07-26 全日 session（注單全線 + sample + deploy）

日期：2026-07-26  
Branch：`master`（**已 push、已上 production**）  
HEAD：`368dab1`  
Version：**v1.2.6**（navbar 右下角顯示）  
Public：https://odds.ballballchu.com.hk  

相關文件：
- 決策：`docs/HANDOFF-2026-07-26-bet-performance-decision.md`
- 較早注單規格：`docs/HANDOFF-2026-07-26-bet-system-full.md`（當時未 commit 狀態，已被本 session 超越）
- 系統總覽：以 `docs/MASTER-HANDOFF-v1.2.1.md` 為底，功能層以本文件為準

---

## 1. 一句講晒

由「衞生 + MarketKey + 表現 pending」推到 **個人注單全線上 production**：三入口入注、搜／揀賽事（含已完場 + 中英 alias）、**真錢注自動變 sample**、有賽果即結算。Production 已 deploy **v1.2.6**；owner 已成功入古比斯注並結算為 **中**。

---

## 2. Commit 時間線（今日主線）

| Commit | Version | 內容 |
|--------|---------|------|
| `4871038` | — | 衞生 + MarketKey + 表現 pending tab |
| `e7e1495` | 1.2.1 顯示 | Navbar 最右細字 version |
| `d3b44e3` | **1.2.2** | 個人注單系統（DB/API/三入口/BetsPage） |
| `036c6ae` | **1.2.3** | 新增注單可搜／揀賽事 |
| `5a65032` | **1.2.4** | 賽事 tab：未完 \| 已完場（grill） |
| `9d7b186` | **1.2.5** | 已完場用 results 全庫搜尋 + 中英 alias（grill UX） |
| `368dab1` | **1.2.6** | 真錢注 → prediction_snapshots sample + lazy 結算 |

全部已 `git push origin master` 並 archive → scp → VM extract → `docker compose build` → `up`。

---

## 3. 產品能力（上線後）

### 3.1 表現頁（模型）
- Detail：**已結算** / **未結算 (N)** tab
- MarketKey 統一：`totals` \| `corners` \| `handicap` \| `h2h`
- **唔係**個人注單頁（唔好撈亂）

### 3.2 注單頁 `#/bets`（個人）
- Nav：**今日｜賽程｜注單｜表現** + 右下 `v1.2.6`
- Summary：總注、已結算、中率、中／錯／走／待結算
- **+ 新增注單** / 今日卡「我有買」/ 賽程「我有買」

### 3.3 揀場（BetForm）
| Tab | 空搜尋 | 有打字 |
|-----|--------|--------|
| **未完** | live upcoming（最多 20） | 搜隊名／ID |
| **已完場** | 最近 **3 日** + **有模型結算** | **全 results 目錄** + **中英 alias**（例：古比斯→KuPS） |

- Label：有 alias 顯示 **中文 / 英文**（例：`古比斯 / KuPS vs VPS華沙 / VPS Vaasa`）
- meta：時間 · 比分 · 已完場 ·（可選）模型

### 3.4 真錢注 = sample（owner 明確要求）
- 每入一注 → 寫 `bet_slips` **+** `prediction_snapshots`（`source=personal-bet`，`strategy_version=personal-bet-v1`）
- `model_version` 對齊該盤口 readiness model（例 handicap → `hdc-loo-v2`）
- `sample_id` 回寫 `bet_slips`
- GET `/api/v1/bets` 會：
  1. 補 promote 未有 `sample_id` 嘅注
  2. 對 `pending` 且有 `match_id` 嘅注 **lazy settle**（對 `results`）
- 讓球 **冇 line**：結算 fallback 用比分主客（moneyline-style）

---

## 4. 架構重點

### 4.1 MarketKey（`src/market.ts`）
```ts
export type MarketKey = "totals" | "corners" | "handicap" | "h2h";
// MARKET_LABELS + canonicalMarket() 同 server identity 對齊
```
- Controlled 位置用 `MarketKey`；API response 部份 `market` 留 `string`

### 4.2 注單 DB
- Migration：`db/migrations/005_bet_slips.sql`（**production 已 apply**）
- Repo：`server/db/bet-repository.mjs`（create / list / ensureSample / settlePending）
- Sample：`server/domain/personal-bet-sample.mjs`
- API：`GET|POST /api/v1/bets`（session + POST CSRF）

### 4.3 揀場資料流
```
login → loadBacktest() + loadCatalogResults()  // GET /api/v1/results
betFixtures = upcoming(live) ∪ finished(catalog + hasModel from backtest matchIds)
```
- Alias：`src/teamAliases.ts`（≤30 條，可再加）
- Filter：`src/fixtureSearch.ts`

### 4.4 兩條線（仍要知）
| | 個人注單 | 模型推介 sample |
|--|----------|-----------------|
| 表 | `bet_slips` + snapshot `personal-bet` | `prediction_snapshots` unified-sampler |
| 表現頁 readiness 四卡 | **唔會**直接當 unified 四卡樣本（strategy 係 `personal-bet-v1`） | `unified-buyable-v1` |
| 用途 | 真錢帳 + 可結算 + 入庫留作日後改進 | 模型推介／backtest |

真錢注 **有入 snapshot 庫**（可查、可後續訓練 pipeline 用）；**唔等同**自動改 LOO 權重。

---

## 5. Grill 決策摘要（今日）

### 已完場來源 / UX（v1.2.4–1.2.5）
| # | 決定 |
|---|------|
| 資料 | results 全庫可搜；空搜尋只模型最近 3 日 |
| UI | Tab 未完 \| 已完場 |
| 中文 | 內建 alias ≤30 |
| Label | 雙語 zh / en |
| Load | login 一齊 load results |
| 結算（當時） | 注單仍 pending → **後被 1.2.6 推翻為 lazy settle** |

### 真錢注（owner 口頭規格，v1.2.6）
> 手動入 = 我有買 = 真嘢有價值 = **要放入 sample**

已落地：入注即 sample + 有賽果即結算。

---

## 6. Production 驗證記錄

### 6.1 Owner 第一注（古比斯）
| 欄位 | 值 |
|------|-----|
| 賽事 | KuPS vs VPS Vaasa（古比斯） |
| match_id | `hkjc-50071288` |
| 盤口 | handicap / home |
| 賠率 / 注碼 | 1.78 / 200 |
| 開賽 | 2026-07-25 22:00 HKT |
| 比分 | 3-1 |
| 經 1.2.6 backfill | `sample_id=106`，**settlement=win** |
| snapshot | `identity_key=personal-bet:7883922f-…`，`model_version=hdc-loo-v2` |

### 6.2 為咩曾「搵唔到古比斯」
1. 系統英文名 **KuPS**，無中文 → 1.2.5 加 alias  
2. 場係 **22:00 HKT** 唔係朝早 10 點  
3. 舊「已完場」只背 model backtest → 1.2.5 改 results 全庫搜尋  

### 6.3 Smoke（典型）
- `GET /` → 200  
- `GET /api/v1/bets` 未登入 → 401  
- api/caddy healthy  

---

## 7. 改動檔案地圖（累積）

| 區域 | 檔案 |
|------|------|
| 衞生 | `.gitattributes`、`.gitignore` |
| Market | `src/market.ts`、`readinessModels.ts`、`apiClient.ts` |
| 表現 | `PerformancePage.tsx`、`App.tsx` pending、`today.css` |
| 注單 UI | `BetForm.tsx`、`BetsPage.tsx`、`PickCard.tsx`、`FixturesPage`、`TodayPage`、`AppShell`、`route.ts` |
| 揀場 | `fixtureSearch.ts`、`teamAliases.ts` |
| 注單 API/DB | `005_bet_slips.sql`、`bet-repository.mjs`、`personal-bet-sample.mjs`、`app.mjs`、`entry.mjs`、`result-repository.mjs`、`backtest.mjs`（export settle） |
| Version | `package.json` → **1.2.6** |

---

## 8. Deploy 流程（已驗證）

VM 上 `build/` **唔係** git repo → 唔好靠 `git pull`。

```text
本地: git push origin master
      git archive --format=tar.gz -o odds-deploy.tar.gz HEAD
      scp -P 169 -i .ssh-key odds-deploy.tar.gz hugo@118.140.60.206:/tmp/
VM:   cd /opt/odds-tool/build && sudo -A tar xzf /tmp/odds-deploy.tar.gz
      cd /opt/odds-tool
      sudo -A docker tag odds-tool-api:latest odds-tool-api:rollback   # 有 api 改動時
      sudo -A docker tag odds-tool-caddy:latest odds-tool-caddy:rollback
      sudo -A docker compose build api caddy   # 純前端可只 build caddy
      sudo -A docker compose up -d api caddy   # 或 up -d --no-deps caddy
```

- 新 migration：要 run migrate（005 已做；用 superuser apply 亦可）  
- Sudo：askpass helper，用完刪 `/tmp/.ap.sh`  
- **勿 commit** `.ssh-key`、`deploy-now.ps1`（含敏感）

---

## 9. 本地 untracked / 勿 commit

| 路徑 | 說明 |
|------|------|
| `deploy-now.ps1` | local deploy + 密碼，**勿 commit** |
| `.ssh-key` | 已 gitignore |
| `docs/HANDOFF-2026-07-25-hygiene-marketkey-pending.md` | 中途 handoff |
| `docs/adr/architecture-cleanup-report-2026-07-25.md` | 已消毒，可選 commit |
| `tmp-*.sh` / `tmp-*.mjs` | 臨時腳本，可刪 |
| `data/current-teams-now.txt`、`test-pg.sh` | local |

---

## 10. 待做 / 已知 defer

| 項目 | 狀態 |
|------|------|
| PATCH/DELETE 注單 | 未做 |
| 讓球強制 line（精準亞盤） | 無 line 時用比分主客 fallback |
| 真錢注併入「表現」四卡 readiness 統計 | **刻意未做**（strategy=`personal-bet-v1`）；sample 已入庫 |
| 用真錢注自動 retrain LOO | 未做；只有存檔 + 結算 |
| 儲存後「我有買」→「已記」 | UX polish |
| Alias 表擴充 | `src/teamAliases.ts` 可繼續加 |
| `deploy-now.ps1` 密碼消毒 / 改用 secrets | 衞生債 |
| Service Worker 硬 reload 教學 | 舊版 cache 時要 unregister |

---

## 11. 下一 session 建議起點

1. 開 https://odds.ballballchu.com.hk → 確認 navbar **v1.2.6**  
2. **注單** 應見古比斯一注 **中**  
3. 新入注 → 應即有 sample_id；已完場有賽果應即結算  
4. 若要「真錢注顯示喺表現頁／改進模型」→ 另開 grill：點樣併 readiness、點樣訓練  

---

## 12. 快速指令

```bash
# 狀態
git log -8 --oneline
git status

# 測試
npx tsc --noEmit
npm run test
node --test server/domain/personal-bet-sample.test.mjs

# Production 查注單（VM）
sudo -A docker exec odds-tool-postgres-1 psql -U postgres -d odds \
  -c "SELECT id, sample_id, settlement, home_team, away_team, market, selection, odds, stake FROM bet_slips ORDER BY created_at DESC;"
```

---

**本文件即 2026-07-26 全日工作交接總帳。**  
詳細舊系統狀態仍可對 `docs/MASTER-HANDOFF-v1.2.1.md`。
