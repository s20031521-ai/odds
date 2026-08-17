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

// dc-v1 影子模型（ADR 0003）：只收集證據，唔會出現喺今日推薦。
// 獨立於 READINESS_MODELS —— 雷達圖、historyStats 同詳情面板都係按 market
// 做 key，影子卡如果混入會頂撞正式模型嘅統計。
export const SHADOW_READINESS_MODELS: Array<{
  market: MarketKey;
  label: string;
  modelVersion: string;
}> = [
  { market: "h2h", label: `${MARKET_LABELS.h2h} · dc-v1 影子`, modelVersion: "dc-v1" },
  { market: "totals", label: `${MARKET_LABELS.totals} · dc-v1 影子`, modelVersion: "dc-v1" },
  { market: "handicap", label: `${MARKET_LABELS.handicap} · dc-v1 影子`, modelVersion: "dc-v1" },
  // 路線一：sharp-book 加權 + Shin/power 去水嘅共識實驗
  { market: "h2h", label: `${MARKET_LABELS.h2h} · consensus-v2 影子`, modelVersion: "consensus-v2" },
  { market: "totals", label: `${MARKET_LABELS.totals} · sharp 影子`, modelVersion: "totals-sharp-v1" },
  { market: "handicap", label: `${MARKET_LABELS.handicap} · sharp 影子`, modelVersion: "hdc-sharp-v1" },
  { market: "corners", label: `${MARKET_LABELS.corners} · sharp 影子`, modelVersion: "corner-sharp-v1" },
  // 路線二：70% 市場 + 30% dc 模型混合
  { market: "h2h", label: `${MARKET_LABELS.h2h} · dc-v2 混合影子`, modelVersion: "dc-v2" },
  { market: "totals", label: `${MARKET_LABELS.totals} · dc-v2 混合影子`, modelVersion: "dc-v2" },
  { market: "handicap", label: `${MARKET_LABELS.handicap} · dc-v2 混合影子`, modelVersion: "dc-v2" },
];
