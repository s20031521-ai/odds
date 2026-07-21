import { describe, expect, it } from "vitest";
import { fixtureIdFromHash, pageFromHash } from "./route";
import * as routeModule from "./route";

describe("hash route", () => {
  it("resolves fixtures and all legacy top-level routes", () => {
    expect(pageFromHash("")).toBe("today");
    expect(pageFromHash("#/today")).toBe("today");
    expect(pageFromHash("#/dashboard")).toBe("today"); // legacy alias
    expect(pageFromHash("#/fixtures")).toBe("fixtures");
    expect(pageFromHash("#/analysis")).toBe("analysis");
    expect(pageFromHash("#analysis")).toBe("analysis");
    expect(pageFromHash("#/history")).toBe("history");
    expect(pageFromHash("#/nope")).toBe("today");
    expect(pageFromHash("#/fixtures-old")).toBe("today");
  });

  it("extracts fixture id from dashboard detail hash", () => {
    expect(fixtureIdFromHash("#/dashboard/game%201")).toBe("game 1");
    expect(fixtureIdFromHash("#/fixtures/game%202")).toBe("game 2");
    expect(fixtureIdFromHash("#/dashboard")).toBeNull();
    expect(fixtureIdFromHash("#/analysis")).toBeNull();
  });

  it("opens fixtures detail and legacy dashboard detail under the fixtures page", () => {
    expect(pageFromHash("#/fixtures/game-1")).toBe("fixtures");
    expect(pageFromHash("#/dashboard/game-1")).toBe("fixtures");
    expect(pageFromHash("#/dashboard")).toBe("today");
  });

  it("forces the H2H tab only when a fixture detail route is entered", () => {
    const tabForRouteTransition = (routeModule as {
      tabForRouteTransition?: (current: "h2h" | "totals" | "corners" | "handicap", hash: string) => "h2h" | "totals" | "corners" | "handicap";
    }).tabForRouteTransition;

    expect(tabForRouteTransition).toBeTypeOf("function");
    if (!tabForRouteTransition) return;
    expect(tabForRouteTransition("totals", "#/fixtures/game-1")).toBe("h2h");
    expect(tabForRouteTransition("corners", "#/dashboard/game-1")).toBe("h2h");
    expect(tabForRouteTransition("handicap", "#/fixtures")).toBe("handicap");
    expect(tabForRouteTransition("totals", "#/analysis")).toBe("totals");
  });
});
