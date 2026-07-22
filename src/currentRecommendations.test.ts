import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentRecommendationsResponse } from "./apiClient";
import { CURRENT_RECOMMENDATIONS_REFRESH_MS, startCurrentRecommendationsRefresh } from "./currentRecommendations";
import { recordedOpportunity } from "./testFixtures/recordedOpportunity";

const populated: CurrentRecommendationsResponse = {
  generatedAt: "2026-07-22T10:00:00.000Z",
  strategyVersion: "unified-buyable-v1",
  opportunities: [recordedOpportunity],
};

const empty: CurrentRecommendationsResponse = {
  generatedAt: "2026-07-22T10:03:00.000Z",
  strategyVersion: "unified-buyable-v1",
  opportunities: [],
};

afterEach(() => {
  vi.useRealTimers();
});

describe("startCurrentRecommendationsRefresh", () => {
  it("loads immediately and publishes an empty server response on the next three-minute refresh", async () => {
    vi.useFakeTimers();
    const load = vi.fn()
      .mockResolvedValueOnce(populated)
      .mockResolvedValueOnce(empty);
    const onSuccess = vi.fn();

    const stop = startCurrentRecommendationsRefresh({ load, onSuccess, onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);

    expect(onSuccess).toHaveBeenLastCalledWith(populated);

    await vi.advanceTimersByTimeAsync(CURRENT_RECOMMENDATIONS_REFRESH_MS);

    expect(load).toHaveBeenCalledTimes(2);
    expect(onSuccess).toHaveBeenLastCalledWith(empty);
    stop();
  });

  it("reports refresh errors so the caller can fail closed, then keeps polling", async () => {
    vi.useFakeTimers();
    const refreshError = new Error("offline");
    const load = vi.fn()
      .mockResolvedValueOnce(populated)
      .mockRejectedValueOnce(refreshError)
      .mockResolvedValueOnce(empty);
    const onSuccess = vi.fn();
    const onError = vi.fn();

    const stop = startCurrentRecommendationsRefresh({ load, onSuccess, onError });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(CURRENT_RECOMMENDATIONS_REFRESH_MS);

    expect(onError).toHaveBeenCalledWith(refreshError);

    await vi.advanceTimersByTimeAsync(CURRENT_RECOMMENDATIONS_REFRESH_MS);

    expect(onSuccess).toHaveBeenLastCalledWith(empty);
    expect(load).toHaveBeenCalledTimes(3);
    stop();
  });
});
