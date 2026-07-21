# Today-first UI Phase C (Friendly UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 令成個系統 UI 更 friendly：賽程頁改一行式 + 今日/聽日分組 + 有貨標記 + 聯賽/搜尋篩選；紀錄頁加四模型 readiness 進度條 + 「等緊開賽 / 已完場」兩組（server 新 expose pending snapshot 明細）；順手清理已批 dead code。

**Architecture:** Server `buildBacktest` 擴充 response 加 `pending` 明細陣列（唔加新 endpoint）；client `App.tsx` 加 readiness/pending state 同 guards；賽程頁 h2h section 用新 `.fixture-row` class（唔郁 `.fixture-card`，其他市場 tab 共用緊）；紀錄頁喺現有 Panel 內重排；清理一次性刪除 owner 特批嘅 dead exports / dead CSS / SimpleDashboard。

**Tech Stack:** React 19 + TypeScript + Vite + Vitest（client）、Node `node:test`（server）、Playwright（e2e）。

## Global Constraints

- 工作目錄係 Windows Git Bash：`C:\Users\itadmin\Documents\賭`。冇 `npm`/`npx` 可以直接叫。
  - Vitest：`node node_modules/vitest/vitest.mjs run <檔案...>`
  - tsc：`node node_modules/typescript/lib/tsc.js --noEmit -p tsconfig.json`
  - Vite build：`node node_modules/vite/bin/vite.js build`
  - Playwright：`npm.cmd run test:ui:only`（**跑之前一定要先做 tsc + vite build**，bundle 係靜態嘅）
  - Server 測試：`node --test server/domain/backtest.test.mjs`
- 模型凍結：weights / Kelly / 3% edge threshold 唔准郁。
- `src/BuyDashboard.tsx` 同 `src/BuyDashboard.test.tsx` 永久唔准改（`資料未更新，暫停顯示買盤。` 字串事實凍結）。
- className 只加唔改名；觸控目標最少 44px（用 `var(--touch-target)`）。
- Locked 測試（唔准改行為，只准加新嘢）：
  - `src/dashboard.test.ts:27-28` — `formatFixtureDateHeading` 簽名同輸出唔准變（所以新 function `formatFixtureDayHeading`）。
  - `src/odds.test.ts:129` — `sortFixturesByBestEdge` 唔准改（日組內時間排序喺 display 層做）。
  - `tests/ui/dashboard.spec.ts:63` — `.fixture-card-wrap` count 3；`:66` — `a[href="#/analysis?match=match-value"]` 可撳；`:72` — `.fixture-detail` 展開路徑。
  - `tests/ui/dashboard.spec.ts:103-109` — `.empty-state[role="alert"]` error 態。
  - `src/App.test.tsx:43` — `{page === "history" ? <h1 className="page-heading">完場對比</h1> : null}` 原句保留。
  - `server/domain/backtest.test.mjs:96-103` — readiness / snapshotQuality 斷言。
- `src/App.test.tsx` 係 source-string 斷言：改 `src/App.tsx` 後要逐個現有 `toContain` 對返（見 Task 2/4/6 嘅驗證步驟）。
- 行結尾：`src/App.tsx`、`src/styles.css`、`tests/ui/dashboard.spec.ts`、`tests/ui/helpers.ts` 係 CRLF（Edit 工具用 LF 字串就得，會自動保留 CRLF）；`src/odds.ts` 係 mixed；其餘檔案 LF。
- 舊 analysis CSS 入面 `.sample-warning`（`src/styles.css:885-895`）係 LIVE（`src/App.tsx:541` 用緊），**唔准刪**。
- 部署：今次改咗 server，要 rebuild **api + caddy** 兩個 image；owner 講「上」先上。

---

### Task 1: Server — `buildBacktest` 加 pending snapshot 明細

**Files:**
- Modify: `server/domain/backtest.mjs`（LF；`buildBacktest` 喺 L28-56）
- Test: `server/domain/backtest.test.mjs`

**Interfaces:**
- Consumes: 現有 `buildBacktest(snapshots, results, now)`、`snapshotIdentity`、`SETTLEMENT_GRACE_MS`。
- Produces: `buildBacktest` return 多一個 key `pending: PendingRow[]`，每個 row：
  `{ id: string, matchId: string, market: string, prediction: string, line: number|null, odds: number|null, chance: number|null, edge: number|null, commenceTime: string|null, savedAt: string, modelVersion: string, source: string|null, status: "upcoming"|"settling"|"overdue"|"unknown" }`。
  Client Task 2 嘅 `PendingEntry` type 同 mock（Task 8）依賴呢個 shape。

- [ ] **Step 1: Write the failing test**

喺 `server/domain/backtest.test.mjs` 尾部（L120 之前嘅 `test("freezes versioned identities...` 後面都得，最緊要係檔尾前）加：

```js
test("lists unsettled valid-current snapshots as pending rows with kickoff status", () => {
  const snapshots = [
    { matchId: "upcoming", market: TOTALS, prediction: "細", line: 2.5, commenceTime: "2026-07-11T13:00:00Z", modelVersion: "totals-loo-v1" },
    { matchId: "settling", market: HANDICAP, prediction: "主", line: -0.5, commenceTime: "2026-07-11T10:30:00Z", modelVersion: "hdc-loo-v2" },
    { matchId: "overdue", market: TOTALS, prediction: "大", line: 2.5, commenceTime: "2026-07-11T06:00:00Z", modelVersion: "totals-loo-v1" },
    { matchId: "settled", market: TOTALS, prediction: "大", line: 2.5, commenceTime: "2026-07-11T06:00:00Z", modelVersion: "totals-loo-v1" },
    { ...validSnapshot({ matchId: "legacy", market: TOTALS, prediction: "大", line: 2.5, commenceTime: "2026-07-11T13:00:00Z" }), modelVersion: undefined },
  ].map((item) => (item.modelVersion === undefined ? item : validSnapshot(item)));
  const response = buildBacktest(snapshots, [
    { matchId: "settled", market: TOTALS, actual: "3 球" },
  ], NOW);

  assert.deepEqual(response.pending.map((row) => `${row.matchId}:${row.status}`), ["overdue:overdue", "settling:settling", "upcoming:upcoming"]);
  const upcoming = response.pending.find((row) => row.matchId === "upcoming");
  assert.deepEqual(
    { market: upcoming.market, prediction: upcoming.prediction, line: upcoming.line, odds: upcoming.odds, chance: upcoming.chance, savedAt: upcoming.savedAt, modelVersion: upcoming.modelVersion, source: upcoming.source },
    { market: TOTALS, prediction: "細", line: 2.5, odds: 2, chance: 0.55, savedAt: "2026-07-11T05:00:00Z", modelVersion: "totals-loo-v1", source: null },
  );
  assert.equal(response.pending.some((row) => row.matchId === "settled"), false);
  assert.equal(response.pending.some((row) => row.matchId === "legacy"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/domain/backtest.test.mjs`
Expected: FAIL — `response.pending` 係 undefined（`deepEqual` / `.map` 报錯）。

- [ ] **Step 3: Implement `buildPendingRows`**

喺 `server/domain/backtest.mjs`：

(a) 改 `buildBacktest` 嘅 return（L55），加 `pending`：

```js
  const finished = rows.filter((row) => row.settlement);
  return { rows, summary: summarize(finished), byMarket: groupSummary(finished, (row) => row.market), buckets: groupSummary(finished, (row) => bucket(row.chance)), readiness: summarizeReadiness(usable, finished, results, now), pending: buildPendingRows(usable, finished, results, now), snapshotQuality };
```

(b) 喺 `summarizeReadiness` 後面（L100 之後）加新 function：

```js
function buildPendingRows(snapshots, finished, results, now) {
  const settled = new Set(finished.map(snapshotIdentity));
  const commenceByMatch = new Map(results.filter((item) => item?.matchId && item?.commenceTime).map((item) => [item.matchId, item.commenceTime]));
  return snapshots.filter((item) => !settled.has(snapshotIdentity(item))).map((item) => {
    const commenceTime = item.commenceTime ?? commenceByMatch.get(item.matchId) ?? null;
    const kickoff = Date.parse(commenceTime ?? "");
    const status = !Number.isFinite(kickoff) ? "unknown" : now < kickoff ? "upcoming" : now < kickoff + SETTLEMENT_GRACE_MS ? "settling" : "overdue";
    return {
      id: snapshotIdentity(item),
      matchId: item.matchId,
      market: item.market,
      prediction: item.prediction,
      line: Number.isFinite(item.line) ? item.line : null,
      odds: Number.isFinite(item.odds) ? item.odds : null,
      chance: Number.isFinite(item.chance) ? item.chance : null,
      edge: Number.isFinite(item.edge) ? item.edge : null,
      commenceTime,
      savedAt: item.savedAt,
      modelVersion: item.modelVersion ?? "legacy-v0",
      source: item.source ?? null,
      status,
    };
  }).sort((left, right) => pendingTime(left.commenceTime) - pendingTime(right.commenceTime) || left.id.localeCompare(right.id));
}

function pendingTime(value) {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}
```

注意：`buildBacktest` 入面 `usable` 已經係 valid-current（`mergeSnapshots` 會俾冇 version 嘅 snapshot 補 `legacy-v0`，`classifySnapshot` 隔離咗 legacy/invalid），所以 legacy 自然唔會出現喺 `pending`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/domain/backtest.test.mjs`
Expected: PASS（包括舊嘅 locked readiness 測試 L80-104 — 冇改過 `summarizeReadiness`）。

- [ ] **Step 5: Commit**

```bash
git add server/domain/backtest.mjs server/domain/backtest.test.mjs
git commit -m "feat(server): expose pending snapshot detail rows in backtest response"
```

---

### Task 2: Client plumbing — readiness / pending state + ResultEntry edge/savedAt

**Files:**
- Modify: `src/apiClient.ts:25-30`（LF）
- Modify: `src/App.tsx`（CRLF；type L47-65、state L94-96、auto-load effect L282-292、`loadBacktest` L306-322、guards L946-948）
- Test: `src/App.test.tsx`（CRLF，source-string 斷言）

**Interfaces:**
- Consumes: Task 1 嘅 `pending` row shape、`readiness`（server 一早有：`{ market, modelVersion, settledMatches, pendingMatches, ... }`）。
- Produces:
  - `type ModelReadiness = { market: string; modelVersion: string; settledMatches: number; pendingMatches: number }`
  - `type PendingEntry = { id: string; matchId: string; market: string; prediction: string; line: number | null; odds: number | null; chance: number | null; edge: number | null; commenceTime: string | null; savedAt: string; modelVersion: string; source: string | null; status: "upcoming" | "settling" | "overdue" | "unknown" }`
  - State：`readiness: ModelReadiness[]`、`pendingEntries: PendingEntry[]`（Task 6 用）
  - `ResultEntry` 多咗 optional `edge?: number; savedAt?: string`（Task 6 已完場快照用）

- [ ] **Step 1: Write the failing test（source-string）**

喺 `src/App.test.tsx` 其中一個現有 `it(...)` 入面（例如 assert `apiClient.backtest` 嗰個 test）加：

```ts
    expect(source).toContain("isModelReadiness");
    expect(source).toContain("isPendingEntry");
    expect(source).toContain("setPendingEntries");
```

Run: `node node_modules/vitest/vitest.mjs run src/App.test.tsx`
Expected: FAIL（三個字串未存在）。

- [ ] **Step 2: `src/apiClient.ts` 擴 `BacktestResponse`**

```ts
export type BacktestResponse = {
  rows: unknown[];
  summary?: unknown;
  readiness?: unknown[];
  pending?: unknown[];
  snapshotQuality?: unknown;
};
```

- [ ] **Step 3: `src/App.tsx` 加 types**

`ResultEntry`（L47-65）加兩個 optional 欄（放 `chance?: number;` 之後）：

```ts
  edge?: number;
  savedAt?: string;
```

`ResultEntry` 之後加：

```ts
type ModelReadiness = {
  market: string;
  modelVersion: string;
  settledMatches: number;
  pendingMatches: number;
};

type PendingEntry = {
  id: string;
  matchId: string;
  market: string;
  prediction: string;
  line: number | null;
  odds: number | null;
  chance: number | null;
  edge: number | null;
  commenceTime: string | null;
  savedAt: string;
  modelVersion: string;
  source: string | null;
  status: "upcoming" | "settling" | "overdue" | "unknown";
};
```

- [ ] **Step 4: `src/App.tsx` 加 state（L95 `snapshotQuality` 嗰行後面）**

```ts
  const [readiness, setReadiness] = useState<ModelReadiness[]>([]);
  const [pendingEntries, setPendingEntries] = useState<PendingEntry[]>([]);
```

- [ ] **Step 5: `src/App.tsx` 改 `loadBacktest`（L306-322）**

```ts
  async function loadBacktest() {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const body = await apiClient.backtest();
      if (!Array.isArray(body?.rows)) throw new Error("Backend backtest 暫時不可用。");
      setResultEntries(body.rows as ResultEntry[]);
      setReadiness(Array.isArray(body.readiness) ? body.readiness.filter(isModelReadiness) : []);
      setPendingEntries(Array.isArray(body.pending) ? body.pending.filter(isPendingEntry) : []);
      setSnapshotQuality(isSnapshotQuality(body.snapshotQuality) ? body.snapshotQuality : null);
    } catch (error) {
      const cleared = clearBacktestResponseState({ resultEntries, readiness, snapshotQuality });
      setResultEntries(cleared.resultEntries);
      setReadiness(cleared.readiness);
      setPendingEntries([]);
      setSnapshotQuality(cleared.snapshotQuality);
      setHistoryError(handleProtectedError(error, "Backend backtest 暫時不可用。"));
    } finally {
      setHistoryLoading(false);
    }
  }
```

- [ ] **Step 6: `src/App.tsx` 加 guards（`isResultEntry` L946-948 後面）**

```ts
function isModelReadiness(item: unknown): item is ModelReadiness {
  return isRecord(item) && isString(item.market) && isString(item.modelVersion)
    && isFiniteNumber(item.settledMatches) && isFiniteNumber(item.pendingMatches);
}

function isPendingEntry(item: unknown): item is PendingEntry {
  return isRecord(item) && isString(item.id) && isString(item.matchId) && isString(item.market)
    && isString(item.prediction) && isString(item.savedAt) && isString(item.status);
}
```

- [ ] **Step 7: 紀錄頁都 auto-load 賠率（畀 pending join 隊名用）**

改 L284 嘅條件：

```ts
    if ((page === "today" || page === "fixtures" || page === "analysis" || page === "history") && !hkjcAutoLoadStarted.current) {
```

- [ ] **Step 8: Run tests**

Run: `node node_modules/vitest/vitest.mjs run src/App.test.tsx src/marketDisplay.test.ts`
Expected: PASS。

再全面回歸：`node node_modules/vitest/vitest.mjs run`
Expected: PASS（冇其他檔依賴改動）。

- [ ] **Step 9: Commit**

```bash
git add src/apiClient.ts src/App.tsx src/App.test.tsx
git commit -m "feat(client): wire backtest readiness and pending rows into history state"
```

---

### Task 3: `formatFixtureDayHeading`（今日 / 聽日 分組標題）

**Files:**
- Modify: `src/dashboard.ts`（LF；L35-37 `formatFixtureDateHeading` 唔准郁）
- Test: `src/dashboard.test.ts`（LF；L26-29 locked，只加新 test）

**Interfaces:**
- Produces: `formatFixtureDayHeading(value: string, now?: Date): string` — Task 4 賽程頁用。今日 → `今日 2026/08/22`；聽日 → `聽日 2026/08/23`；其他日子照舊；`未設定日期` 原樣返回。以 `Asia/Hong_Kong` 曆日判斷（重用 `fixtureDateKey`）。

- [ ] **Step 1: Write the failing test**

`src/dashboard.test.ts` import 改做：

```ts
import { formatFixtureDateHeading, formatFixtureDayHeading, groupFixturesByDate } from "./dashboard";
```

`describe("dashboard grouping")` 入面加：

```ts
  it("prefixes today and tomorrow headings in Hong Kong time", () => {
    const now = new Date("2026-08-21T17:00:00Z"); // 香港時間 2026-08-22 01:00

    expect(formatFixtureDayHeading("2026-08-22", now)).toBe("今日 2026/08/22");
    expect(formatFixtureDayHeading("2026-08-23", now)).toBe("聽日 2026/08/23");
    expect(formatFixtureDayHeading("2026-08-24", now)).toBe("2026/08/24");
    expect(formatFixtureDayHeading("未設定日期", now)).toBe("未設定日期");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run src/dashboard.test.ts`
Expected: FAIL — `formatFixtureDayHeading is not a function`。

- [ ] **Step 3: Implement**

`src/dashboard.ts` `formatFixtureDateHeading` 後面加：

```ts
export function formatFixtureDayHeading(value: string, now: Date = new Date()): string {
  if (value === "未設定日期") return value;
  const base = formatFixtureDateHeading(value);
  if (value === fixtureDateKey(now.toISOString())) return `今日 ${base}`;
  if (value === fixtureDateKey(new Date(now.getTime() + 86_400_000).toISOString())) return `聽日 ${base}`;
  return base;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run src/dashboard.test.ts`
Expected: PASS（舊 3 個 test 唔准變）。

- [ ] **Step 5: Commit**

```bash
git add src/dashboard.ts src/dashboard.test.ts
git commit -m "feat(dashboard): add today/tomorrow fixture day heading"
```

---

### Task 4: 賽程頁 h2h 一行式卡片 + 有貨 dot + 日組內時間排序

**Files:**
- Modify: `src/App.tsx`（CRLF；import L12、derived L205 後、h2h section L431-470、新 helper）
- Modify: `src/styles.css`（CRLF；喺 `.fixture-meta` block L700-704 後面加新 rules）
- Test: `src/App.test.tsx`（CRLF）

**Interfaces:**
- Consumes: Task 3 `formatFixtureDayHeading`；`buyOpportunities`（`BuyOpportunity.matchId`，fail-closed — `opportunitiesTrusted` false 時已經係空陣列，dot 自然消失，係 intended）。
- Produces: CSS classes `.fixture-list`、`.fixture-row`、`.fixture-row__time/__teams/__league/__buy-dot/__pick`（Task 6 PendingCard 外層都會用 `.fixture-list`）；`fixtureDayGroupsByTime`（Task 5 嘅 filter 會 consume 佢）。

- [ ] **Step 1: Write the failing test（source-string）**

`src/App.test.tsx` 加：

```ts
    expect(source).toContain("formatFixtureDayHeading");
    expect(source).toContain("buyMatchIds");
    expect(source).toContain("fixture-row__buy-dot");
```

Run: `node node_modules/vitest/vitest.mjs run src/App.test.tsx`
Expected: FAIL。

- [ ] **Step 2: `src/App.tsx` import 改（L12）**

```ts
import { formatFixtureDayHeading, groupFixturesByDate } from "./dashboard";
```

- [ ] **Step 3: `src/App.tsx` 加 derived values（L205 `fixtureDateGroups` 後面）**

```ts
  const fixtureDayGroupsByTime = useMemo(() => fixtureDateGroups.map((group) => ({
    ...group,
    fixtures: [...group.fixtures].sort((left, right) => Date.parse(left.commenceTime) - Date.parse(right.commenceTime)),
  })), [fixtureDateGroups]);
  const buyMatchIds = useMemo(() => new Set(buyOpportunities.map((opportunity) => opportunity.matchId)), [buyOpportunities]);
```

（`fixtureDayGroupsByTime` 喺 display 層重排 — 唔准郁 `sortFixturesByBestEdge`。）

- [ ] **Step 4: `src/App.tsx` 換 h2h section（L431-470 全段換）**

```tsx
      {page === "fixtures" && analysisTab === "h2h" ? (
      <section className="dashboard-section">
        <Panel title="即將賽事" icon={<CalendarDays size={18} />}>
          {dashboardFixtures.length === 0 ? (
            <div className="empty-state compact"><Mascot pose="chiikawa-empty" />未有賽事。輸入或拉取賠率後會出現喺呢度。<p className="empty-state__note">飲杯茶先～</p></div>
          ) : (
            <div className="fixture-list">
              {fixtureDayGroupsByTime.map((group) => (
                <div className="fixture-day" key={group.date}>
                  <h3>{formatFixtureDayHeading(group.date)}</h3>
                  <div className="fixture-list">
                    {group.fixtures.map((fixture) => {
                      const fixtureRows = rows.filter((row) => row.matchId === fixture.matchId);
                      const bestPick = bestH2hPick(fixtureRows, settings.edgeThreshold);
                      const isSelected = selectedFixture?.matchId === fixture.matchId;
                      return (
                        <div className={isSelected ? "fixture-card-wrap expanded" : "fixture-card-wrap"} key={fixture.matchId}>
                          <a className={fixture.matchId.startsWith("hkjc-") ? "fixture-row hkjc-card" : "fixture-row"} href={`#/analysis?match=${encodeURIComponent(fixture.matchId)}`}>
                            <span className="fixture-row__time">{formatTimeOnly(fixture.commenceTime)}</span>
                            <strong className="fixture-row__teams"><TeamLogo teamName={fixture.homeTeam} logos={teamLogos} /> {fixture.homeTeamZh ?? fixture.homeTeam} vs {fixture.awayTeamZh ?? fixture.awayTeam} <TeamLogo teamName={fixture.awayTeam} logos={teamLogos} /></strong>
                            {(fixture.leagueZh ?? fixture.league) ? <span className="fixture-row__league">{fixture.leagueZh ?? fixture.league}</span> : null}
                            {buyMatchIds.has(fixture.matchId) ? <span className="fixture-row__buy-dot" role="img" aria-label="有貨" title="有貨" /> : null}
                            <span className={bestPick.label.startsWith("買") ? "fixture-row__pick" : "fixture-row__pick neutral"}>{bestPick.label}</span>
                          </a>
                          {isSelected ? <FixtureDetail fixture={fixture} rows={selectedRows} /> : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

        </Panel>
      </section>
      ) : null}
```

注意：`.fixture-card-wrap` class、`a[href="#/analysis?match=..."]`、`FixtureDetail` 展開路徑全部保留（Playwright locked）。

- [ ] **Step 5: `src/App.tsx` 加 `formatTimeOnly`（`formatDate` L1007-1013 後面）**

```ts
function formatTimeOnly(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
```

- [ ] **Step 6: `src/styles.css` 加新 rules（`.fixture-meta` block L700-704 後面）**

```css
.fixture-list {
  display: grid;
  grid-column: 1 / -1;
  gap: 8px;
}

.fixture-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  min-height: var(--touch-target);
  padding: 8px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  box-shadow: var(--shadow-soft);
  color: inherit;
  text-decoration: none;
  transition: transform 150ms ease, box-shadow 150ms ease;
}

.fixture-row:hover,
.fixture-row:focus-visible {
  border-color: var(--color-primary);
  outline: none;
  transform: translateY(-2px);
}

.fixture-row__time {
  color: var(--color-muted);
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
}

.fixture-row__teams {
  flex: 1 1 auto;
  color: var(--color-text);
  font-size: 0.95rem;
}

.fixture-row__league {
  color: var(--color-muted);
  font-size: 0.78rem;
}

.fixture-row__buy-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: var(--color-positive);
  box-shadow: 0 0 0 3px rgba(127, 207, 169, 0.25);
}

.fixture-row__pick {
  padding: 4px 12px;
  border-radius: 999px;
  background: var(--color-positive-surface);
  color: var(--color-positive-text);
  font-size: 0.85rem;
  font-weight: 900;
}

.fixture-row__pick.neutral {
  background: var(--color-surface);
  color: var(--color-muted);
  border: 1px solid var(--color-border);
}
```

- [ ] **Step 7: Run tests**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS。

目視檢查（可選）：`node node_modules/typescript/lib/tsc.js --noEmit -p tsconfig.json` 無 error。

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/styles.css
git commit -m "feat(fixtures): one-line fixture rows with today headings and buy dot"
```

---

### Task 5: 賽程頁工具列 — 聯賽 chips（多選）+ 隊名搜尋

**Files:**
- Modify: `src/App.tsx`（CRLF；state、derived、Task 4 嘅 h2h section 入面加 toolbar、map 改用 `visibleFixtureDayGroups`）
- Modify: `src/styles.css`（CRLF；`.fixture-toolbar` 系列）
- Test: `src/App.test.tsx`（CRLF）

**Interfaces:**
- Consumes: Task 4 `fixtureDayGroupsByTime`、h2h section JSX。
- Produces: `visibleFixtureDayGroups`（h2h section render 用）；CSS `.fixture-toolbar`、`.fixture-toolbar__chips`、`.fixture-chip(.active)`、`.fixture-search`。

- [ ] **Step 1: Write the failing test（source-string）**

`src/App.test.tsx` 加：

```ts
    expect(source).toContain("visibleFixtureDayGroups");
    expect(source).toContain("fixture-chip");
    expect(source).toContain("搜尋球隊");
```

Run: `node node_modules/vitest/vitest.mjs run src/App.test.tsx`
Expected: FAIL。

- [ ] **Step 2: `src/App.tsx` 加 state（`analysisTab` state L115 後面）**

```ts
  const [fixtureLeagues, setFixtureLeagues] = useState<string[]>([]);
  const [fixtureSearch, setFixtureSearch] = useState("");
```

- [ ] **Step 3: `src/App.tsx` 加 derived（`buyMatchIds` 後面）**

```ts
  const fixtureLeagueOptions = useMemo(() => [...new Set(dashboardFixtures.map((fixture) => fixture.leagueZh ?? fixture.league).filter((league): league is string => Boolean(league)))].sort((left, right) => left.localeCompare(right, "zh-Hant-HK")), [dashboardFixtures]);
  const visibleFixtureDayGroups = useMemo(() => {
    const query = fixtureSearch.trim().toLowerCase();
    return fixtureDayGroupsByTime.map((group) => ({
      ...group,
      fixtures: group.fixtures.filter((fixture) => {
        if (fixtureLeagues.length > 0 && !fixtureLeagues.includes(fixture.leagueZh ?? fixture.league ?? "")) return false;
        if (!query) return true;
        return [fixture.homeTeam, fixture.awayTeam, fixture.homeTeamZh ?? "", fixture.awayTeamZh ?? ""].some((name) => name.toLowerCase().includes(query));
      }),
    })).filter((group) => group.fixtures.length > 0);
  }, [fixtureDayGroupsByTime, fixtureLeagues, fixtureSearch]);
```

- [ ] **Step 4: h2h section 加 toolbar + 換用 `visibleFixtureDayGroups`**

Task 4 嘅 section 入面，`dashboardFixtures.length === 0` 嘅 false branch 成段改做（即完整 h2h section 最終形態）：

```tsx
      {page === "fixtures" && analysisTab === "h2h" ? (
      <section className="dashboard-section">
        <Panel title="即將賽事" icon={<CalendarDays size={18} />}>
          {dashboardFixtures.length === 0 ? (
            <div className="empty-state compact"><Mascot pose="chiikawa-empty" />未有賽事。輸入或拉取賠率後會出現喺呢度。<p className="empty-state__note">飲杯茶先～</p></div>
          ) : (
            <>
              <div className="fixture-toolbar">
                {fixtureLeagueOptions.length > 0 ? (
                  <div className="fixture-toolbar__chips" role="group" aria-label="聯賽篩選">
                    {fixtureLeagueOptions.map((league) => {
                      const active = fixtureLeagues.includes(league);
                      return (
                        <button aria-pressed={active} className={active ? "fixture-chip active" : "fixture-chip"} key={league} onClick={() => setFixtureLeagues((current) => active ? current.filter((item) => item !== league) : [...current, league])} type="button">{league}</button>
                      );
                    })}
                  </div>
                ) : null}
                <input aria-label="搜尋球隊" className="fixture-search" onChange={(event) => setFixtureSearch(event.target.value)} placeholder="搜尋球隊…" type="search" value={fixtureSearch} />
              </div>
              {visibleFixtureDayGroups.length === 0 ? (
                <div className="empty-state compact"><Mascot pose="chiikawa-empty" />冇賽事符合篩選。<p className="empty-state__note">試下清除篩選～</p></div>
              ) : (
                <div className="fixture-list">
                  {visibleFixtureDayGroups.map((group) => (
                    <div className="fixture-day" key={group.date}>
                      <h3>{formatFixtureDayHeading(group.date)}</h3>
                      <div className="fixture-list">
                        {group.fixtures.map((fixture) => {
                          const fixtureRows = rows.filter((row) => row.matchId === fixture.matchId);
                          const bestPick = bestH2hPick(fixtureRows, settings.edgeThreshold);
                          const isSelected = selectedFixture?.matchId === fixture.matchId;
                          return (
                            <div className={isSelected ? "fixture-card-wrap expanded" : "fixture-card-wrap"} key={fixture.matchId}>
                              <a className={fixture.matchId.startsWith("hkjc-") ? "fixture-row hkjc-card" : "fixture-row"} href={`#/analysis?match=${encodeURIComponent(fixture.matchId)}`}>
                                <span className="fixture-row__time">{formatTimeOnly(fixture.commenceTime)}</span>
                                <strong className="fixture-row__teams"><TeamLogo teamName={fixture.homeTeam} logos={teamLogos} /> {fixture.homeTeamZh ?? fixture.homeTeam} vs {fixture.awayTeamZh ?? fixture.awayTeam} <TeamLogo teamName={fixture.awayTeam} logos={teamLogos} /></strong>
                                {(fixture.leagueZh ?? fixture.league) ? <span className="fixture-row__league">{fixture.leagueZh ?? fixture.league}</span> : null}
                                {buyMatchIds.has(fixture.matchId) ? <span className="fixture-row__buy-dot" role="img" aria-label="有貨" title="有貨" /> : null}
                                <span className={bestPick.label.startsWith("買") ? "fixture-row__pick" : "fixture-row__pick neutral"}>{bestPick.label}</span>
                              </a>
                              {isSelected ? <FixtureDetail fixture={fixture} rows={selectedRows} /> : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

        </Panel>
      </section>
      ) : null}
```

- [ ] **Step 5: `src/styles.css` 加（`.fixture-row__pick.neutral` 後面）**

```css
.fixture-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.fixture-toolbar__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.fixture-chip {
  min-height: var(--touch-target);
  padding: 6px 14px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 0.85rem;
  font-weight: 800;
  cursor: pointer;
}

.fixture-chip.active {
  border-color: var(--color-positive);
  background: var(--color-positive-surface);
  color: var(--color-positive-text);
}

.fixture-search {
  flex: 1 1 200px;
  min-height: var(--touch-target);
  padding: 8px 14px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-text);
}
```

- [ ] **Step 6: Run tests**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/styles.css
git commit -m "feat(fixtures): league chips and team search toolbar"
```

---

### Task 6: 紀錄頁重做 — readiness 進度條 + 等緊開賽 / 已完場

**Files:**
- Modify: `src/App.tsx`（CRLF；derived、history section L538-587、新 `PendingCard` component、常量）
- Modify: `src/styles.css`（CRLF；`.model-readiness` 系列 + `.history-group` 系列）
- Test: `src/App.test.tsx`（CRLF）

**Interfaces:**
- Consumes: Task 2 `readiness` / `pendingEntries` state、`PendingEntry` / `ModelReadiness` types、`ResultEntry.edge/savedAt`；Task 4 `.fixture-list`。
- Produces: `READINESS_MODELS` / `READINESS_TARGET` 常量；`marketPendingEntries`、`fixturesByMatchId` derived；`PendingCard` component；CSS `.model-readiness(__item/__head/__bar)`、`.history-group(__title/__empty)`、`.pending-card(__summary)`。

- [ ] **Step 1: Write the failing test（source-string）**

`src/App.test.tsx` 加（留意 L43 `完場對比` 原句唔准郁）：

```ts
    expect(source).toContain("model-readiness");
    expect(source).toContain("等緊開賽");
    expect(source).toContain("已完場");
    expect(source).toContain("PendingCard");
```

Run: `node node_modules/vitest/vitest.mjs run src/App.test.tsx`
Expected: FAIL。

- [ ] **Step 2: `src/App.tsx` 加常量（`OFFLINE_WARNING` L77 後面）**

```ts
const READINESS_TARGET = 30;
const READINESS_MODELS: Array<{ market: HistoryMarket; modelVersion: string }> = [
  { market: "主客和", modelVersion: "consensus-v1" },
  { market: "大細波", modelVersion: "totals-loo-v1" },
  { market: "角球", modelVersion: "corner-loo-v1" },
  { market: "亞洲讓球", modelVersion: "hdc-loo-v2" },
];
```

- [ ] **Step 3: `src/App.tsx` 加 derived（`resultRows` L235 後面）**

```ts
  const marketPendingEntries = useMemo(() => pendingEntries.filter((entry) => entry.market === historyMarket), [pendingEntries, historyMarket]);
  const fixturesByMatchId = useMemo(() => new Map(fixtures.map((fixture) => [fixture.matchId, fixture])), [fixtures]);
```

- [ ] **Step 4: 換 history section（L538-587 全段）**

```tsx
      {page === "history" ? (
      <section className="dashboard-section">
        <Panel title="完場紀錄 vs 預測" icon={<CalendarDays size={18} />}>
          {qualityWarning ? <div className="sample-warning" role="status"><Mascot pose="momonga-alert" /><AlertTriangle size={17} />{qualityWarning}</div> : null}
          <div className="model-readiness" aria-label="模型樣本進度">
            {READINESS_MODELS.map(({ market, modelVersion }) => {
              const readinessEntry = readiness.find((row) => row.market === market && row.modelVersion === modelVersion);
              const settled = readinessEntry?.settledMatches ?? 0;
              const percent = Math.min(100, Math.round((settled / READINESS_TARGET) * 100));
              return (
                <div className="model-readiness__item" key={modelVersion}>
                  <div className="model-readiness__head">
                    <span>{market}</span>
                    <span>{settled}/{READINESS_TARGET} 場</span>
                  </div>
                  <div className="model-readiness__bar" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>
                </div>
              );
            })}
          </div>
          <div className="history-toolbar">
            <div className="history-market-tabs" aria-label="完場市場">
              {(["主客和", "角球", "大細波", "亞洲讓球"] as HistoryMarket[]).map((market) => (
                <button aria-pressed={historyMarket === market} className={historyMarket === market ? "active" : ""} key={market} onClick={() => setHistoryMarket(market)} type="button">{market}</button>
              ))}
            </div>
            <div className="history-score" aria-label={`${historyMarket} 對錯百分比`}>
              <span className="positive">中 {historyStats.winPercent.toFixed(1)}%</span>
              <span className="negative">錯 {historyStats.lossPercent.toFixed(1)}%</span>
              {historyStats.push > 0 ? <small>走盤 {historyStats.push}</small> : null}
            </div>
          </div>
          <div className="history-filters" aria-label="完場記錄篩選">
            <button aria-pressed={historyView === "comparable"} className={historyView === "comparable" ? "active" : ""} onClick={() => setHistoryView("comparable")} type="button">現行模型 {comparableMatchCount} 場 · {comparableResultRows.length} 盤口</button>
            <button aria-pressed={historyView === "all"} className={historyView === "all" ? "active" : ""} onClick={() => setHistoryView("all")} type="button">全部完場資料 {marketResultRows.length}</button>
          </div>
          {historyLoading ? (
            <div aria-live="polite" className="empty-state compact" role="status"><Mascot pose="momonga-loading" /><Loader2 aria-hidden="true" className="spin" size={20} /><span>正在載入完場對比。</span></div>
          ) : historyError ? (
            <div className="empty-state compact" role="alert"><Mascot pose="momonga-alert" /><span>{historyError}</span><button className="secondary-button compact" onClick={loadBacktest}>重新載入</button></div>
          ) : (
            <>
              <section className="history-group" aria-label="等緊開賽">
                <h3 className="history-group__title">等緊開賽</h3>
                {marketPendingEntries.length === 0 ? (
                  <p className="history-group__empty">未有等緊開賽嘅{historyMarket}盤。</p>
                ) : (
                  <div className="fixture-list">
                    {marketPendingEntries.map((entry) => (
                      <PendingCard entry={entry} fixture={fixturesByMatchId.get(entry.matchId) ?? null} key={entry.id} />
                    ))}
                  </div>
                )}
              </section>
              <section className="history-group" aria-label="已完場">
                <h3 className="history-group__title">已完場</h3>
                {resultRows.length === 0 ? (
                  <div className="empty-state compact">
                    <Mascot pose="chiikawa-empty" />
                    <span>{marketResultRows.length > 0 ? `未有附帶賽前 snapshot 嘅${historyMarket}記錄。` : `暫時未有${historyMarket}完場記錄。`}</span>
                    {marketResultRows.length > 0 ? <button className="secondary-button compact" onClick={() => setHistoryView("all")}>顯示全部記錄</button> : null}
                  </div>
                ) : (
                  <div className="fixture-grid">
                    {resultRows.map((row) => (
                      <div className="fixture-card market-card" key={row.id}>
                        <span className="fixture-time">{formatDate(row.commenceTime)}</span>
                        <strong>{row.homeTeam} vs {row.awayTeam}</strong>
                        <div className="fixture-meta">
                          <span>{row.market}{row.line ? ` ${row.line}` : ""}</span>
                          <span>完場 {row.score}</span>
                          <span className={row.hit === null ? "" : row.hit ? "positive" : "negative"}>{settlementLabel(row.settlement, row.hit)}</span>
                        </div>
                        <div className="simple-pick">估 {row.prediction} → 實際 {row.actual}</div>
                        {row.modelVersion ? <span className="subtext">{row.modelVersion}{row.source ? ` · ${row.source}` : ""}</span> : null}
                        {hasPredictionSnapshot(row) ? (
                          <details className="other-lines">
                            <summary>賽前快照</summary>
                            <div className="line-list">
                              <div className="line-item"><span>盤口</span><span>{row.line ?? "—"}</span></div>
                              <div className="line-item"><span>賠率</span><span>{typeof row.odds === "number" ? row.odds.toFixed(2) : "—"}</span></div>
                              <div className="line-item"><span>模型機率</span><span>{typeof row.chance === "number" ? formatPercent(row.chance) : "—"}</span></div>
                              <div className="line-item"><span>Edge</span><span>{typeof row.edge === "number" ? formatPercent(row.edge) : "—"}</span></div>
                              <div className="line-item"><span>模型</span><span>{row.modelVersion}{row.source ? ` · ${row.source}` : ""}</span></div>
                              <div className="line-item"><span>快照時間</span><span>{row.savedAt ? formatDate(row.savedAt) : "—"}</span></div>
                            </div>
                          </details>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </Panel>
      </section>
      ) : null}
```

- [ ] **Step 5: `src/App.tsx` 加 `PendingCard`（`FixtureDetail` L634 前面）**

```tsx
function PendingCard({ entry, fixture }: { entry: PendingEntry; fixture: { homeTeam: string; awayTeam: string; homeTeamZh?: string; awayTeamZh?: string } | null }) {
  const teams = fixture ? `${fixture.homeTeamZh ?? fixture.homeTeam} vs ${fixture.awayTeamZh ?? fixture.awayTeam}` : entry.matchId;
  return (
    <details className="fixture-card market-card pending-card">
      <summary className="pending-card__summary">
        <span className="fixture-time">{entry.commenceTime ? formatDate(entry.commenceTime) : "未設定時間"}</span>
        <strong>{teams}</strong>
        <span className="fixture-meta">
          <span>{entry.market}{entry.line !== null ? ` ${entry.line}` : ""}</span>
          <span>估 {entry.prediction}</span>
          {entry.edge !== null ? <span className="positive">Edge {formatPercent(entry.edge)}</span> : null}
        </span>
      </summary>
      <div className="line-list">
        <div className="line-item"><span>盤口</span><span>{entry.line ?? "—"}</span></div>
        <div className="line-item"><span>賠率</span><span>{entry.odds !== null ? entry.odds.toFixed(2) : "—"}</span></div>
        <div className="line-item"><span>模型機率</span><span>{entry.chance !== null ? formatPercent(entry.chance) : "—"}</span></div>
        <div className="line-item"><span>Edge</span><span>{entry.edge !== null ? formatPercent(entry.edge) : "—"}</span></div>
        <div className="line-item"><span>模型</span><span>{entry.modelVersion}{entry.source ? ` · ${entry.source}` : ""}</span></div>
        <div className="line-item"><span>快照時間</span><span>{formatDate(entry.savedAt)}</span></div>
      </div>
    </details>
  );
}
```

- [ ] **Step 6: `src/styles.css` 加（`.fixture-search` 後面）**

```css
.model-readiness {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.model-readiness__item {
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
}

.model-readiness__head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: var(--color-muted);
  font-size: 0.82rem;
  font-weight: 800;
}

.model-readiness__bar {
  height: 10px;
  margin-top: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--color-border);
}

.model-readiness__bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-positive);
}

.history-group {
  display: grid;
  gap: 10px;
  margin-top: 16px;
}

.history-group__title {
  margin: 0;
  color: var(--color-primary-text);
  font-size: 0.95rem;
}

.history-group__empty {
  margin: 0;
  color: var(--color-muted);
  font-size: 0.85rem;
}

.pending-card__summary {
  display: grid;
  gap: 8px;
  cursor: pointer;
}
```

- [ ] **Step 7: Run tests**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS（特別留意 `src/App.test.tsx:43` `完場對比` 原句同其它 source-string 斷言）。

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/styles.css
git commit -m "feat(history): readiness progress plus pending and settled groups"
```

---

### Task 7: 清理 — SimpleDashboard / marketDisplay dead exports / 舊 CSS / 雜項修正

**Files:**
- Delete: `src/pages/SimpleDashboard.tsx`、`src/pages/SimpleDashboard.test.tsx`（owner 已批；全 src 得佢自己 test 引用佢）
- Modify: `src/marketDisplay.ts`（LF；刪 owner 特批嘅 dead exports）
- Modify: `src/marketDisplay.test.ts`（LF；對應刪測試）
- Modify: `src/styles.css`（CRLF；刪舊 analysis CSS）
- Modify: `src/stakeDisplay.test.ts`（LF；註解修正）
- Modify: `src/components/PickCard.tsx`（LF；L33 raw ISO 格式化）
- Modify: `src/components/PickCard.test.tsx`（LF；同步斷言）
- Modify: `src/pages/TodayPage.tsx`（LF；stale 時收起即將開賽）
- Modify: `src/pages/TodayPage.test.tsx`（LF；加 stale 斷言）
- Modify: `tests/ui/dashboard.spec.ts`（CRLF；flaky fix）

**Interfaces:**
- Consumes: 全部已存在。
- Produces: 無新 interface。`marketDisplay.ts` 保留 export：`SnapshotQuality`、`BacktestResponseState`、`clearBacktestResponseState`、`isSnapshotQuality`、`cornerPickLabel`、`snapshotQualityMessage`、`groupMarketCards`、`hasPredictionSnapshot`、`filterHistoryRows`、`summarizeHistoryRows`、`excludeLegacyRows`（`src/App.tsx:17` 嘅 import 唔使改）。

- [ ] **Step 1: 刪 SimpleDashboard**

```bash
git rm src/pages/SimpleDashboard.tsx src/pages/SimpleDashboard.test.tsx
```

- [ ] **Step 2: 刪 marketDisplay dead exports（owner 一次性特批，淨限以下）**

`src/marketDisplay.ts` 刪除：
- `PerformanceRow` type（L85-96）
- `PerformanceSummary` type（L98-109）
- `selectDistinctPerformanceRows`（L111-131）
- `summarizePerformanceRows`（L133-149）
- `currentModelRows`（L155-159）
- `predictionDistribution`（L161-167）
- `calibrationBuckets`（L169-175）
- private helpers：`settlementProfit`（L177-183）、`normalizeDecimal`（L185-187）、`comparePerformanceRepresentatives`（L189-198）、`compareFiniteNumbers`（L200-206）

保留：`excludeLegacyRows`（L151-153）同其餘全部。

`src/marketDisplay.test.ts`：
- import 行（L2）改做：

```ts
import { clearBacktestResponseState, cornerPickLabel, excludeLegacyRows, filterHistoryRows, groupMarketCards, hasPredictionSnapshot, isSnapshotQuality, snapshotQualityMessage, summarizeHistoryRows } from "./marketDisplay";
```

- L69-78 個 test（`honors valid-current status...`）刪走 `currentModelRows` 斷言，淨返：

```ts
  it("honors valid-current status when supplied while accepting old-server rows", () => {
    const rows = [
      { prediction: "大", modelVersion: "totals-v1", snapshotStatus: "valid-current" },
      { prediction: "細", modelVersion: "totals-v1", snapshotStatus: "invalid" },
      { prediction: "大", modelVersion: "totals-v1" },
    ];

    expect(rows.map(hasPredictionSnapshot)).toEqual([true, false, true]);
  });
```

- 刪晒 L105-189 嘅六個 test：`summarizes priced model performance...`（L105-117）、`builds prediction direction and calibration summaries`（L119-136）、`uses one highest-edge representative...`（L138-153）、`counts priced pushes in ROI...`（L155-164）、`uses deterministic tie-breaks...`（L166-176）、`selects representatives globally before assigning calibration buckets`（L178-189）。

Run: `node node_modules/vitest/vitest.mjs run src/marketDisplay.test.ts`
Expected: PASS。

- [ ] **Step 3: 刪舊 analysis CSS（`src/styles.css`）**

刪除範圍（全部已 grep 確認全 src 冇引用）：
- `.analysis-performance`（L821-824）
- `.performance-market-grid`（L826-830）
- `.performance-market-card` 系列（L832-883，**包括** 同 `.model-summary-card` 混合嘅 selector rules L853-866、L874-878、L880-883）
- `.model-summary-grid`（L897-901）、`.model-summary-card`（L903-908）
- `.readiness-head, .health-tags` 系列（L910-937）+ `.model-summary-card strong`（L939-942）
- `.performance-detail-grid`（L944-949）、`.performance-bars / .performance-bar-row / .performance-bar` 系列（L951-984）
- `@media (max-width: 1050px)` 入面嘅 `.performance-market-grid {...}`（L1004-1006）同 `.performance-detail-grid {...}`（L1008-1010）兩個 rule
- `@media (max-width: 720px)` 入面 L1027 嘅 `  .performance-market-grid,` **淨係呢一行**（其餘 selector 保留）

**唔准刪**：`.sample-warning`（L885-895）— LIVE。

- [ ] **Step 4: `src/stakeDisplay.test.ts` 註解修正**

L15-19 個 test 改做：

```ts
  it("returns fractional Kelly stake when below the cap", () => {
    // fullKelly = (0.36*3.0-1)/(3.0-1) = 0.04 → ×0.25 = 0.01 < 0.02 cap → 1000×0.01 = 10
    expect(displayStake(pick(0.36, 3.0))).toBe(10);
  });
```

- [ ] **Step 5: PickCard 同步時間格式化**

`src/components/PickCard.tsx` L33：

```tsx
        <p>賠率同步於 {props.generatedAt ? formatKickoff(props.generatedAt) : "未有成功同步"}</p>
```

`src/components/PickCard.test.tsx` L51 斷言改做動態計算（同 L75-82 `formatKickoff` test 一個做法）：

```ts
    const syncDate = new Date("2026-07-21T12:00:00Z");
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(markup).toContain(`賠率同步於 ${syncDate.getMonth() + 1}月${syncDate.getDate()}日 ${pad(syncDate.getHours())}:${pad(syncDate.getMinutes())}`);
```

- [ ] **Step 6: TodayPage stale 時收起即將開賽**

`src/pages/TodayPage.tsx` L52-66 嘅 upcoming section 成段改做：

```tsx
      {!props.dataFresh ? null : (
      <section className="today-page__upcoming" aria-label="即將開賽">
        <h2>即將開賽</h2>
        <ul>
          {props.fixtures.slice(0, UPCOMING_FIXTURE_COUNT).map((item) => (
            <li key={item.matchId} className="today-page__upcoming-item">
              <a href={`#/fixtures/${encodeURIComponent(item.matchId)}`}>
                <TeamLogo teamName={item.homeTeam} logos={props.logos} />
                {item.homeTeamZh ?? item.homeTeam} vs {item.awayTeamZh ?? item.awayTeam}
                <time dateTime={item.commenceTime}>{formatKickoff(item.commenceTime)}</time>
              </a>
            </li>
          ))}
        </ul>
        <a href="#/fixtures">查看全部賽事</a>
      </section>
      )}
```

`src/pages/TodayPage.test.tsx` `shows stale empty state...` 個 test（L63-69）加一句：

```ts
    expect(markup).not.toContain("today-page__upcoming");
```

- [ ] **Step 7: Flaky fix — `tests/ui/dashboard.spec.ts`**

L53 `await expectDashboardColumns(page, testInfo.project.name);` **前面**加：

```ts
  await expect(page.locator(".dashboard-card")).toHaveCount(2);
```

（root cause：`expectDashboardColumns` 係 one-shot `evaluateAll`，冇 auto-retry；先等 cards 出齊先度位。）

- [ ] **Step 8: Run full unit tests + tsc**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS。

Run: `node node_modules/typescript/lib/tsc.js --noEmit -p tsconfig.json`
Expected: 無 error（特別留意刪咗 exports 之後冇 dangling import）。

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: drop SimpleDashboard, dead marketDisplay exports, legacy analysis CSS"
```

---

### Task 8: E2E mock 擴充 + 新斷言

**Files:**
- Modify: `tests/ui/helpers.ts`（CRLF；`entry()`/`total()` 加 league、backtest mock 加 rows/readiness/pending）
- Modify: `tests/ui/dashboard.spec.ts`（CRLF；加 fixtures toolbar test + history groups test）

**Interfaces:**
- Consumes: Task 1 pending shape、Task 4/5/6 嘅新 classes 同文案。
- Produces: mock `entry(id, matchId, homeTeam, awayTeam, bookmaker, odds, commenceTime?, league?)`、`total(..., league?)`；backtest mock response `{ rows, readiness, pending, snapshotQuality }`。

- [ ] **Step 1: `tests/ui/helpers.ts` — `entry()` / `total()` 加 league**

```ts
export function entry(id: string, matchId: string, homeTeam: string, awayTeam: string, bookmaker: string, odds: { home: number; draw: number; away: number }, commenceTime = FUTURE_KICKOFF, league?: string) {
  return { id, matchId, homeTeam, awayTeam, commenceTime, bookmaker, odds, ...(league ? { league } : {}) };
}

export function total(id: string, matchId: string, homeTeam: string, awayTeam: string, bookmaker: string, overOdds: number, underOdds: number, league?: string) {
  return { id, matchId, homeTeam, awayTeam, commenceTime: FUTURE_KICKOFF, bookmaker, line: 2.5, overOdds, underOdds, ...(league ? { league } : {}) };
}
```

`h2hEntries` 加 league（其餘欄唔改）：

```ts
export const h2hEntries = [
  entry("value-a", "match-value", "Value United", "Signal City", "Book A", { home: 2.4, draw: 3.2, away: 3.0 }, FUTURE_KICKOFF, "Premier League"),
  entry("value-b", "match-value", "Value United", "Signal City", "Book B", { home: 1.8, draw: 3.6, away: 4.8 }, FUTURE_KICKOFF, "Premier League"),
  entry("boundary-a", "match-boundary", "Boundary FC", "Threshold Town", "Book A", { home: 2.0, draw: 3.5, away: 4.0 }, FUTURE_KICKOFF, "Premier League"),
  entry("boundary-b", "match-boundary", "Boundary FC", "Threshold Town", "Book B", { home: 2.0, draw: 3.5, away: 4.0 }, FUTURE_KICKOFF, "Premier League"),
  entry("below-a", "match-below", "Below United", "No Buy Rovers", "Book A", { home: 2.0, draw: 3.5, away: 4.0 }, FUTURE_KICKOFF, "Serie A"),
  entry("below-b", "match-below", "Below United", "No Buy Rovers", "Book B", { home: 2.0, draw: 3.5, away: 4.0 }, FUTURE_KICKOFF, "Serie A"),
  entry("past-a", "match-past", "Past High Edge", "Expired City", "Book A", { home: 10, draw: 2, away: 2 }, PAST_KICKOFF, "Serie A"),
  entry("past-b", "match-past", "Past High Edge", "Expired City", "Book B", { home: 1.1, draw: 10, away: 10 }, PAST_KICKOFF, "Serie A"),
];
```

`totalEntries` 照樣加 `"Premier League"` / `"Serie A"`（同 match 對應）。

- [ ] **Step 2: `tests/ui/helpers.ts` — backtest mock 換真資料**

`/api/v1/backtest` 嗰段（L142-151）改做：

```ts
    if (pathname === "/api/v1/backtest") {
      await route.fulfill({
        status: scenario === "backtest-failed" ? 503 : 200,
        contentType: "application/json",
        body: JSON.stringify(scenario === "backtest-failed"
          ? { error: "unavailable" }
          : {
            rows: [{
              id: "match-finished-主客和|match-finished|主客和||consensus-v1",
              matchId: "match-finished",
              homeTeam: "Finished United",
              awayTeam: "Settled City",
              commenceTime: PAST_KICKOFF,
              score: "2-1",
              market: "主客和",
              prediction: "主勝",
              actual: "主勝",
              hit: true,
              settlement: "win",
              odds: 2.1,
              chance: 0.52,
              edge: 0.09,
              savedAt: "2020-07-17T10:00:00.000Z",
              snapshotStatus: "valid-current",
              modelVersion: "consensus-v1",
              source: "market-consensus",
            }],
            readiness: [
              { market: "主客和", modelVersion: "consensus-v1", settledMatches: 12, pendingMatches: 1 },
              { market: "大細波", modelVersion: "totals-loo-v1", settledMatches: 30, pendingMatches: 0 },
              { market: "角球", modelVersion: "corner-loo-v1", settledMatches: 7, pendingMatches: 0 },
              { market: "亞洲讓球", modelVersion: "hdc-loo-v2", settledMatches: 0, pendingMatches: 0 },
            ],
            pending: [{
              id: "match-value|主客和||consensus-v1",
              matchId: "match-value",
              market: "主客和",
              prediction: "主勝",
              line: null,
              odds: 1.8,
              chance: 0.6,
              edge: 0.08,
              commenceTime: FUTURE_KICKOFF,
              savedAt: "2030-07-17T10:00:00.000Z",
              modelVersion: "consensus-v1",
              source: "market-consensus",
              status: "upcoming",
            }],
            snapshotQuality: null,
          }),
      });
      return;
    }
```

注意 `helpers.ts:158` 對 unmocked request 會 throw — 冇新 endpoint，唔使加 route。

- [ ] **Step 3: `tests/ui/dashboard.spec.ts` 加兩個 test（檔尾 helper functions 之前）**

```ts
test("fixtures toolbar filters by league chip and team search, and marks buy fixtures", async ({ page }) => {
  await page.goto("/#/fixtures");

  await expect(page.locator(".fixture-row")).toHaveCount(3);
  await expect(page.locator(".fixture-row__buy-dot")).toHaveCount(1);

  await page.getByRole("button", { name: "Serie A" }).click();
  await expect(page.locator(".fixture-row")).toHaveCount(1);
  await expect(page.locator(".fixture-row")).toContainText("Below United");

  await page.getByRole("button", { name: "Serie A" }).click();
  await page.getByLabel("搜尋球隊").fill("Boundary");
  await expect(page.locator(".fixture-row")).toHaveCount(1);
  await expect(page.locator(".fixture-row")).toContainText("Boundary FC");
});

test("history shows model readiness plus pending and settled groups", async ({ page }) => {
  await page.goto("/#/history");

  await expect(page.locator(".model-readiness__item")).toHaveCount(4);
  await expect(page.locator(".model-readiness")).toContainText("12/30 場");

  const groups = page.locator(".history-group");
  await expect(groups.nth(0)).toContainText("等緊開賽");
  await expect(page.locator(".pending-card")).toHaveCount(1);
  await expect(page.locator(".pending-card")).toContainText("Value United vs Signal City");

  await expect(groups.nth(1)).toContainText("已完場");
  await expect(groups.nth(1).locator(".fixture-card")).toHaveCount(1);
  await expect(groups.nth(1)).toContainText("Finished United vs Settled City");
});
```

（`match-value` 嘅 pending row 會 join 到 live odds mock 嘅 `Value United vs Signal City` — Task 2 Step 7 令 history 頁都 auto-load 賠率先成立。）

- [ ] **Step 4: Build + run Playwright**

Run:
```bash
node node_modules/typescript/lib/tsc.js --noEmit -p tsconfig.json && node node_modules/vite/bin/vite.js build
npm.cmd run test:ui:only
```
Expected: 全綠（包括舊 spec — 特別留意 `.fixture-card-wrap` count 3、`.empty-state[role='alert']`、`backtest-failed` scenario 仍然 work，因為 failed scenario 行嘅係舊 response）。

- [ ] **Step 5: Commit**

```bash
git add tests/ui/helpers.ts tests/ui/dashboard.spec.ts
git commit -m "test(ui): rich backtest mock plus fixtures toolbar and history groups coverage"
```

---

## Self-Review 紀錄（plan 作者已做）

1. **Spec coverage**：賽程頁（Task 3/4/5）、server pending（Task 1）、紀錄頁（Task 2/6）、清理（Task 7）、mock/e2e（Task 8）— 全覆蓋。
2. **Locked 紅線覆核**：`formatFixtureDateHeading` / `sortFixturesByBestEdge` 冇郁；`.fixture-card-wrap` / analysis link / `.fixture-detail` 保留；`.empty-state[role="alert"]` 保留；`完場對比` h1 原句保留；`.sample-warning` 保留；`BuyDashboard` 冇掂；模型參數冇郁。
3. **Type consistency**：`PendingEntry`（Task 2）欄位同 server `buildPendingRows`（Task 1）逐欄對齊；`PendingCard` prop 用 structural type 唔使加 `Fixture` import；`fixtureDayGroupsByTime`（Task 4）→ `visibleFixtureDayGroups`（Task 5）名稱一致。
