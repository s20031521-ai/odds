// Phase 3 quote quality gate — parameter table.
// (docs/research/PHASE-3-quote-quality-gate-2026-08-24.md §2, §5 step 5)
//
// Every parameter change MUST land as its own commit so the audit trail shows
// who moved which knob and why. The replay harness
// (scripts/replay-quote-gate.mjs) and the shadow A/B lines (*-gated strategy
// versions) read this file; nothing here alters model math or the frozen 3%
// edge floor — the gate is a filter layer in front of recommendations only.

// Pre-registered shadow configuration. Replay candidates must never replace
// this runtime A/B configuration until an independent forward window passes.
export const QUOTE_GATE_CONFIG_VERSION = "quote-gate-v1-shadow";

// ---------- 共識側:邊啲莊家有資格定義「真相」 ----------

// Canonical (canonicalBookmaker-normalized) names allowed into the gate's
// sharp consensus. Deliberately tighter than market-sharp's weighted map:
// books known for stale/wrong prices (superbet, 1xbet, US soft books) and the
// buy target itself (hkjc) never define truth. Unknown books are excluded.
export const CONSENSUS_ALLOWLIST = new Set([
  "pinnacle",
  "marathonbet",
  "betfair",
  "matchbook",
  "bet365",
  "williamhill",
  "unibet",
  "betsson",
  "betway",
]);

// ---------- 買入側:邊啲報價有資格成為推薦 ----------

export const QUOTE_GATE_CONFIG = {
  // 賠率上限 — 死因:「10 倍以上 34 注全軍覆沒」。
  // 每玩法一個 cap;超過即視為錯價,唔出推薦。
  // Phase 3 §2 pre-registered conservative starting point. The 200-row
  // retrospective replay is diagnostic only; it cannot tune this live A/B.
  maxOdds: {
    h2h: 8.0,
    handicap: 8.0,
    totals: 8.0,
    corners: 6.0,
  },

  // Edge 上限 — 死因:「edge 20% 以上 20 注全軍覆沒」。
  // 同 3% 下限對稱;超過即視為錯價唔係價值。
  // Keep one pre-registered cap across markets until forward A/B evidence
  // supports a market-specific revision.
  maxEdge: {
    h2h: 0.15,
    handicap: 0.15,
    totals: 0.15,
    corners: 0.15,
  },

  // 偏離檢查 — 報價對住 sharp 共識(allowlist)嘅 implied edge 超過呢個 band
  // → 嗰個莊家錯,唔係市場錯。同 maxEdge 獨立:model chance 可以俾軟莊家
  // 抬高,sharp 共識唔會。
  maxSharpEdge: 0.15,

  // 共識最少要有幾多間 allowlist 莊家齊盤先成立。唔夠 → 偏離檢查 skip
  // (fail-open),其餘檢查照做。
  minConsensusBooks: 2,

  // 新鮮度相對檢查 — 報價 observedAt 舊過同場同盤口最快嗰間超過呢個時長
  // → 過期報價,剔除。(Betfair exchange 掛單價嘅主要防線。)
  maxRelativeStalenessMs: 15 * 60_000,

  // 盤口一致性 — 同一莊家同一玩法唔同盤口嘅價錢要單調(例如角球 over 價
  // 要隨盤口上升)。違反且本報價係「太慷慨」嗰邊 → 錯盤/過期盤,剔除。
  enforceLineMonotonicity: true,
};

// Reason codes emitted by the gate; stable strings for audit queries.
export const GATE_REASONS = {
  oddsCap: "odds-cap-exceeded",
  edgeCap: "edge-cap-exceeded",
  sharpDeviation: "deviates-sharp-consensus",
  relativeStale: "stale-vs-peers",
  nonMonotonic: "non-monotonic-line",
};
