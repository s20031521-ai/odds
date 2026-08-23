// Per-model validity metrics (MODEL-VALIDITY-IMPLEMENTATION-REPORT
// 2026-08-23, Workstream C). Answers "呢個 AI 值唔值得信" with:
// independent settled matches vs recommendation units, actual vs breakeven
// hit rate, ROI with a cluster-bootstrap 95% interval (fixtures are the
// independent unit — 164 recommendations from 33 fixtures are NOT 164
// independent samples), predicted-vs-actual calibration, and edge-bucket
// monotonicity. All functions are pure and deterministic.

export const READINESS_SAMPLE_TARGET = 30;

const EDGE_BUCKETS = [
  { label: "3–5%", min: 0.03, max: 0.05 },
  { label: "5–10%", min: 0.05, max: 0.10 },
  { label: "10–20%", min: 0.10, max: 0.20 },
  { label: "20%+", min: 0.20, max: Number.POSITIVE_INFINITY },
];

const DECIDED = new Set(["win", "half-win", "loss", "half-loss"]);

/** Conservative per-row unit profit; null when the row has no usable price. */
export function rowUnitProfit(row) {
  if (Number.isFinite(row?.unitProfitRange?.lower)) return row.unitProfitRange.lower;
  if (!Number.isFinite(row?.odds) || row.odds <= 1) return null;
  switch (row?.settlement) {
    case "win": return row.odds - 1;
    case "half-win": return (row.odds - 1) / 2;
    case "half-loss": return -0.5;
    case "loss": return -1;
    case "push": return 0;
    default: return null;
  }
}

function rowClusterKey(row) {
  return String(row?.fixtureId ?? row?.matchId ?? row?.id ?? "");
}

/** Deterministic mulberry32 PRNG so tests and reports reproduce exactly. */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Cluster bootstrap of mean unit ROI: resample fixtures (clusters) with
 * replacement, keeping every recommendation inside a chosen fixture. Returns
 * the 95% percentile interval; null when there is nothing priced.
 */
export function clusterBootstrapRoi(rows, { resamples = 1000, seed = 0xC0FFEE } = {}) {
  const priced = rows
    .map((row) => ({ cluster: rowClusterKey(row), profit: rowUnitProfit(row) }))
    .filter((row) => row.profit !== null && row.cluster);
  if (priced.length === 0) return null;
  const clusters = [...Map.groupBy(priced, (row) => row.cluster).values()]
    .map((group) => group.reduce((sum, row) => sum + row.profit, 0) / group.length);
  const random = mulberry32(seed);
  const means = [];
  for (let round = 0; round < resamples; round += 1) {
    let total = 0;
    for (let index = 0; index < clusters.length; index += 1) {
      total += clusters[Math.floor(random() * clusters.length)];
    }
    means.push(total / clusters.length);
  }
  means.sort((left, right) => left - right);
  return {
    resamples,
    clusters: clusters.length,
    lower: means[Math.floor(0.025 * (means.length - 1))],
    upper: means[Math.floor(0.975 * (means.length - 1))],
  };
}

/** Full validity card for one market + modelVersion + strategyVersion. */
export function performanceForRows(rows) {
  const settled = rows.filter((row) => DECIDED.has(row?.settlement) || row?.settlement === "push");
  const decided = settled.filter((row) => DECIDED.has(row.settlement));
  const hits = decided.filter((row) => row.settlement === "win" || row.settlement === "half-win").length;
  const hitRate = decided.length ? hits / decided.length : null;
  const priced = settled.map((row) => ({ row, profit: rowUnitProfit(row) })).filter(({ profit }) => profit !== null);
  const roi = priced.length ? priced.reduce((sum, { profit }) => sum + profit, 0) / priced.length : null;
  const chances = settled.map((row) => row?.chance).filter(Number.isFinite);
  const predicted = chances.length ? chances.reduce((sum, value) => sum + value, 0) / chances.length : null;
  const breakevenOdds = settled.map((row) => row?.odds).filter((odds) => Number.isFinite(odds) && odds > 1);
  const breakevenRate = breakevenOdds.length
    ? breakevenOdds.reduce((sum, odds) => sum + 1 / odds, 0) / breakevenOdds.length
    : null;
  const edgeBuckets = EDGE_BUCKETS.map(({ label, min, max }) => {
    const bucketRows = settled.filter((row) => Number.isFinite(row?.edge) && row.edge >= min && row.edge < max);
    const bucketPriced = bucketRows.map((row) => rowUnitProfit(row)).filter((profit) => profit !== null);
    const bucketDecided = bucketRows.filter((row) => DECIDED.has(row.settlement));
    const bucketHits = bucketDecided.filter((row) => row.settlement === "win" || row.settlement === "half-win").length;
    return {
      bucket: label,
      recommendations: bucketRows.length,
      hitRate: bucketDecided.length ? bucketHits / bucketDecided.length : null,
      roi: bucketPriced.length ? bucketPriced.reduce((sum, profit) => sum + profit, 0) / bucketPriced.length : null,
    };
  });
  const nonEmptyBuckets = edgeBuckets.filter((bucket) => bucket.recommendations > 0 && bucket.roi !== null);
  const edgeMonotonic = nonEmptyBuckets.length < 2
    ? null
    : nonEmptyBuckets.every((bucket, index) => index === 0 || bucket.roi >= nonEmptyBuckets[index - 1].roi - 1e-9);
  return {
    recommendations: settled.length,
    independentMatches: new Set(settled.map(rowClusterKey).filter(Boolean)).size,
    hitRate,
    breakevenRate,
    roi,
    roiBootstrap: clusterBootstrapRoi(settled),
    calibration: {
      predicted,
      actual: hitRate,
      bias: predicted !== null && hitRate !== null ? predicted - hitRate : null,
    },
    edgeBuckets,
    edgeMonotonic,
  };
}

/**
 * Two-stage readiness verdict (report §5 Workstream C):
 *   suspended          — trust-gated off after failing real performance
 *   collecting         — fewer than READINESS_SAMPLE_TARGET settled matches
 *   sample-ready       — sample gate passed; performance still unproven
 *   performance-trusted — sample gate AND pre-registered performance rules
 *
 * Performance rules (registered before looking at new holdout data):
 * point ROI > 0, bootstrap interval must not be clearly negative
 * (upper bound > 0), calibration must not overestimate by > 5pp, and edge
 * buckets must not anti-correlate with outcomes.
 */
export function readinessVerdict({ trustStatus, settledMatches, performance }) {
  if (trustStatus === "suspended") return "suspended";
  const sampleReady = settledMatches >= READINESS_SAMPLE_TARGET;
  if (!sampleReady) return "collecting";
  const trusted = performance
    && performance.roi !== null
    && performance.roi > 0
    && performance.roiBootstrap !== null
    && performance.roiBootstrap.upper > 0
    && (performance.calibration.bias === null || performance.calibration.bias <= 0.05)
    && performance.edgeMonotonic !== false;
  return trusted ? "performance-trusted" : "sample-ready";
}
