// Server-side model trust policy (MODEL-VALIDITY-IMPLEMENTATION-REPORT
// 2026-08-23, Workstream A). Keyed by strategyVersion + market +
// modelVersion. States:
//
//   active     — eligible to surface buyable recommendations
//   shadow     — evidence collection only; never surfaced as buyable
//   suspended  — was active, gated off after failing real-performance checks
//
// Suspended models keep writing observations and settling (research evidence)
// but MUST NOT appear in current buyable recommendations. Model math,
// thresholds, and historical snapshots are untouched (ADR 0003 / invariants).

import { isGatedStrategyVersion } from "../../shared/quote-quality-gate.mjs";

export const TRUST_ACTIVE = "active";
export const TRUST_SHADOW = "shadow";
export const TRUST_SUSPENDED = "suspended";

const UNIFIED_STRATEGY_VERSION = "unified-buyable-v1";

// Shadow experiment strategies (ADR 0003): same set as backtest.mjs.
const SHADOW_STRATEGY_VERSIONS = new Set([
  "dc-shadow-v1",
  "dc-blend-v1",
  "market-sharp-v1",
  "dc-xg-shadow-v1",
]);

// Explicit suspensions, approved per the 2026-08-23 validity report:
// corner-loo-v1 passed the 30-match sample gate but realized ≈ -41.7% ROI
// over 33 independent fixtures / 164 recommendations, with worse results at
// higher reported edges (edge has no ranking power).
const SUSPENSIONS = [
  {
    strategyVersion: UNIFIED_STRATEGY_VERSION,
    market: "corners",
    modelVersion: "corner-loo-v1",
    reason: "negative-realized-roi",
    message: "已暫停：實際 ROI 顯著低於 0（仍繼續收集影子證據）",
  },
];

export function modelTrust({ strategyVersion, market, modelVersion } = {}) {
  const suspension = SUSPENSIONS.find((entry) =>
    entry.strategyVersion === strategyVersion
    && entry.market === market
    && entry.modelVersion === modelVersion);
  if (suspension) {
    return { status: TRUST_SUSPENDED, reason: suspension.reason, message: suspension.message };
  }
  if (SHADOW_STRATEGY_VERSIONS.has(strategyVersion)) {
    return { status: TRUST_SHADOW, reason: "shadow-strategy", message: "影子模式：只收集證據" };
  }
  // Phase 3 gated shadow A/B twins: evidence-only by construction.
  if (isGatedStrategyVersion(strategyVersion)) {
    return { status: TRUST_SHADOW, reason: "shadow-gated-strategy", message: "影子模式（報價閘門 A/B）：只收集證據" };
  }
  if (strategyVersion === UNIFIED_STRATEGY_VERSION) {
    return { status: TRUST_ACTIVE, reason: null, message: null };
  }
  // Fail closed: unknown strategy versions never surface as buyable.
  return { status: TRUST_SHADOW, reason: "unknown-strategy", message: "未列名策略：只收集證據" };
}

/** Suspended models for a strategy version, for API/UI messaging. */
export function listSuspensions(strategyVersion = UNIFIED_STRATEGY_VERSION) {
  return SUSPENSIONS.filter((entry) => entry.strategyVersion === strategyVersion)
    .map((entry) => ({
      strategyVersion: entry.strategyVersion,
      market: entry.market,
      modelVersion: entry.modelVersion,
      status: TRUST_SUSPENDED,
      reason: entry.reason,
      message: entry.message,
    }));
}

/** True when an opportunity row may surface as a current buyable pick. */
export function isBuyableTrust(row) {
  return modelTrust({
    strategyVersion: row?.strategyVersion,
    market: row?.market,
    modelVersion: row?.modelVersion,
  }).status === TRUST_ACTIVE;
}
