import { describe, expect, it } from "vitest";
import {
  betMatchesDate,
  betMatchesStatus,
  betProfit,
  betRoi,
  formatBetRef,
  formatPercent,
} from "./betMetrics";

describe("betProfit", () => {
  it("win returns stake * (odds - 1)", () => {
    expect(betProfit("win", 100, 1.85)).toBeCloseTo(85);
  });
  it("half-win halves the profit", () => {
    expect(betProfit("half-win", 100, 1.85)).toBeCloseTo(42.5);
  });
  it("push returns 0", () => {
    expect(betProfit("push", 100, 1.85)).toBe(0);
  });
  it("half-loss loses half stake", () => {
    expect(betProfit("half-loss", 100, 1.85)).toBe(-50);
  });
  it("loss loses full stake", () => {
    expect(betProfit("loss", 100, 1.85)).toBe(-100);
  });
  it("pending returns null", () => {
    expect(betProfit("pending", 100, 1.85)).toBeNull();
  });
});

describe("betRoi", () => {
  it("computes profit / stake", () => {
    expect(betRoi("win", 100, 1.85)).toBeCloseTo(0.85);
    expect(betRoi("loss", 100, 1.85)).toBe(-1);
  });
});

describe("formatPercent", () => {
  it("formats with sign", () => {
    expect(formatPercent(0.85)).toBe("+85.0%");
    expect(formatPercent(-1)).toBe("-100.0%");
    expect(formatPercent(null)).toBe("--");
  });
});

describe("formatBetRef", () => {
  it("shortens and uppercases", () => {
    expect(formatBetRef("a1b2c3d4-e5f6")).toBe("#A1B2C3");
  });
});

describe("betMatchesStatus", () => {
  it("groups half settlements with their side", () => {
    expect(betMatchesStatus("half-win", "win")).toBe(true);
    expect(betMatchesStatus("half-loss", "loss")).toBe(true);
    expect(betMatchesStatus("win", "loss")).toBe(false);
    expect(betMatchesStatus("push", "push")).toBe(true);
    expect(betMatchesStatus("pending", "pending")).toBe(true);
  });
});

describe("betMatchesDate", () => {
  const now = new Date("2026-08-15T15:00:00").getTime();
  it("today matches same local day", () => {
    expect(betMatchesDate({ commence_time: "2026-08-15T09:00:00" }, "today", now)).toBe(true);
    expect(betMatchesDate({ commence_time: "2026-08-14T23:00:00" }, "today", now)).toBe(false);
  });
  it("yesterday matches previous day", () => {
    expect(betMatchesDate({ commence_time: "2026-08-14T10:00:00" }, "yesterday", now)).toBe(true);
  });
  it("week covers last 7 days", () => {
    expect(betMatchesDate({ commence_time: "2026-08-10T10:00:00" }, "week", now)).toBe(true);
    expect(betMatchesDate({ commence_time: "2026-08-01T10:00:00" }, "week", now)).toBe(false);
  });
  it("falls back to created_at when no commence_time", () => {
    expect(betMatchesDate({ commence_time: null, created_at: "2026-08-15T01:00:00" }, "today", now)).toBe(true);
  });
  it("all always matches", () => {
    expect(betMatchesDate({ commence_time: null }, "all", now)).toBe(true);
  });
});
