import { describe, expect, expectTypeOf, it } from "vitest";
import { createApiClient, ApiError } from "./apiClient";
import type { BacktestResponse, BacktestRow, BacktestSummary } from "./apiClient";
import type { PredictionSnapshot } from "./apiClient";

describe("apiClient", () => {
  it("uses relative api/v1 urls with same-origin credentials", async () => {
    const calls: RequestInit[] = [];
    const paths: string[] = [];
    const client = createApiClient(async (input, init) => {
      paths.push(String(input));
      calls.push(init ?? {});
      return jsonResponse({ ok: true });
    });

    await client.liveOdds();
    await client.results();
    await client.currentRecommendations();
    await client.predictionObservations(42);
    const backtest = await client.backtest();
    expectTypeOf(backtest).toEqualTypeOf<BacktestResponse>();
    expectTypeOf(backtest.rows).toEqualTypeOf<BacktestRow[]>();
    expectTypeOf(backtest.summary).toEqualTypeOf<BacktestSummary | undefined>();
    await client.savePredictions([snapshot()]);
    await client.bets();
    await client.createBet({ market: "h2h", selection: "home", odds: 2.1, stake: 100 });
    await client.updateBet("bet-1", { market: "h2h", selection: "home", odds: 2.1, stake: 100 });
    await client.deleteBet("bet-1");

    expect(paths).toEqual([
      "/api/v1/odds/live",
      "/api/v1/results",
      "/api/v1/recommendations/current",
      "/api/v1/predictions/observations?sampleId=42",
      "/api/v1/backtest",
      "/api/v1/predictions",
      "/api/v1/bets",
      "/api/v1/bets",
      "/api/v1/bets/bet-1",
      "/api/v1/bets/bet-1",
    ]);
    expect(paths.join("\n")).not.toContain("127.0.0.1");
    expect(calls.every((call) => call.credentials === "same-origin")).toBe(true);
  });

  it("sends no auth headers on any request (login system removed)", async () => {
    const calls: Array<{ input: string; init: RequestInit }> = [];
    const client = createApiClient(async (input, init) => {
      calls.push({ input: String(input), init: init ?? {} });
      return jsonResponse({ ok: true });
    });

    await client.liveOdds();
    await client.savePredictions([snapshot()]);
    await client.createBet({ market: "h2h", selection: "home", odds: 2.1, stake: 100 });

    for (const call of calls) {
      expect(call.init.headers ?? {}).not.toHaveProperty("x-csrf-token");
      expect(call.init.headers ?? {}).not.toHaveProperty("authorization");
    }
    expect(calls.map((c) => c.init.method)).toEqual(["GET", "POST", "POST"]);
  });

  it("fails closed on non-2xx and invalid json", async () => {
    const serverError = createApiClient(async () => jsonResponse({ error: "server_error" }, 500));
    await expect(serverError.liveOdds()).rejects.toMatchObject({ name: "ApiError", status: 500 });
    await expect(serverError.liveOdds()).rejects.toBeInstanceOf(ApiError);

    const badStatus = createApiClient(async () => jsonResponse({ error: "server_error" }, 500));
    await expect(badStatus.backtest()).rejects.toMatchObject({ status: 500 });

    const invalidJson = createApiClient(async () => new Response("{", { status: 200 }));
    await expect(invalidJson.liveOdds()).rejects.toMatchObject({ name: "ApiError", status: 0 });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function snapshot(): PredictionSnapshot {
  return {
    matchId: "m1",
    market: "totals",
    prediction: "大",
    savedAt: "2026-07-18T00:00:00.000Z",
    commenceTime: "2026-07-18T10:00:00.000Z",
  };
}
