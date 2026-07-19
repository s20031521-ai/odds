### Task 2: `SimpleDashboard` — 極簡卡片 view

**Files:**
- Create: `src/pages/SimpleDashboard.tsx`
- Test: `src/pages/SimpleDashboard.test.tsx`
- Modify: `src/styles/dashboard.css`(append,唔改現有 rules)

**Interfaces:**
- Consumes: `BuyOpportunity`、`BuyPick` from `src/buyOpportunities.ts`(`primary: BuyPick`、`alternatives: BuyPick[]`;`BuyPick = { market, selection, line?, odds, chance, edge, bookmaker }`)
- Produces(Task 3 會用):
  - `SimpleDashboard(props: { opportunities: BuyOpportunity[]; generatedAt: string | null; dataFresh: boolean }): React.ReactElement`
  - CSS class:`simple-dashboard`、`simple-dashboard__header`、`simple-dashboard__sync`、`simple-dashboard__grid`、`simple-dashboard__empty`、`simple-card`、`simple-card__link`、`simple-card__meta`、`simple-card__picks`

注意:`formatSelection` / `formatOdds` / `formatDate` / `pickKey` 呢啲小 helper 喺 `SimpleDashboard.tsx` 內部自己寫一份(同 BuyDashboard 嗰份一樣),因為 BuyDashboard 唔准改、唔可以 export 出嚟。

- [ ] **Step 1: 寫 failing test** — 建立 `src/pages/SimpleDashboard.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuyOpportunity } from "../buyOpportunities";
import { SimpleDashboard } from "./SimpleDashboard";

const opportunities: BuyOpportunity[] = [
  {
    matchId: "match-1",
    homeTeam: "Home",
    awayTeam: "Away",
    homeTeamZh: "主隊",
    awayTeamZh: "客隊",
    commenceTime: "2026-07-17T12:00:00Z",
    league: "English Premier League",
    leagueZh: "英格蘭超級聯賽",
    primary: { market: "主客和", selection: "主隊", odds: 2.1, chance: 0.52, edge: 0.092, bookmaker: "Alpha" },
    alternatives: [
      { market: "大細波", selection: "大", line: 2.5, odds: 2, chance: 0.54, edge: 0.08, bookmaker: "Beta" },
    ],
  },
  {
    matchId: "match-2",
    homeTeam: "Second Home",
    awayTeam: "Second Away",
    commenceTime: "2026-07-18T12:00:00Z",
    league: "Liga MX",
    primary: { market: "角球", selection: "細角", line: 9.5, odds: 1.95, chance: 0.55, edge: 0.0725, bookmaker: "Gamma" },
    alternatives: [],
  },
];

describe("SimpleDashboard", () => {
  it("renders one card per qualifying match with every qualifying pick as its own row", () => {
    const markup = renderToStaticMarkup(<SimpleDashboard opportunities={opportunities} generatedAt="2026-07-16T12:34:00Z" dataFresh />);

    expect(markup.match(/<article/g) ?? []).toHaveLength(2);
    // match-1 有 2 個過關盤、match-2 有 1 個:合共 3 行,一行都唔多唔少
    expect(markup.match(/<li/g) ?? []).toHaveLength(3);
    expect(markup).toContain("主客和 · 主隊");
    expect(markup).toContain("大細波 · 大 2.5");
    expect(markup).toContain("角球 · 細角 9.5");
    expect(markup).toContain("2.10");
    expect(markup).toContain("1.95");
    expect(markup).toContain('href="#/fixtures/match-1"');
  });

  it("renders Chinese league and team names with English fallback, plus kickoff time", () => {
    const markup = renderToStaticMarkup(<SimpleDashboard opportunities={opportunities} generatedAt="now" dataFresh />);

    expect(markup).toContain("英格蘭超級聯賽");
    expect(markup).toContain("Liga MX");
    expect(markup).toContain("<h2>主隊 <span>vs</span> 客隊</h2>");
    expect(markup).toContain("<h2>Second Home <span>vs</span> Second Away</h2>");
    expect(markup).toContain('dateTime="2026-07-17T12:00:00Z"');
  });

  it("shows no detail numbers: no bookmaker, chance or edge anywhere", () => {
    const markup = renderToStaticMarkup(<SimpleDashboard opportunities={opportunities} generatedAt="now" dataFresh />);

    expect(markup).not.toContain("Alpha");
    expect(markup).not.toContain("52.00%");
    expect(markup).not.toContain("9.20%");
    expect(markup).not.toContain("KPI");
  });

  it("renders the minimal empty state without the all-fixtures link", () => {
    const markup = renderToStaticMarkup(<SimpleDashboard opportunities={[]} generatedAt="now" dataFresh />);

    expect(markup).toContain("暫時冇場次過關");
    expect(markup).not.toContain("#/fixtures");
  });

  it("hides all picks when data is stale", () => {
    const markup = renderToStaticMarkup(<SimpleDashboard opportunities={opportunities} generatedAt="now" dataFresh={false} />);

    expect(markup).toContain("資料未更新，暫停顯示買盤。");
    expect(markup).not.toContain("<article");
  });

  it("keeps the sync line and discloses when no sync has succeeded", () => {
    const markup = renderToStaticMarkup(
      <SimpleDashboard opportunities={[]} generatedAt={null} dataFresh={false} />,
    );

    expect(markup).toContain("同步時間");
    expect(markup).toContain("未有成功同步");
  });
});
```

- [ ] **Step 2: 行測試確認 fail**

Run: `npx vitest run src/pages/SimpleDashboard.test.tsx`
Expected: FAIL,`Failed to resolve import "./SimpleDashboard"`

- [ ] **Step 3: 實作** — 建立 `src/pages/SimpleDashboard.tsx`:

```tsx
import type { BuyOpportunity, BuyPick } from "../buyOpportunities";

export function SimpleDashboard(props: {
  opportunities: BuyOpportunity[];
  generatedAt: string | null;
  dataFresh: boolean;
}): React.ReactElement {
  const activeOpportunities = props.dataFresh ? props.opportunities : [];

  return (
    <section className="simple-dashboard" aria-labelledby="simple-dashboard-title">
      <header className="simple-dashboard__header">
        <h1 id="simple-dashboard-title">值得買</h1>
        <p className="simple-dashboard__sync">同步時間 {props.generatedAt ? <time dateTime={props.generatedAt}>{props.generatedAt}</time> : "未有成功同步"}</p>
      </header>

      {!props.dataFresh ? (
        <div className="simple-dashboard__empty" role="status">資料未更新，暫停顯示買盤。</div>
      ) : activeOpportunities.length === 0 ? (
        <div className="simple-dashboard__empty">暫時冇場次過關</div>
      ) : (
        <div className="simple-dashboard__grid">
          {activeOpportunities.map((opportunity) => (
            <SimpleCard key={opportunity.matchId} opportunity={opportunity} />
          ))}
        </div>
      )}
    </section>
  );
}

function SimpleCard({ opportunity }: { opportunity: BuyOpportunity }): React.ReactElement {
  const picks = [opportunity.primary, ...opportunity.alternatives];
  const league = opportunity.leagueZh ?? opportunity.league;

  return (
    <article className="simple-card">
      <a className="simple-card__link" href={`#/fixtures/${encodeURIComponent(opportunity.matchId)}`}>
        <p className="simple-card__meta">
          {league ? `${league} · ` : ""}<time dateTime={opportunity.commenceTime}>{formatDate(opportunity.commenceTime)}</time>
        </p>
        <h2>{opportunity.homeTeamZh ?? opportunity.homeTeam} <span>vs</span> {opportunity.awayTeamZh ?? opportunity.awayTeam}</h2>
        <ul className="simple-card__picks">
          {picks.map((pick) => (
            <li key={pickKey(pick)}>
              <span>{pick.market} · {formatSelection(pick)}</span>
              <strong>{formatOdds(pick.odds)}</strong>
            </li>
          ))}
        </ul>
      </a>
    </article>
  );
}

function formatSelection(pick: BuyPick): string {
  return pick.line === undefined ? pick.selection : `${pick.selection} ${formatLine(pick.line)}`;
}

function formatLine(line: number): string {
  return `${line > 0 ? "+" : ""}${Number.isInteger(line) ? line.toFixed(1) : line}`;
}

function formatOdds(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "—";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function pickKey(pick: BuyPick): string {
  return `${pick.market}|${pick.line ?? ""}|${pick.selection}|${pick.bookmaker}`;
}
```

- [ ] **Step 4: 行測試確認 pass**

Run: `npx vitest run src/pages/SimpleDashboard.test.tsx`
Expected: PASS,6 個 test 全過

- [ ] **Step 5: 加 CSS** — append 落 `src/styles/dashboard.css` 尾(現有 193 行全部唔郁):

```css
.simple-dashboard {
  display: grid;
  gap: 20px;
}

.simple-dashboard__header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
}

.simple-dashboard__header h1 {
  margin: 0;
}

.simple-dashboard__sync,
.simple-card__meta {
  color: var(--color-muted);
}

.simple-dashboard__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
  gap: 16px;
}

.simple-card {
  border: 1px solid color-mix(in srgb, var(--color-positive) 45%, transparent);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  overflow: hidden;
}

.simple-card__link {
  display: grid;
  gap: 10px;
  padding: 18px;
  color: inherit;
  text-decoration: none;
}

.simple-card__meta {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 500;
}

.simple-card h2 {
  margin: 0;
  font-size: 1.15rem;
}

.simple-card h2 span {
  color: var(--color-muted);
  font-weight: 500;
}

.simple-card__picks {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 10px 0 0;
  border-top: 1px solid color-mix(in srgb, var(--color-primary) 35%, transparent);
  list-style: none;
}

.simple-card__picks li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.simple-card__picks strong {
  color: var(--color-positive);
  font-size: 1.05rem;
}

.simple-dashboard__empty {
  border: 1px solid color-mix(in srgb, var(--color-primary) 35%, transparent);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  padding: 32px 20px;
  text-align: center;
}

@media (max-width: 720px) {
  .simple-dashboard__grid {
    grid-template-columns: 1fr;
  }

  .simple-dashboard__header {
    align-items: start;
    flex-direction: column;
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/pages/SimpleDashboard.tsx src/pages/SimpleDashboard.test.tsx src/styles/dashboard.css
git commit -m "feat: add minimal simple dashboard view"
```

---

