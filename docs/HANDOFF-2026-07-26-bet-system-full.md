# HANDOFF — 注單系統 + 表現 pending + 衞生 + MarketKey

日期：2026-07-26
Branch：`master`（部份已 commit @ `4871038`，bet 系統未 commit）
Spec：`docs/HANDOFF-2026-07-26-bet-performance-decision.md`
Code review：已完成，3 fixes applied

---

## 1. 一句講晒

兩個 session 嘅全量交付：衞生（密碼消毒 / gitattributes / gitignore）→ 架構 #4（MarketKey type）→ 表現頁 pending tab → **個人注單系統**（DB + API + 三入口 + 列表頁）。全部 TypeScript 0 error、19 files / 121 tests 綠。

---

## 2. Commit 分佈

### 已 commit（`f4c2515` → `4871038`）

| Commit | 內容 |
|--------|------|
| `4871038` | 衞生 + MarketKey type + 表現 pending tab |

涵蓋：
- `.gitattributes` 新：shell/js/ts/json/css/html 強制 LF
- `.gitignore` 加 `.ssh-key` `*.tar.gz` `test-results/` 等
- `docs/adr/architecture-cleanup-report-*.md` 密碼 `Hugohk1991` → `<sudo-password-redacted>`
- `src/market.ts` 新：`MarketKey` type、`ALL_MARKETS`、`MARKET_LABELS`、`canonicalMarket()`
- `src/readinessModels.ts` → `MarketKey` + `MARKET_LABELS`
- `src/apiClient.ts` `BuyableOpportunity.market` `PredictionSnapshot.market` → `MarketKey`
- `src/pages/PerformancePage.tsx` `selectedMarket` → `MarketKey`、pending tab + table
- `src/App.tsx` `pendingEntries` state、接 `body.pending`

### 未 commit（bet 注單系統）

| 檔案 | 改動 |
|------|------|
| `db/migrations/005_bet_slips.sql` | **新**：`bet_slips` 表 + 4 indexes |
| `server/db/bet-repository.mjs` | **新**：`create` + `listByOwner` |
| `server/app.mjs` | `GET/POST /api/v1/bets` + `summarizeBets` + CSRF |
| `server/entry.mjs` | register `betRepository` |
| `src/apiClient.ts` | `BetResponse` `BetsListResponse` `BetCreateRequest` + `bets()` `createBet()` |
| `src/route.ts` | Page `"bets"`、`#/bets` route |
| `src/components/AppShell.tsx` | Nav 加「注單」 |
| `src/components/BetForm.tsx` | **新**：共用表單（盤口/揀邊/賠率/注碼） |
| `src/components/PickCard.tsx` | 加「我有買」掣 → prefill from opportunity |
| `src/pages/BetsPage.tsx` | **新**：列表 + 中率 summary + 手動新增 |
| `src/pages/FixturesPage.tsx` | 加「我有買」掣 → prefill team/match |
| `src/pages/TodayPage.tsx` | 透傳 `onBet` 落 PickCard |
| `src/App.tsx` | BetForm modal overlay + BetsPage route + `handleCreateBet` + 401 handling |
| `src/styles/today.css` | modal、form、bets-summary、table、pick-card__bet |

---

## 3. 架構 #4 — MarketKey 統一

`src/market.ts`：

```ts
export type MarketKey = "totals" | "corners" | "handicap" | "h2h";
export const MARKET_LABELS: Record<MarketKey, string> = {
  totals: "大細波", corners: "角球", handicap: "讓球", h2h: "主客和",
};
export function canonicalMarket(value: string): MarketKey | null { ... }
```

- `canonicalMarket` 同 `server/domain/identity.mjs` `canonicalResultMarket` mapping 對齊
- API boundary types（`BacktestReadiness` `BacktestRow`）嘅 `market` 留 `string`，避免 API 加新 market 炸 client type
- `MarketKey` 只用喺 controlled 位置：`READINESS_MODELS`、`BuyableOpportunity`、`selectedMarket` state

---

## 4. 表現 pending（已有 commit）

- Detail view tab switcher：「已結算」|「未結算 (N)」
- Pending table：賽事 ID、開賽、揀邊、賠率、狀態（未開賽/結算中/逾期/未知）
- Filter by `market` + `modelVersion`，sort `commenceTime` 降序
- `App.tsx` 接 `body.pending` → `pendingEntries` state

---

## 5. 注單系統 — 資料模型

```sql
CREATE TABLE bet_slips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES owners(id),
  fixture_id uuid REFERENCES fixtures(id),
  match_id text, sample_id integer,
  home_team text, home_team_zh text,
  away_team text, away_team_zh text,
  commence_time timestamptz,
  market text NOT NULL, selection text NOT NULL,
  line numeric, odds numeric NOT NULL,
  stake numeric NOT NULL CHECK (stake > 0),
  settlement text NOT NULL DEFAULT 'pending',
  settled_at timestamptz,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Indexes：`(owner_id, created_at DESC)`、`(owner_id, fixture_id)`、`(owner_id, settlement)`、`(fixture_id, market) WHERE fixture_id IS NOT NULL`

---

## 6. 注單系統 — API

| Route | Auth | 行為 |
|-------|------|------|
| `GET /api/v1/bets` | Session `ownerId` | listByOwner + `summarizeBets`（中率：half-win→中、half-loss→錯、push 不入分母） |
| `POST /api/v1/bets` | Session + CSRF | validation（market/selection/odds>1/stake>0）→ insert |

**唔做 v1：** PATCH/DELETE、auto-settlement、profit column。

---

## 7. 注單系統 — 三個入口

### 今日卡（PickCard）
- 「我有買」掣 → modal BetForm
- Prefill：fixtureId、matchId、sampleId、隊名（zh+en）、commenceTime、market、selection、line、bestQuote.odds

### 賽程（FixturesPage）
- 每 row「我有買」掣 → modal BetForm
- Prefill：matchId、隊名、commenceTime
- 用戶自選盤口/揀邊/賠率/注碼

### 注單頁（BetsPage `#/bets`）
- 「+ 新增注單」掣 → modal BetForm（空 prefill）
- 列表：賽事、盤口、揀邊、賠率、注碼、結果（settlement badge）
- Summary bar：總注數、已結算、中率、中/錯/走/待結算

---

## 8. Code review fixes（已修）

| Finding | Fix |
|---------|-----|
| P1 刪 speculative `settleByFixtureResults` / `updateSettlement` | 已刪 + unused `withTransaction` import |
| P4 odds prefill = 0 | PickCard: `?? 0` → `undefined`；FixturesPage: 刪 `odds: 0` line |
| P5 error handling 冇 401 | 加 `ApiError` check → `clearAuthenticatedState()` |

---

## 9. 驗證

```text
npx tsc --noEmit  →  0 errors
npm run test      →  19 files / 121 tests passed
```

---

## 10. 建議 commit

```bash
git add db/migrations/005_bet_slips.sql server/db/bet-repository.mjs \
  server/app.mjs server/entry.mjs \
  src/apiClient.ts src/route.ts \
  src/components/AppShell.tsx src/components/BetForm.tsx src/components/PickCard.tsx \
  src/pages/BetsPage.tsx src/pages/FixturesPage.tsx src/pages/TodayPage.tsx \
  src/App.tsx src/styles/today.css

git commit -m "feat(bets): personal bet slip system with three entry points

DB: bet_slips table + indexes (005 migration)
API: GET/POST /api/v1/bets with CSRF + per-owner isolation
Client: BetForm modal, BetsPage (#/bets) with hit-rate summary
Entry: PickCard 'I bought' + FixturesPage 'I bought' buttons
Spec: docs/HANDOFF-2026-07-26-bet-performance-decision.md
"
```

---

## 11. Deploy 注意

- Migration：`db/migrations/005_bet_slips.sql` 需要 run
- `.gitattributes` 已設定 LF → entrypoint CRLF 問題應自動解決
- `POST /api/v1/bets` 需要 CSRF token（client side 已處理）
- 首次 deploy 後 verify：`curl https://odds.ballballchu.com.hk/api/v1/bets` → 401（未登入正常）

---

## 12. 已知 defer（v1.1）

| 項目 | 原因 |
|------|------|
| PATCH/DELETE bet | v1 minimal |
| Auto-settlement（結算自動對賽果） | 要重用 backtest settle 邏輯 |
| 手動冇 fixture link 嘅人手標中錯 | v1 只允許 pending |
| Profit/損益 DB 欄 | 決定唔存 derived data，query 時計 |
| 儲存後「我有買」掣變「已記」 | UX polish |
| 績效頁 fixture search/link | v1 手動入已可用 |

---

詳細系統狀態以 `docs/MASTER-HANDOFF-v1.2.1.md` 為準。