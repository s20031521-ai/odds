### Task 4: `MatchAnalysisPage`

**Files:**
- Create: `src/pages/MatchAnalysisPage.tsx`
- Test: `src/pages/MatchAnalysisPage.test.tsx`
- Modify: `src/styles/match.css`（加頁面級樣式）

**Interfaces:**
- Consumes: `MatchHeaderInfo` / `MatchMarketDetails`（Task 2）、`MarketDetailCard`（Task 3）、`BuyOpportunity`（`src/buyOpportunities.ts:26-37`）、`formatKickoff`（`src/components/PickCard.tsx:59`）、`TeamLogo` / `TeamLogoMap`、`Mascot`（`src/components/Kawaii.tsx`，pose `"chiikawa-empty"`）。
- Produces: `MatchAnalysisPage(props)` — Task 6 App.tsx 用：

```ts
export function MatchAnalysisPage(props: {
  matchId: string | null;
  header: MatchHeaderInfo | null;
  details: MatchMarketDetails | null;
  opportunities: BuyOpportunity[];
  logos: TeamLogoMap;
  generatedAt: string | null;
}): React.ReactElement;
```

行為規則（spec §2.4）：
1. `matchId === null`（裸 `#/analysis`）→ picker：Mascot `chiikawa-empty` + 「由今日或賽程揀一場波」+ 今日有貨場次快捷入口（`opportunities` dedupe by matchId，每個 link `#/analysis?match=<encoded>`，顯示「主 vs 客 · 開賽時間」）。
2. `matchId` 有但 `header`/`details` null → 「搵唔到呢場波 — 可能已開賽或已下架」+ link `#/analysis`「揀返另一場 →」。
3. 齊料 → header（logo + 主 vs 客 + logo、`formatKickoff(commenceTime)`、聯賽、「轉場」link 指 `#/analysis`）→ 四張 `MarketDetailCard`（主客和 / 大細波 / 角球 / 亞洲讓球，次序固定）→ 尾行「賠率同步於 {generatedAt ?? "未有成功同步"}」。

- [ ] **Step 1: 寫失敗測試 `src/pages/MatchAnalysisPage.test.tsx`**

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatchAnalysisPage } from "./MatchAnalysisPage";
import type { MatchHeaderInfo, MatchMarketDetails } from "../matchDetails";
import type { BuyOpportunity } from "../buyOpportunities";

const header: MatchHeaderInfo = {
  matchId: "m1", homeTeam: "Home FC", awayTeam: "Away FC",
  homeTeamZh: "主隊", awayTeamZh: "客隊",
  commenceTime: "2030-01-01T20:00:00.000Z", league: "EPL", leagueZh: "英超",
};

const details: MatchMarketDetails = {
  h2h: { kind: "ok", selection: "主勝", odds: 2.0, chance: 0.58, implied: 0.5, edge: 0.16, stake: 20, bookmaker: "Book A" },
  totals: { kind: "empty" },
  corners: { kind: "insufficient", note: "資料不足，唔買" },
  handicap: { kind: "empty" },
};

function opportunity(matchId: string): BuyOpportunity {
  return {
    matchId, homeTeam: "Home FC", awayTeam: "Away FC",
    homeTeamZh: "主隊", awayTeamZh: "客隊",
    commenceTime: "2030-01-01T20:00:00.000Z",
    primary: { market: "主客和", selection: "主勝", odds: 2.0, chance: 0.58, edge: 0.16, bookmaker: "Book A" },
    alternatives: [],
  };
}

const base = { matchId: "m1", header, details, opportunities: [] as BuyOpportunity[], logos: {}, generatedAt: "2026-07-21T09:00:00.000Z" };

describe("MatchAnalysisPage", () => {
  it("renders header, four market cards and sync timestamp", () => {
    const markup = renderToStaticMarkup(<MatchAnalysisPage {...base} />);
    expect(markup).toContain("主隊 vs 客隊");
    expect(markup).toContain("英超");
    expect(markup).toContain("轉場");
    expect(markup).toContain('href="#/analysis"');
    expect(markup).toContain("模型估 58.0%，莊家開 50.0%");
    expect(markup).toContain("呢個市場冇盤");
    expect(markup).toContain("資料不足，唔買");
    expect(markup).toContain("賠率同步於 2026-07-21T09:00:00.000Z");
  });

  it("shows picker with quick links when no match selected", () => {
    const markup = renderToStaticMarkup(
      <MatchAnalysisPage {...base} matchId={null} header={null} details={null} opportunities={[opportunity("m1"), opportunity("m1"), opportunity("m2")]} />,
    );
    expect(markup).toContain("由今日或賽程揀一場波");
    expect(markup).toContain('href="#/analysis?match=m1"');
    expect(markup).toContain('href="#/analysis?match=m2"');
    // dedupe：m1 只出一次
    expect(markup.match(/#\/analysis\?match=m1/g)?.length).toBe(1);
  });

  it("shows not-found state for unknown match", () => {
    const markup = renderToStaticMarkup(<MatchAnalysisPage {...base} matchId="ghost" header={null} details={null} />);
    expect(markup).toContain("搵唔到呢場波");
    expect(markup).toContain('href="#/analysis"');
  });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `node node_modules/vitest/vitest.mjs run src/pages/MatchAnalysisPage.test.tsx`
Expected: FAIL（module not found）

- [ ] **Step 3: 實裝 `src/pages/MatchAnalysisPage.tsx`**

```tsx
import type { BuyOpportunity } from "../buyOpportunities";
import { Mascot } from "../components/Kawaii";
import { MarketDetailCard } from "../components/MarketDetailCard";
import { formatKickoff } from "../components/PickCard";
import { TeamLogo, type TeamLogoMap } from "../components/TeamLogo";
import type { MatchHeaderInfo, MatchMarketDetails } from "../matchDetails";

const MARKETS: Array<{ key: keyof MatchMarketDetails; label: string }> = [
  { key: "h2h", label: "主客和" },
  { key: "totals", label: "大細波" },
  { key: "corners", label: "角球" },
  { key: "handicap", label: "亞洲讓球" },
];

export function MatchAnalysisPage(props: {
  matchId: string | null;
  header: MatchHeaderInfo | null;
  details: MatchMarketDetails | null;
  opportunities: BuyOpportunity[];
  logos: TeamLogoMap;
  generatedAt: string | null;
}): React.ReactElement {
  if (!props.matchId) {
    const matches = uniqueMatches(props.opportunities);
    return (
      <section className="match-analysis">
        <div className="today-empty" role="status">
          <Mascot pose="chiikawa-empty" />
          <p>由今日或賽程揀一場波</p>
        </div>
        {matches.length > 0 ? (
          <ul className="match-analysis__picker">
            {matches.map((match) => (
              <li key={match.matchId}>
                <a href={`#/analysis?match=${encodeURIComponent(match.matchId)}`}>
                  {match.homeTeamZh ?? match.homeTeam} vs {match.awayTeamZh ?? match.awayTeam} · {formatKickoff(match.commenceTime)}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    );
  }

  const { header, details } = props;
  if (!header || !details) {
    return (
      <section className="match-analysis">
        <div className="today-empty" role="status">
          <Mascot pose="chiikawa-empty" />
          <p>搵唔到呢場波 — 可能已開賽或已下架</p>
        </div>
        <p className="match-analysis__back"><a href="#/analysis">揀返另一場 →</a></p>
      </section>
    );
  }

  return (
    <section className="match-analysis">
      <header className="match-analysis__header">
        <h1 className="page-heading">
          <TeamLogo teamName={header.homeTeam} logos={props.logos} />
          {header.homeTeamZh ?? header.homeTeam} vs {header.awayTeamZh ?? header.awayTeam}
          <TeamLogo teamName={header.awayTeam} logos={props.logos} />
        </h1>
        <p className="match-analysis__meta">
          {formatKickoff(header.commenceTime)}
          {header.leagueZh ?? header.league ? ` · ${header.leagueZh ?? header.league}` : ""}
          {" · "}
          <a href="#/analysis">轉場</a>
        </p>
      </header>
      <div className="market-detail-grid">
        {MARKETS.map(({ key, label }) => (
          <MarketDetailCard key={key} market={label} detail={details[key]} />
        ))}
      </div>
      <p className="match-analysis__sync">賠率同步於 {props.generatedAt ?? "未有成功同步"}</p>
    </section>
  );
}

function uniqueMatches(opportunities: BuyOpportunity[]): Array<Pick<BuyOpportunity, "matchId" | "homeTeam" | "awayTeam" | "homeTeamZh" | "awayTeamZh" | "commenceTime">> {
  const seen = new Set<string>();
  const matches: Array<Pick<BuyOpportunity, "matchId" | "homeTeam" | "awayTeam" | "homeTeamZh" | "awayTeamZh" | "commenceTime">> = [];
  for (const opportunity of opportunities) {
    if (seen.has(opportunity.matchId)) continue;
    seen.add(opportunity.matchId);
    matches.push(opportunity);
  }
  return matches;
}
```

- [ ] **Step 4: `src/styles/match.css` 加頁面級樣式**

```css
.match-analysis__header .page-heading {
  /* 跟 today.css heading 風格 */
}

.match-analysis__meta {
  /* muted 細字 */
}

.match-analysis__picker {
  list-style: none;
  /* 每個 link 做 card-like 大行，min-height 跟 --touch-target: 44px */
}

.match-analysis__picker a {
  display: block;
  min-height: var(--touch-target);
}

.match-analysis__sync,
.match-analysis__back {
  /* muted 細字，置中跟 today.css 嘅 footer 風格 */
}
```

- [ ] **Step 5: 跑測試確認 pass**

Run: `node node_modules/vitest/vitest.mjs run src/pages/MatchAnalysisPage.test.tsx`
Expected: PASS（3 tests）。注意 `formatKickoff` 輸出受機器 timezone 影響，測試冇斷言具體時間字串係特意的 — 唔好加。

- [ ] **Step 6: Commit**

```bash
git add src/pages/MatchAnalysisPage.tsx src/pages/MatchAnalysisPage.test.tsx src/styles/match.css
git commit -m "feat: MatchAnalysisPage with picker and not-found states"
```

---

