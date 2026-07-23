import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { recordedOpportunity } from "../testFixtures/recordedOpportunity";
import { BuyableOddsRange, ObservationTimeline } from "./BuyableOddsRange";

describe("BuyableOddsRange", () => {
  it("shows the recorded exact selection/line range without deriving model values", () => {
    const markup = renderToStaticMarkup(<BuyableOddsRange opportunity={recordedOpportunity} />);

    expect(markup).toContain("大 2.5");
    expect(markup).toContain("1.91–2.04");
    expect(markup).toContain("最佳 2.04");
    expect(markup).toContain("2 間莊");
    expect(markup).toContain('dateTime="2026-07-21T12:00:00.000Z"');
    expect(markup).toContain("只適用於完全相同選項及盤口（大 2.5）");
  });

  it("discloses every recorded bookmaker quote and its own server threshold", () => {
    const markup = renderToStaticMarkup(<BuyableOddsRange opportunity={recordedOpportunity} />);

    expect(markup).toContain("逐莊可買價");
    expect(markup).toContain("Alpha");
    expect(markup).toContain("HKJC");
    expect(markup).toContain("採樣 1.91");
    expect(markup).toContain("最低 1.84");
    expect(markup).toContain("Edge +6.96%");
    expect(markup).toContain('dateTime="2026-07-21T11:55:00.000Z"');
    expect(markup).toContain("Beta");
    expect(markup).toContain("The Odds API");
  });

  it("offers observation history only through an explicit disclosure", () => {
    const markup = renderToStaticMarkup(
      <BuyableOddsRange opportunity={recordedOpportunity} loadObservations={async () => ({ sampleId: 17, observations: [] })} />,
    );

    expect(markup).toContain("完整採樣時間線");
    expect(markup).toContain("recommendation-observations");
  });

  it("renders every lazy-loaded batch with its server quotes and audit inputs", () => {
    const markup = renderToStaticMarkup(<ObservationTimeline observations={[{
      id: 501,
      fingerprint: "batch-501",
      firstEvaluatedAt: "2026-07-21T11:45:00.000Z",
      lastEvaluatedAt: "2026-07-21T11:50:00.000Z",
      inputs: [{ bookmaker: "Peer A", odds: 1.8 }],
      buyableQuotes: [recordedOpportunity.quotes[0]],
    }]} />);

    expect(markup).toContain("批次 1");
    expect(markup).toContain("Alpha");
    expect(markup).toContain("最低 1.84");
    expect(markup).toContain("batch-501");
    expect(markup).toContain('&quot;bookmaker&quot;: &quot;Peer A&quot;');
  });
});
