import { describe, expect, it } from "vitest";
import { asianTotalMetrics, settleAsianTotal } from "./asianTotals";
import type { AnalyzerSettings } from "./odds";

const settings: AnalyzerSettings = {
  bankroll: 1000,
  fractionalKelly: 0.25,
  stakeCapPercent: 0.02,
  edgeThreshold: 0.03,
};

describe("Asian totals", () => {
  it("splits quarter lines into adjacent half-lines", () => {
    expect(settleAsianTotal("大", 2.25, 3)).toBe("win");
    expect(settleAsianTotal("大", 2.25, 2)).toBe("half-loss");
    expect(settleAsianTotal("細", 2.75, 2)).toBe("win");
    expect(settleAsianTotal("細", 2.75, 3)).toBe("half-loss");
  });

  it("includes pushes and half outcomes in edge and fair odds", () => {
    const whole = asianTotalMetrics(2, 2, "細", 2, settings);
    const quarter = asianTotalMetrics(2, 2.25, "細", 2, settings);

    expect(whole.edge).toBeCloseTo(0.0827, 4);
    expect(quarter.edge).toBeCloseTo(0.2180, 4);
    expect(quarter.fairOdds).toBeCloseTo(1.5973, 4);
    expect(quarter.stake).toBeGreaterThan(0);
  });
});
