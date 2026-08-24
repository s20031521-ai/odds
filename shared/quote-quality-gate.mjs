// Phase 3 quote quality gate (docs/research/PHASE-3-quote-quality-gate-
// 2026-08-24.md). Model-independent filter that runs AFTER a strategy has
// produced candidate quotes. It currently runs only on gated shadow twins;
// live buyable recommendations are unchanged until forward validation passes.
//
//   Phase 1/2/任何模型 → gated/ungated 影子 A/B → forward validation
//
// 紅線:唔郁任何模型數學,唔郁 3% 下限。每個被剔除嘅報價都帶穩定原因碼
// (GATE_REASONS),方便審計「閘門擋咗咩」。
//
// 兩邊設計:
//   共識側 — 「真相」只由 CONSENSUS_ALLOWLIST 嘅莊家定義,軟莊家嘅錯價
//            唔會污染參考價。
//   買入側 — 五個檢查(賠率上限 / edge 上限 / 偏離 sharp 共識 / 相對
//            新鮮度 / 盤口單調),只擋明顯錯價,唔擋合理偏離。
//
// Pure module: no I/O, no clock access — observedAt strings are compared
// numerically, callers supply everything.

import { canonicalBookmaker, isValidDecimalOdds } from "./unified-recommendations.mjs";
import { powerNoVigTwoWayOdds, shinNoVigThreeWay } from "./devig.mjs";
import {
  CONSENSUS_ALLOWLIST,
  GATE_REASONS,
  QUOTE_GATE_CONFIG,
  QUOTE_GATE_CONFIG_VERSION,
} from "./quote-gate-config.mjs";

const TWO_WAY_SELECTIONS = {
  handicap: ["home", "away"],
  totals: ["over", "under"],
  corners: ["over", "under"],
};
const H2H_SELECTIONS = ["home", "draw", "away"];

// 隱含概率應該點樣隨盤口變:+1 = 盤口越大概率越高,-1 = 盤口越大概率越低。
//   over:              盤口↑ → 大越難 → p↓
//   under:             盤口↑ → 細越易 → p↑
//   handicap home:     盤口↑(讓得更少/受讓更多)→ 主隊越容易過 → p↑
//   handicap away:     盤口↑ → 客隊越難 → p↓
const PROB_DIRECTION = {
  totals: { over: -1, under: 1 },
  corners: { over: -1, under: 1 },
  handicap: { home: 1, away: -1 },
};

/**
 * Gates one opportunity's quotes. `opportunity` is the unified opportunity
 * shape ({ market, selection, line?, quotes: [...] }); `contextRows` are the
 * fresh deduped input rows for the same fixture + market (ALL lines, so the
 * monotonicity check can compare across lines and the consensus can price the
 * quote's own line).
 *
 * Returns { quotes, rejected } where `quotes` is the surviving subset (same
 * order as input) and `rejected` is [{ quote, reasons }] — reasons are stable
 * GATE_REASONS codes. A quote can violate several checks at once; all of them
 * are recorded.
 */
export function gateOpportunityQuotes(opportunity, contextRows, config = QUOTE_GATE_CONFIG) {
  const quotes = Array.isArray(opportunity?.quotes) ? opportunity.quotes : [];
  if (quotes.length === 0) return { quotes: [], rejected: [] };
  const market = opportunity.market;
  const selection = opportunity.selection;
  const line = Number.isFinite(opportunity.line) ? opportunity.line : undefined;

  const rows = (Array.isArray(contextRows) ? contextRows : []).filter((row) =>
    row && row.market === market && isValidDecimalOdds(row.odds)
    && (market === "h2h" || Number.isFinite(row.line)));

  const sameLineRows = market === "h2h" ? rows : rows.filter((row) => row.line === line);
  const consensus = sharpConsensus(sameLineRows, market, config);
  const freshestMs = maxObservedMs(sameLineRows);

  const passed = [];
  const rejected = [];
  for (const quote of quotes) {
    const reasons = quoteRejectionReasons(quote, {
      market, selection, line, rows, consensus, freshestMs, config,
    });
    if (reasons.length === 0) passed.push(quote);
    else rejected.push({ quote, reasons });
  }
  return { quotes: passed, rejected };
}

function quoteRejectionReasons(quote, { market, selection, line, rows, consensus, freshestMs, config }) {
  const reasons = [];
  if (!isValidDecimalOdds(quote?.odds)) return [GATE_REASONS.oddsCap];

  const cap = config.maxOdds?.[market];
  if (Number.isFinite(cap) && quote.odds > cap) reasons.push(GATE_REASONS.oddsCap);

  // maxEdge 支援全局數字或每玩法 object；預先登記配置暫時同一上限，
  // replay grid 只會 counterfactually 改角球值。
  const edgeCap = typeof config.maxEdge === "object" && config.maxEdge !== null
    ? config.maxEdge?.[market]
    : config.maxEdge;
  if (Number.isFinite(edgeCap)
      && Number.isFinite(quote.edge)
      && quote.edge > edgeCap) {
    reasons.push(GATE_REASONS.edgeCap);
  }

  // 偏離檢查:quote 對住 allowlist 共識都仲係「超大 edge」→ 錯價。
  // 共識唔成立(唔夠莊家)就 fail-open,唔擋。
  if (consensus && Number.isFinite(config.maxSharpEdge)) {
    const sharpChance = consensus.chanceFor(selection);
    if (Number.isFinite(sharpChance) && quote.odds * sharpChance - 1 > config.maxSharpEdge) {
      reasons.push(GATE_REASONS.sharpDeviation);
    }
  }

  if (Number.isFinite(config.maxRelativeStalenessMs) && freshestMs !== null) {
    const observedMs = Date.parse(quote.observedAt ?? "");
    if (Number.isFinite(observedMs) && freshestMs - observedMs > config.maxRelativeStalenessMs) {
      reasons.push(GATE_REASONS.relativeStale);
    }
  }

  if (config.enforceLineMonotonicity !== false
      && market !== "h2h"
      && Number.isFinite(line)
      && breaksLineMonotonicity(quote, market, selection, line, rows)) {
    reasons.push(GATE_REASONS.nonMonotonic);
  }

  return reasons;
}

// ---------- 共識側 ----------

/**
 * Sharp consensus for one (fixture, market, line) group, built ONLY from
 * CONSENSUS_ALLOWLIST books with complete selections. h2h uses Shin de-vig;
 * two-way markets use power de-vig. Equal weights inside the allowlist — the
 * allowlist itself is the filter. Returns { bookCount, chanceFor(selection) }
 * or null when fewer than minConsensusBooks allowlisted books are complete.
 */
export function sharpConsensus(rows, market, config = QUOTE_GATE_CONFIG) {
  const selections = market === "h2h" ? H2H_SELECTIONS : TWO_WAY_SELECTIONS[market];
  if (!selections) return null;

  const byBook = new Map();
  for (const row of rows ?? []) {
    const key = canonicalBookmaker(row?.bookmaker);
    if (!key || !CONSENSUS_ALLOWLIST.has(key)) continue;
    byBook.set(key, [...(byBook.get(key) ?? []), row]);
  }

  const fairs = [];
  for (const bookRows of byBook.values()) {
    const bySelection = Object.fromEntries(bookRows.map((row) => [row.selection, row]));
    if (!selections.every((selection) => isValidDecimalOdds(bySelection[selection]?.odds))) continue;
    const fair = market === "h2h"
      ? shinNoVigThreeWay([bySelection.home.odds, bySelection.draw.odds, bySelection.away.odds])
      : powerNoVigTwoWayOdds(bySelection[selections[0]].odds, bySelection[selections[1]].odds);
    if (fair) fairs.push(fair);
  }
  if (fairs.length < (config.minConsensusBooks ?? 1)) return null;

  const average = selections.map((_, index) =>
    fairs.reduce((sum, fair) => sum + fair[index], 0) / fairs.length);
  return {
    bookCount: fairs.length,
    chanceFor(selection) {
      const index = selections.indexOf(selection);
      return index === -1 ? null : average[index];
    },
  };
}

// ---------- 盤口單調 ----------

// 同一莊家同一玩法唔同盤口嘅隱含概率要單調。喺一對違反嘅報價入面,
// 「太慷慨」(賠率偏高 = 隱含概率偏低)嗰個先係錯價陷阱,所以只剔除
// 違反對入面賠率較高嘅一邊。
function breaksLineMonotonicity(quote, market, selection, line, rows) {
  const direction = PROB_DIRECTION[market]?.[selection];
  if (!direction) return false;
  const bookKey = canonicalBookmaker(quote.bookmaker);
  if (!bookKey) return false;
  const p = 1 / quote.odds;
  for (const row of rows) {
    if (row.selection !== selection) continue;
    if (canonicalBookmaker(row.bookmaker) !== bookKey) continue;
    if (!Number.isFinite(row.line) || row.line === line) continue;
    const p2 = 1 / row.odds;
    const lineDelta = row.line - line;
    // 預期:(p2 - p) * direction * sign(lineDelta) >= 0
    const violation = (p2 - p) * direction * Math.sign(lineDelta) < 0;
    if (violation && quote.odds > row.odds) return true;
  }
  return false;
}

function maxObservedMs(rows) {
  let max = null;
  for (const row of rows ?? []) {
    const ms = Date.parse(row?.observedAt ?? "");
    if (Number.isFinite(ms) && (max === null || ms > max)) max = ms;
  }
  return max;
}

// ---------- 影子 A/B 接線 ----------

// Gated shadow lines carry the ungated strategyVersion with this suffix; the
// suffix keeps sample identities disjoint (strategyVersion is part of the
// identity) so both lines collect evidence from the same evaluations.
export const GATED_STRATEGY_SUFFIX = "-gated";

export function gatedStrategyVersion(strategyVersion) {
  return typeof strategyVersion === "string" && strategyVersion.length > 0
    ? `${strategyVersion}${GATED_STRATEGY_SUFFIX}`
    : strategyVersion;
}

export function isGatedStrategyVersion(strategyVersion) {
  return typeof strategyVersion === "string" && strategyVersion.endsWith(GATED_STRATEGY_SUFFIX);
}

/**
 * Builds the gated twin of one shadow opportunity: same identity except the
 * strategyVersion suffix, quotes filtered through the gate, and an audit
 * summary attached. Empty shells stay empty (the gated line must observe the
 * market drying up exactly like the ungated one).
 */
export function buildGatedOpportunity(opportunity, contextRows, config = QUOTE_GATE_CONFIG) {
  const { quotes, rejected } = gateOpportunityQuotes(opportunity, contextRows, config);
  const reasonCounts = {};
  for (const { reasons } of rejected) {
    for (const reason of reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  }
  return {
    ...opportunity,
    strategyVersion: gatedStrategyVersion(opportunity.strategyVersion),
    quotes,
    quoteGate: {
      version: QUOTE_GATE_CONFIG_VERSION,
      rejectedQuotes: rejected.length,
      reasons: reasonCounts,
    },
  };
}

// Rows relevant to one opportunity: same fixture + market, every line.
export function gateContextRows(inputs, opportunity) {
  return (Array.isArray(inputs) ? inputs : []).filter((row) =>
    row && row.fixtureId === opportunity?.fixtureId && row.market === opportunity?.market);
}
