import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { recordedOpportunity } from "../testFixtures/recordedOpportunity";
import type { TeamLogoMap } from "./TeamLogo";
import { formatKickoff, PickCard } from "./PickCard";

const logos: TeamLogoMap = { Arsenal: { id: 42, logo: "/team-logos/42.png" } };

describe("PickCard", () => {
  it("renders the recorded match and server price range", () => {
    const markup = renderToStaticMarkup(<PickCard opportunity={recordedOpportunity} logos={logos} />);
    expect(markup).toContain("pick-card");
    expect(markup).toContain("阿仙奴 vs 車路士");
    expect(markup).toContain("大 2.5");
    expect(markup).toContain("1.91–2.04");
    expect(markup).toContain("最低 1.84");
  });

  it("falls back to English names and encodes the analysis link", () => {
    const opportunity = { ...recordedOpportunity, matchId: "match 1", homeTeamZh: undefined, awayTeamZh: undefined };
    const markup = renderToStaticMarkup(<PickCard opportunity={opportunity} logos={logos} />);
    expect(markup).toContain("Arsenal vs Chelsea");
    expect(markup).toContain('href="#/analysis?match=match%201"');
  });
});

describe("formatKickoff", () => {
  it("formats as M月D日 HH:MM", () => {
    const input = "2026-07-21T20:00:00";
    const date = new Date(input);
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(formatKickoff(input)).toBe(`${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`);
  });

  it("returns the raw string when unparseable", () => {
    expect(formatKickoff("not-a-date")).toBe("not-a-date");
  });
});
