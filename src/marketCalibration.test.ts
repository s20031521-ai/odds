import { describe, expect, it } from "vitest";
import { calibratedProbability, marketProbability } from "./marketCalibration";

describe("market probability", () => {
  it("removes two-way overround without model inputs", () => {
    expect(marketProbability(1.8, 2.1)).toBeCloseTo(0.5385, 4);
    expect(marketProbability(1.8, 2.1) + marketProbability(2.1, 1.8)).toBeCloseTo(1);
  });
});

describe("calibratedProbability", () => {
  it("shrinks model probability toward bookmaker market probability", () => {
    const calibrated = calibratedProbability(0.9, 1.75, 1.95, 0.5);
    expect(calibrated).toBeGreaterThan(0.7);
    expect(calibrated).toBeLessThan(0.9);
  });

  it("falls back to market probability for invalid model output", () => {
    expect(calibratedProbability(Number.NaN, 2, 2, 0.5)).toBeCloseTo(0.5);
  });
});
