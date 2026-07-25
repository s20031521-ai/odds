import type { MarketKey } from "./market";
import { MARKET_LABELS } from "./market";

export const READINESS_MODELS: Array<{
  market: MarketKey;
  label: string;
  modelVersion: string;
}> = [
  { market: "totals", label: MARKET_LABELS.totals, modelVersion: "totals-loo-v1" },
  { market: "corners", label: MARKET_LABELS.corners, modelVersion: "corner-loo-v1" },
  { market: "handicap", label: MARKET_LABELS.handicap, modelVersion: "hdc-loo-v2" },
  { market: "h2h", label: MARKET_LABELS.h2h, modelVersion: "consensus-v1" },
];
