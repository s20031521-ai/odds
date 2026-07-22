import { describe, expect, it } from "vitest";
import { createApiClient, ApiError } from "./apiClient";
import type { PredictionSnapshot } from "./predictionSnapshots";

describe("apiClient", () => {
  it("uses relative api/v1 urls with same-origin credentials", async () => {
    const calls: RequestInit[] = [];
    const paths: string[] = [];
    const client = createApiClient(async (input, init) => {
      paths.push(String(input));
      calls.push(init ?? {});
      return jsonResponse({ authenticated: true, csrfToken: "csrf", session: { username: "owner" } });
    });

    await client.session();
    await client.login("Owner", "correct horse battery staple");
    await client.liveOdds();
    await client.results();
    await client.currentRecommendations();
    await client.predictionObservations(42);
    await client.backtest();
    await client.logout("csrf");
    await client.savePredictions("csrf", [snapshot()]);

    expect(paths).toEqual([
      "/api/v1/session",
      "/api/v1/auth/login",
      "/api/v1/odds/live",
      "/api/v1/results",
      "/api/v1/recommendations/current",
      "/api/v1/predictions/observations?sampleId=42",
      "/api/v1/backtest",
      "/api/v1/auth/logout",
      "/api/v1/predictions",
    ]);
    expect(paths.join("\n")).not.toContain("127.0.0.1");
    expect(calls.every((call) => call.credentials === "same-origin")).toBe(true);
  });

  it("sends csrf only on mutations and does not persist passwords", async () => {
    const calls: Array<{ input: string; init: RequestInit }> = [];
    const client = createApiClient(async (input, init) => {
      calls.push({ input: String(input), init: init ?? {} });
      return jsonResponse({ authenticated: true, csrfToken: "csrf", session: { username: "owner" } });
    });
    const storageWrites: string[] = [];
    const originalLocal = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { setItem: (key: string, value: string) => storageWrites.push(`${key}:${value}`), getItem: () => null },
    });
    try {
      await client.login("owner", "super secret password");
    await client.session();
    await client.liveOdds();
    await client.results();
    await client.currentRecommendations();
    await client.predictionObservations(42);
    await client.backtest();
    await client.logout("csrf-token");
    await client.savePredictions("csrf-token", [snapshot()]);
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalLocal });
    }

    expect(storageWrites.join("\n")).not.toContain("super secret password");
    expect(calls.find((call) => call.input === "/api/v1/auth/login")?.init.body).toContain("super secret password");
    expect(calls.find((call) => call.input === "/api/v1/session")?.init.headers).not.toHaveProperty("x-csrf-token");
    expect(calls.find((call) => call.input === "/api/v1/odds/live")?.init.headers).not.toHaveProperty("x-csrf-token");
    expect(calls.find((call) => call.input === "/api/v1/results")?.init.headers).not.toHaveProperty("x-csrf-token");
    expect(calls.find((call) => call.input === "/api/v1/recommendations/current")?.init.headers).not.toHaveProperty("x-csrf-token");
    expect(calls.find((call) => call.input === "/api/v1/predictions/observations?sampleId=42")?.init.headers).not.toHaveProperty("x-csrf-token");
    expect(calls.find((call) => call.input === "/api/v1/backtest")?.init.headers).not.toHaveProperty("x-csrf-token");
    expect(calls.find((call) => call.input === "/api/v1/auth/logout")?.init.headers).toHaveProperty("x-csrf-token", "csrf-token");
    expect(calls.find((call) => call.input === "/api/v1/predictions")?.init.headers).toHaveProperty("x-csrf-token", "csrf-token");
  });

  it("fails closed on non-2xx, 401, and invalid json", async () => {
    const unauthorized = createApiClient(async () => jsonResponse({ error: "unauthorized" }, 401));
    await expect(unauthorized.liveOdds()).rejects.toMatchObject({ name: "ApiError", status: 401 });
    await expect(unauthorized.liveOdds()).rejects.toBeInstanceOf(ApiError);

    const badStatus = createApiClient(async () => jsonResponse({ error: "server_error" }, 500));
    await expect(badStatus.backtest()).rejects.toMatchObject({ status: 500 });

    const badUnauthorized = createApiClient(async () => new Response("{", { status: 401 }));
    await expect(badUnauthorized.session()).rejects.toMatchObject({ status: 401 });

    const invalidJson = createApiClient(async () => new Response("{", { status: 200 }));
    await expect(invalidJson.session()).rejects.toMatchObject({ name: "ApiError", status: 0 });
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
    market: "大細波",
    prediction: "大",
    savedAt: "2026-07-18T00:00:00.000Z",
    commenceTime: "2026-07-18T10:00:00.000Z",
  };
}
