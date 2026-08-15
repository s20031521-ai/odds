import { describe, expect, it } from "vitest";
import {
  computeDailyHitRates,
  computeOverallAccuracy,
  computeRollingDiff,
  sparklinePath,
} from "./performanceMetrics";

const rows = [
  { commenceTime: "2026-08-14T20:00:00", settlement: "win" as const },
  { commenceTime: "2026-08-14T22:00:00", settlement: "loss" as const },
  { commenceTime: "2026-08-13T20:00:00", settlement: "half-win" as const },
  { commenceTime: "2026-08-13T22:00:00", settlement: "push" as const },
];

describe("computeOverallAccuracy", () => {
  it("counts half-win as win, excludes push", () => {
    expect(computeOverallAccuracy(rows)).toBeCloseTo(66.7);
  });
  it("returns null with no decided rows", () => {
    expect(computeOverallAccuracy([{ commenceTime: "2026-08-14T20:00:00", settlement: "push" as const }])).toBeNull();
  });
});

describe("computeDailyHitRates", () => {
  it("buckets per local day, oldest first, null for empty days", () => {
    const now = new Date("2026-08-15T12:00:00").getTime();
    const rates = computeDailyHitRates(rows, 3, now);
    expect(rates).toHaveLength(3);
    expect(rates[0]).toBe(100); // 08-13: half-win counts
    expect(rates[1]).toBe(50); // 08-14: 1 win 1 loss
    expect(rates[2]).toBeNull(); // 08-15: no decided rows
  });
});

describe("computeRollingDiff", () => {
  const now = new Date("2026-08-15T12:00:00").getTime();
  it("compares last 7 days vs prior 7 days", () => {
    const data = [
      { commenceTime: "2026-08-14T20:00:00", settlement: "win" as const },
      { commenceTime: "2026-08-05T20:00:00", settlement: "loss" as const },
    ];
    expect(computeRollingDiff(data, now)).toBe(100);
  });
  it("returns null when either window is empty", () => {
    expect(computeRollingDiff(rows.slice(0, 2), now)).toBeNull();
  });
});

describe("sparklinePath", () => {
  it("returns empty string with no data", () => {
    expect(sparklinePath([null, null])).toBe("");
  });
  it("builds a path skipping null days", () => {
    const path = sparklinePath([50, null, 80], 200, 80);
    expect(path.startsWith("M")).toBe(true);
    expect(path).toContain("L");
  });
});
