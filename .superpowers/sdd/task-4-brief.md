### Task 4: `PickCard` 精選盤卡（`<details>` 原生展開）

**Files:**
- Create: `src/components/PickCard.tsx`
- Test: `src/components/PickCard.test.tsx`

**Interfaces:**
- Consumes: `BuyOpportunity`、`BuyPick`（`src/buyOpportunities.ts:26-37`）；`TeamLogo`、`TeamLogoMap`（`src/components/TeamLogo.tsx`）；`displayStake`（Task 3）。
- Produces:
  ```tsx
  export function PickCard(props: { opportunity: BuyOpportunity; logos: TeamLogoMap; generatedAt: string | null }): React.ReactElement
  export function formatSelection(pick: BuyPick): string   // "大 2.5" / "主隊"
  export function formatOdds(value: number): string        // "1.95" / "—"
  export function formatKickoff(value: string): string     // "7月21日 20:00"（parse 唔到回原字串）
  ```
  用原生 `<details>/<summary>` 做原地展開 — SSR 測試可以斷言 markup、Playwright 可以 click、唔使 JS state、離線 work。Task 7 `TodayPage` 用 `PickCard` + `formatKickoff`。

- [ ] **Step 1: 寫 test（RED）**

Create `src/components/PickCard.test.tsx`：

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuyOpportunity } from "../buyOpportunities";
import type { TeamLogoMap } from "./TeamLogo";
import { formatKickoff, PickCard } from "./PickCard";

const opportunity: BuyOpportunity = {
  matchId: "match-1",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  homeTeamZh: "阿仙奴",
  awayTeamZh: "車路士",
  commenceTime: "2026-07-21T20:00:00",
  league: "Premier League",
  primary: { market: "大細波", selection: "大", line: 2.5, odds: 1.95, chance: 0.58, edge: 0.131, bookmaker: "Alpha" },
  alternatives: [
    { market: "主客和", selection: "主隊", odds: 2.1, chance: 0.52, edge: 0.092, bookmaker: "Beta" },
  ],
};

const logos: TeamLogoMap = { Arsenal: { id: 42, logo: "/team-logos/42.png" } };

describe("PickCard", () => {
  it("renders collapsed three-line summary inside a details element", () => {
    const markup = renderToStaticMarkup(
      <PickCard opportunity={opportunity} logos={logos} generatedAt="2026-07-21T12:00:00Z" />,
    );
    expect(markup).toContain("<details");
    expect(markup).toContain("pick-card");
    expect(markup).toContain("阿仙奴 vs 車路士"); // zh 名優先
    expect(markup).toContain("買：大 2.5");
    expect(markup).toContain("1.95");
    expect(markup).toContain("詳情▾");
  });

  it("falls back to English names when zh missing", () => {
    const noZh: BuyOpportunity = { ...opportunity, homeTeamZh: undefined, awayTeamZh: undefined };
    const markup = renderToStaticMarkup(
      <PickCard opportunity={noZh} logos={logos} generatedAt={null} />,
    );
    expect(markup).toContain("Arsenal vs Chelsea");
  });

  it("renders expanded detail content (edge, probability comparison, stake, sync time, analysis link)", () => {
    const markup = renderToStaticMarkup(
      <PickCard opportunity={opportunity} logos={logos} generatedAt="2026-07-21T12:00:00Z" />,
    );
    expect(markup).toContain("Edge +13.1%");
    expect(markup).toContain("模型估 58.0%，莊家開 51.3%");
    expect(markup).toContain("建議注碼 $20"); // displayStake(0.58, 1.95) capped 2% of 1000
    expect(markup).toContain("賠率同步於 2026-07-21T12:00:00Z");
    expect(markup).toContain('href="#/fixtures/match-1"');
    expect(markup).toContain("睇單場分析 →");
  });

  it("lists alternative picks", () => {
    const markup = renderToStaticMarkup(
      <PickCard opportunity={opportunity} logos={logos} generatedAt={null} />,
    );
    expect(markup).toContain("未有成功同步");
    expect(markup).toContain("主隊");
    expect(markup).toContain("2.10");
    expect(markup).toContain("Beta");
  });

  it("encodes matchId in the analysis link", () => {
    const spaced: BuyOpportunity = { ...opportunity, matchId: "match 1" };
    const markup = renderToStaticMarkup(
      <PickCard opportunity={spaced} logos={logos} generatedAt={null} />,
    );
    expect(markup).toContain('href="#/fixtures/match%201"');
  });
});

describe("formatKickoff", () => {
  it("formats as M月D日 HH:MM", () => {
    const input = "2026-07-21T20:00:00";
    const date = new Date(input);
    const pad = (n: number) => String(n).padStart(2, "0");
    const expected = `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    expect(formatKickoff(input)).toBe(expected);
  });

  it("returns the raw string when unparseable", () => {
    expect(formatKickoff("not-a-date")).toBe("not-a-date");
  });
});
```

- [ ] **Step 2: 跑 test 確認 fail**

Run: `node node_modules/vitest/vitest.mjs run src/components/PickCard.test.tsx`
Expected: FAIL — module 未存在

- [ ] **Step 3: 寫 implementation（GREEN）**

Create `src/components/PickCard.tsx`：

```tsx
import type { BuyOpportunity, BuyPick } from "../buyOpportunities";
import { displayStake } from "../stakeDisplay";
import { TeamLogo, type TeamLogoMap } from "./TeamLogo";

export function PickCard(props: {
  opportunity: BuyOpportunity;
  logos: TeamLogoMap;
  generatedAt: string | null;
}): React.ReactElement {
  const { opportunity, logos } = props;
  const primary = opportunity.primary;
  const home = opportunity.homeTeamZh ?? opportunity.homeTeam;
  const away = opportunity.awayTeamZh ?? opportunity.awayTeam;
  return (
    <details className="pick-card">
      <summary className="pick-card__summary">
        <span className="pick-card__match">
          <TeamLogo teamName={opportunity.homeTeam} logos={logos} />
          {home} vs {away}
          <TeamLogo teamName={opportunity.awayTeam} logos={logos} />
          <time className="pick-card__kickoff" dateTime={opportunity.commenceTime}>
            {formatKickoff(opportunity.commenceTime)}
          </time>
        </span>
        <span className="pick-card__selection">買：{formatSelection(primary)}</span>
        <span className="pick-card__odds">{formatOdds(primary.odds)}</span>
        <span className="pick-card__toggle" aria-hidden="true">詳情▾</span>
      </summary>
      <div className="pick-card__details">
        <p>Edge +{formatPercent(primary.edge)}</p>
        <p>模型估 {formatPercent(primary.chance)}，莊家開 {formatPercent(1 / primary.odds)}</p>
        <p>建議注碼 ${displayStake(primary)}</p>
        <p>賠率同步於 {props.generatedAt ?? "未有成功同步"}</p>
        {opportunity.alternatives.length > 0 ? (
          <ul className="pick-card__alternatives">
            {opportunity.alternatives.map((pick) => (
              <li key={pickKey(pick)}>
                {formatSelection(pick)} @ {formatOdds(pick.odds)}（{pick.bookmaker}）
              </li>
            ))}
          </ul>
        ) : null}
        <a className="pick-card__analysis-link" href={`#/fixtures/${encodeURIComponent(opportunity.matchId)}`}>
          睇單場分析 →
        </a>
      </div>
    </details>
  );
}

export function formatSelection(pick: BuyPick): string {
  return pick.line === undefined ? pick.selection : `${pick.selection} ${formatLine(pick.line)}`;
}

export function formatOdds(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "—";
}

export function formatKickoff(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatLine(line: number): string {
  return Number.isInteger(line) ? line.toFixed(1) : `${line}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function pickKey(pick: BuyPick): string {
  return `${pick.market}|${pick.line ?? ""}|${pick.selection}|${pick.bookmaker}`;
}
```

注意：「模型估 58.0%」嚟自 `formatPercent(0.58)`（toFixed(1)）；「莊家開 51.3%」嚟自 `1/1.95 ≈ 0.5128`。Test 斷言已經對準呢個格式。

- [ ] **Step 4: 跑 test 確認 pass**

Run: `node node_modules/vitest/vitest.mjs run src/components/PickCard.test.tsx`
Expected: PASS（7 tests）

- [ ] **Step 5: Commit**

```bash
git add src/components/PickCard.tsx src/components/PickCard.test.tsx
git commit -m "feat: add PickCard with native details expansion"
```

---

