export const READINESS_MODELS: Array<{
  market: string;
  label: string;
  modelVersion: string;
}> = [
  { market: "totals", label: "大細波", modelVersion: "totals-loo-v1" },
  { market: "corners", label: "角球", modelVersion: "corner-loo-v1" },
  { market: "handicap", label: "讓球", modelVersion: "hdc-loo-v2" },
  { market: "h2h", label: "主客和", modelVersion: "consensus-v1" },
];
