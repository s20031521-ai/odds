// Canonical identities for active shadow experiments. Algorithm changes must
// create new identities so pre/post-change evidence never shares a bucket.

export const DC_SHADOW_STRATEGY_VERSION = "dc-shadow-v2";
export const DC_MODEL_VERSION = "dc-goals-v2";
export const DC_BLEND_STRATEGY_VERSION = "dc-blend-v2";
export const DC_BLEND_MODEL_VERSION = "dc-blend-v2";
export const DC_XG_STRATEGY_VERSION = "dc-xg-shadow-v2";
export const DC_XG_MODEL_VERSION = "dc-xg-v2";
export const SHARP_STRATEGY_VERSION = "market-sharp-v1";

export const SHADOW_STRATEGY_VERSIONS = Object.freeze([
  DC_SHADOW_STRATEGY_VERSION,
  DC_BLEND_STRATEGY_VERSION,
  SHARP_STRATEGY_VERSION,
  DC_XG_STRATEGY_VERSION,
]);

export const LEGACY_SHADOW_STRATEGY_VERSIONS = Object.freeze([
  "dc-shadow-v1",
  "dc-blend-v1",
  "dc-xg-shadow-v1",
]);

export const ALL_SHADOW_STRATEGY_VERSIONS = Object.freeze([
  ...SHADOW_STRATEGY_VERSIONS,
  ...LEGACY_SHADOW_STRATEGY_VERSIONS,
]);

export const DC_FAMILY_STRATEGY_VERSIONS = Object.freeze([
  DC_SHADOW_STRATEGY_VERSION,
  DC_BLEND_STRATEGY_VERSION,
  DC_XG_STRATEGY_VERSION,
]);
