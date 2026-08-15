# HANDOFF — 衞生 + 架構 #4 MarketKey + 表現 pending

日期：2026-07-25
Branch：`master`（未 commit，working tree dirty）
Base commit：`f4c2515`

---

## 1. 一句講晒

三條線一齊清：衞生（密碼消毒、gitattributes、gitignore）、架構 #4（MarketKey type + vocabulary 統一）、產品（表現頁 pending 未結算列表）。全部 TypeScript 0 error、19 files / 121 tests 綠。

## 2. 改動檔案

| 檔案 | 改動 |
|------|------|
| `.gitattributes` | **新**：`*.sh` `*.mjs` `*.ts` `*.tsx` `*.json` `*.css` `*.html` 全部 `eol=lf` |
| `.gitignore` | 加 `.ssh-key` `*.tar.gz` `test-results/` `data/priority-*` `scripts/tmp-*` `webbridge-req-*` `debug-migrate.sh` `run-migration-debug.mjs` `skills-lock.json` `Users/` |
| `src/market.ts` | **新**：`MarketKey` type、`ALL_MARKETS`、`MARKET_LABELS`、`canonicalMarket()` |
| `src/readinessModels.ts` | 改用 `MarketKey` + `MARKET_LABELS` |
| `src/apiClient.ts` | `BuyableOpportunity.market` `PredictionSnapshot.market` → `MarketKey`；import `BacktestPendingRow` |
| `src/apiClient.test.ts` | test fixture `"大細波"` → `"totals"` |
| `src/App.tsx` | import `MarketKey` / `BacktestPendingRow`；`pendingEntries` state；接 `body.pending`；傳 `pending` 入 `PerformancePage` |
| `src/pages/PerformancePage.tsx` | `selectedMarket` → `MarketKey`；加 `detailTab` state；pending tab + table；`formatPendingStatus()`；`PendingEntry` type |
| `src/styles/today.css` | tab pill 樣式、pending status 顏色（upcoming/settling/overdue/unknown） |
| `docs/adr/architecture-cleanup-report-2026-07-25.md` | 密碼 `Hugohk1991` → `<sudo-password-redacted>`（untracked，未 commit） |

## 3. 主線 A — 衞生

- **密碼消毒**：cleanup report line 91 `echo Hugohk1991` 已 replace 為 `echo <sudo-password-redacted>`
- **`.gitattributes`**：shell / js / ts / json / css / html 強制 LF，根治 deploy 時 entrypoint CRLF 炸
- **`.gitignore`**：`.ssh-key`（敏感）、`*.tar.gz`（deploy archive）、`test-results/`、temp scripts/data 全部 ignore

## 4. 主線 B — 架構 #4：MarketKey + vocabulary 統一

### `src/market.ts`（新）

```ts
export type MarketKey = "totals" | "corners" | "handicap" | "h2h";
export const ALL_MARKETS: MarketKey[] = [...];
export const MARKET_LABELS: Record<MarketKey, string> = {
  totals: "大細波", corners: "角球", handicap: "讓球", h2h: "主客和",
};
export function canonicalMarket(value: string): MarketKey | null { ... }
```

`canonicalMarket` 同 `server/domain/identity.mjs` 嘅 `canonicalResultMarket` mapping 一致（totals/大細波、corners/角球/alternate_totals_corners、handicap/亞洲讓球/spreads、h2h/主客和/moneyline）。

### 使用點

| 位置 | 用法 |
|------|------|
| `src/readinessModels.ts` | `market: MarketKey` + `MARKET_LABELS` |
| `src/apiClient.ts` | `BuyableOpportunity.market` `PredictionSnapshot.market` → `MarketKey` |
| `src/pages/PerformancePage.tsx` | `selectedMarket: MarketKey \| null` |
| `src/App.tsx` | API boundary types（`ModelReadiness` `ResultEntry`）留 `market: string`，內部用 `READINESS_MODELS` 嘅 `MarketKey` |

**設計決定**：API response types（`BacktestReadiness` `BacktestRow` `BacktestPendingRow`）嘅 `market` 留 `string`——API 可能加新 market，唔應該 client side 炸 type。`MarketKey` 只喺 controlled 嘅位置用（`READINESS_MODELS`、`BuyableOpportunity`、`selectedMarket`）。

## 5. 主線 C — 表現頁 pending（未結算列表）

### App.tsx

- 新 state：`pendingEntries: BacktestPendingRow[]`
- `loadBacktest()` 接 `body.pending`
- `clearAuthenticatedState()` 清 `pendingEntries`
- `<PerformancePage ... pending={pendingEntries} />`

### PerformancePage.tsx

- 新 prop：`pending: PendingEntry[]`
- 新 type：`PendingEntry`（minimal，對齊 `BacktestPendingRow`）
- 新 state：`detailTab: "settled" | "pending"`（default `"settled"`，撳新卡 reset）
- Detail view 加 tab switcher：
  - 「已結算」— 原有 settled table（5 欄）
  - 「未結算 (N)」— pending table（5 欄：賽事 ID、開賽、揀邊、賠率、狀態）
- `formatPendingStatus()`：upcoming → 未開賽、settling → 結算中、overdue → 逾期、unknown → 未知
- Pending filter by `market` + `modelVersion`，sort `commenceTime` 降序（同 settled 邏輯）
- 空狀態：「呢個盤口暫時未有未結算記錄」

### CSS

- `.performance-detail__tabs` — pill-style tab buttons
- `.settlement--upcoming`（muted）、`--settling`（warning yellow）、`--overdue`（negative red）、`--unknown`（muted 50%）

## 6. 驗證

```text
npx tsc --noEmit  →  0 errors
npm run test      →  19 files / 121 tests passed
```

## 7. 待做（未 commit）

全部改動喺 working tree：

```bash
git add .gitattributes .gitignore src/market.ts \
  src/readinessModels.ts src/apiClient.ts src/apiClient.test.ts \
  src/App.tsx src/pages/PerformancePage.tsx src/styles/today.css

git commit -m "chore: hygiene + MarketKey type + performance pending tab

- Sanitize password from cleanup report
- Add .gitattributes (LF for shell/js/ts/json/css/html)
- Add .gitignore for temp/sensitive files
- Create src/market.ts: MarketKey type, labels, canonicalMarket()
- Use MarketKey in readinessModels, apiClient, PerformancePage
- Add pending tab to performance detail: unsettled rows, status badges"
```

Deploy：`git push origin master` → `git archive` → `scp` → VM extract → `docker compose build api caddy` → `up`。`.gitattributes` 已設，entrypoint CRLF 問題應自動解決。

## 8. Untracked 注意

| 檔案 | 狀態 |
|------|------|
| `docs/adr/architecture-cleanup-report-2026-07-25.md` | 已消毒，可 commit 或留 local |
| `.ssh-key` | 已 gitignore，勿 commit |
| `data/current-teams-now.txt` `deploy-now.ps1` `test-pg.sh` | local-only，未 gitignore |

---

詳細系統狀態以 `docs/MASTER-HANDOFF-v1.2.1.md` 為準。