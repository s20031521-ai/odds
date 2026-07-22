import type { CurrentRecommendationsResponse } from "./apiClient";

export const CURRENT_RECOMMENDATIONS_REFRESH_MS = 3 * 60 * 1000;

type CurrentRecommendationsRefreshOptions = {
  load: () => Promise<CurrentRecommendationsResponse>;
  onSuccess: (response: CurrentRecommendationsResponse) => void;
  onError: (error: unknown) => void;
};

export function startCurrentRecommendationsRefresh({
  load,
  onSuccess,
  onError,
}: CurrentRecommendationsRefreshOptions): () => void {
  let active = true;
  let inFlight = false;

  const refresh = async () => {
    if (!active || inFlight) return;
    inFlight = true;
    try {
      const response = await load();
      if (active) onSuccess(response);
    } catch (error) {
      if (active) onError(error);
    } finally {
      inFlight = false;
    }
  };

  void refresh();
  const timer = globalThis.setInterval(() => void refresh(), CURRENT_RECOMMENDATIONS_REFRESH_MS);

  return () => {
    active = false;
    globalThis.clearInterval(timer);
  };
}
