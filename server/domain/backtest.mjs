import { classifySnapshot, summarizeSnapshotQuality } from "../../shared/snapshot-policy.mjs";
import { resultIdentity, snapshotIdentity } from "./identity.mjs";

const SETTLEMENT_GRACE_MS = 180 * 60_000;
const DATA_FRESH_MS = 45 * 60_000;
const UNIFIED_STRATEGY_VERSION = "unified-buyable-v1";
const PERFORMANCE_SETTLEMENTS = new Set(["win", "half-win", "push", "half-loss", "loss"]);

export function flattenLiveCache(cached) {
  const items = Object.values(cached ?? {});
  return {
    h2hEntries: items.flatMap((item) => item?.h2hEntries ?? []),
    handicapEntries: items.flatMap((item) => item?.handicapEntries ?? item?.entries ?? []),
    totalEntries: items.flatMap((item) => item?.totalEntries ?? []),
    cornerEntries: items.flatMap((item) => item?.cornerEntries ?? []),
  };
}

export function buildHealth(updatedAtBySource, now = Date.now()) {
  const sources = Object.fromEntries(["collector", "hkjc"].map((name) => {
    const updatedAt = updatedAtBySource?.[name] ?? null;
    const timestamp = Date.parse(updatedAt ?? "");
    const ageMs = Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : null;
    return [name, { updatedAt, ageMs, stale: ageMs === null || ageMs > DATA_FRESH_MS }];
  }));
  const staleSources = Object.entries(sources).filter(([, source]) => source.stale).map(([name]) => name);
  return { ok: true, dataFresh: staleSources.length === 0, checkedAt: new Date(now).toISOString(), staleSources, sources };
}

export function buildBacktest(snapshots, results, now = Date.now()) {
  const unified = snapshots.filter(isUnifiedOpportunity);
  const stored = mergeSnapshots([], snapshots.filter((item) => !isUnifiedOpportunity(item)));
  const snapshotQuality = summarizeSnapshotQuality(stored);
  const legacy = stored.filter((item) => classifySnapshot(item).status === "valid-current");
  const usable = [...unified, ...legacy];
  const rows = results.flatMap((row) => {
    const matches = snapshotsForResult(usable, row);
    if (matches.length === 0) return {
      ...row,
      prediction: "未有賽前快照",
      hit: null,
      settlement: null,
      odds: undefined,
      chance: undefined,
      modelVersion: undefined,
      firstQualifiedAt: null,
      lastQualifiedAt: null,
      observationSummary: observationSummary(),
    };
    return matches.map((snapshot) => {
      const settlement = settleResult(snapshot, row);
      if (isUnifiedOpportunity(snapshot)) return unifiedPerformanceRow(snapshot, row, settlement);
      return {
        ...row,
        id: `${row.id ?? `${row.matchId}-${row.market}`}|${snapshotIdentity(snapshot)}`,
        prediction: snapshot.prediction,
        line: snapshot.line ?? row.line,
        odds: snapshot.odds,
        chance: snapshot.chance,
        edge: snapshot.edge,
        savedAt: snapshot.savedAt,
        firstQualifiedAt: snapshot.firstQualifiedAt ?? null,
        lastQualifiedAt: snapshot.lastQualifiedAt ?? null,
        observationSummary: observationSummary(snapshot.observations),
        snapshotStatus: "valid-current",
        modelVersion: snapshot.modelVersion,
        source: snapshot.source,
        settlement,
        hit: settlementHit(settlement),
      };
    });
  });
  const allFinished = rows.filter(isPerformanceRow);
  const finished = unified.length > 0
    ? allFinished.filter((row) => row.strategyVersion === UNIFIED_STRATEGY_VERSION)
    : allFinished;
  const legacyFinished = allFinished.filter((row) => row.strategyVersion !== UNIFIED_STRATEGY_VERSION);
  const pending = [
    ...buildUnifiedPendingRows(unified, rows, results, now),
    ...buildPendingRows(legacy, legacyFinished, results, now),
  ].sort((left, right) => pendingTime(left.commenceTime) - pendingTime(right.commenceTime) || left.id.localeCompare(right.id));
  return {
    rows,
    summary: summarize(finished),
    byMarket: groupSummary(finished, (row) => row.market),
    buckets: groupSummary(finished, (row) => bucket(row.chance)),
    readiness: summarizeUnifiedReadiness(unified, rows, finished, results, now),
    pending,
    snapshotQuality,
  };
}

function unifiedPerformanceRow(snapshot, result, settlement) {
  const quotes = qualifyingQuotes(snapshot);
  const quoteRange = oddsRange(quotes);
  const bestQuote = quotes.toSorted(compareQuotes)[0];
  return {
    ...result,
    id: `${result.id ?? `${result.fixtureId ?? result.matchId}-${result.market}`}|${unifiedOpportunityIdentity(snapshot)}`,
    sampleId: snapshot.sampleId,
    fixtureId: snapshot.fixtureId,
    matchId: snapshot.matchId ?? result.matchId ?? snapshot.fixtureId,
    market: snapshot.market,
    selection: snapshot.selection,
    prediction: snapshot.selection,
    ...(Number.isFinite(snapshot.line) ? { line: snapshot.line } : {}),
    odds: bestQuote?.odds,
    chance: bestQuote?.chance,
    edge: bestQuote?.edge,
    savedAt: snapshot.firstQualifiedAt,
    firstQualifiedAt: snapshot.firstQualifiedAt ?? null,
    lastQualifiedAt: snapshot.lastQualifiedAt ?? null,
    observationSummary: observationSummary(snapshot.observations),
    snapshotStatus: "valid-current",
    modelVersion: snapshot.modelVersion,
    strategyVersion: UNIFIED_STRATEGY_VERSION,
    source: "unified-sampler",
    quoteRange,
    unitProfitRange: quoteRange && PERFORMANCE_SETTLEMENTS.has(settlement)
      ? profitRange(settlement, quotes)
      : null,
    closingBenchmark: closingBenchmark(snapshot),
    settlement,
    hit: settlementHit(settlement),
  };
}

function summarizeUnifiedReadiness(snapshots, rows, finished, results, now) {
  const terminalKeys = new Set(rows
    .filter((row) => row.strategyVersion === UNIFIED_STRATEGY_VERSION && (row.settlement === "void" || row.settlement === "unsettleable"))
    .map(fixtureMarketIdentity));
  const settledKeys = new Set(finished
    .filter((row) => row.strategyVersion === UNIFIED_STRATEGY_VERSION)
    .map(fixtureMarketIdentity));
  const eligible = snapshots.filter((item) => !terminalKeys.has(fixtureMarketIdentity(item)));
  const commenceByFixture = new Map(results
    .filter((item) => item?.fixtureId && item?.commenceTime)
    .map((item) => [item.fixtureId, item.commenceTime]));

  return [...Map.groupBy(eligible, (item) => `${item.market}|${item.modelVersion}`)].map(([key, items]) => {
    const [market, modelVersion] = key.split("|");
    const matchItems = [...Map.groupBy(items, fixtureMarketIdentity).values()].map((group) => group[0]);
    const settledMatches = matchItems.filter((item) => settledKeys.has(fixtureMarketIdentity(item))).length;
    const pendingItems = matchItems.filter((item) => !settledKeys.has(fixtureMarketIdentity(item)));
    const pendingStatus = pendingItems.reduce((status, item) => {
      const kickoff = Date.parse(item.commenceTime ?? commenceByFixture.get(item.fixtureId));
      if (!Number.isFinite(kickoff)) status.unknownPendingMatches += 1;
      else if (now < kickoff) status.upcomingMatches += 1;
      else if (now < kickoff + SETTLEMENT_GRACE_MS) status.settlingMatches += 1;
      else status.overdueMatches += 1;
      return status;
    }, { upcomingMatches: 0, settlingMatches: 0, overdueMatches: 0, unknownPendingMatches: 0 });
    const quotes = items.flatMap(qualifyingQuotes);
    const chances = quotes.map((quote) => quote.chance).filter(Number.isFinite);
    const directions = Object.fromEntries([...Map.groupBy(items, (item) => item.selection)].map(([direction, matches]) => [direction, matches.length]));
    const [dominantDirection, dominantCount] = Object.entries(directions).sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
    return {
      market,
      modelVersion,
      strategyVersion: UNIFIED_STRATEGY_VERSION,
      snapshots: items.length,
      settled: settledMatches,
      pending: matchItems.length - settledMatches,
      matches: matchItems.length,
      settledMatches,
      pendingMatches: pendingItems.length,
      upcoming: pendingStatus.upcomingMatches,
      settling: pendingStatus.settlingMatches,
      overdue: pendingStatus.overdueMatches,
      unknownPending: pendingStatus.unknownPendingMatches,
      ...pendingStatus,
      priced: items.filter((item) => qualifyingQuotes(item).length > 0).length,
      chanceCount: chances.length,
      chanceAverage: chances.length ? chances.reduce((sum, value) => sum + value, 0) / chances.length : null,
      chanceMin: chances.length ? Math.min(...chances) : null,
      chanceMax: chances.length ? Math.max(...chances) : null,
      bookmakerCount: new Set(quotes.map((quote) => quote.bookmaker).filter(Boolean)).size,
      sources: [...new Set(quotes.map((quote) => quote.provider).filter(Boolean))],
      directions,
      dominantDirection,
      dominantShare: items.length ? dominantCount / items.length : 0,
    };
  });
}

function buildUnifiedPendingRows(snapshots, rows, results, now) {
  const resolvedSamples = new Set(rows
    .filter((row) => row.strategyVersion === UNIFIED_STRATEGY_VERSION && row.settlement)
    .map((row) => row.sampleId));
  const commenceByFixture = new Map(results
    .filter((item) => item?.fixtureId && item?.commenceTime)
    .map((item) => [item.fixtureId, item.commenceTime]));
  return snapshots.filter((item) => !resolvedSamples.has(item.sampleId)).map((item) => {
    const commenceTime = item.commenceTime ?? commenceByFixture.get(item.fixtureId) ?? null;
    const kickoff = Date.parse(commenceTime ?? "");
    const bestQuote = qualifyingQuotes(item).toSorted(compareQuotes)[0];
    return {
      id: unifiedOpportunityIdentity(item),
      sampleId: item.sampleId,
      fixtureId: item.fixtureId,
      matchId: item.matchId ?? item.fixtureId,
      market: item.market,
      selection: item.selection,
      prediction: item.selection,
      line: Number.isFinite(item.line) ? item.line : null,
      odds: Number.isFinite(bestQuote?.odds) ? bestQuote.odds : null,
      chance: Number.isFinite(bestQuote?.chance) ? bestQuote.chance : null,
      edge: Number.isFinite(bestQuote?.edge) ? bestQuote.edge : null,
      commenceTime,
      savedAt: item.firstQualifiedAt ?? "",
      firstQualifiedAt: item.firstQualifiedAt ?? null,
      lastQualifiedAt: item.lastQualifiedAt ?? null,
      observationSummary: observationSummary(item.observations),
      modelVersion: item.modelVersion,
      strategyVersion: UNIFIED_STRATEGY_VERSION,
      source: "unified-sampler",
      status: !Number.isFinite(kickoff) ? "unknown" : now < kickoff ? "upcoming" : now < kickoff + SETTLEMENT_GRACE_MS ? "settling" : "overdue",
    };
  }).sort((left, right) => pendingTime(left.commenceTime) - pendingTime(right.commenceTime) || left.id.localeCompare(right.id));
}

function buildPendingRows(snapshots, finished, results, now) {
  const settled = new Set(finished.map(snapshotIdentity));
  const commenceByMatch = new Map(results.filter((item) => item?.matchId && item?.commenceTime).map((item) => [item.matchId, item.commenceTime]));
  return snapshots.filter((item) => !settled.has(snapshotIdentity(item))).map((item) => {
    const commenceTime = item.commenceTime ?? commenceByMatch.get(item.matchId) ?? null;
    const kickoff = Date.parse(commenceTime ?? "");
    const status = !Number.isFinite(kickoff) ? "unknown" : now < kickoff ? "upcoming" : now < kickoff + SETTLEMENT_GRACE_MS ? "settling" : "overdue";
    return {
      id: snapshotIdentity(item),
      matchId: item.matchId,
      market: item.market,
      prediction: item.prediction,
      line: Number.isFinite(item.line) ? item.line : null,
      odds: Number.isFinite(item.odds) ? item.odds : null,
      chance: Number.isFinite(item.chance) ? item.chance : null,
      edge: Number.isFinite(item.edge) ? item.edge : null,
      commenceTime,
      savedAt: item.savedAt,
      firstQualifiedAt: item.firstQualifiedAt ?? null,
      lastQualifiedAt: item.lastQualifiedAt ?? null,
      observationSummary: observationSummary(item.observations),
      modelVersion: item.modelVersion ?? "legacy-v0",
      source: item.source ?? null,
      status,
    };
  }).sort((left, right) => pendingTime(left.commenceTime) - pendingTime(right.commenceTime) || left.id.localeCompare(right.id));
}

function pendingTime(value) {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

export function summarize(rows) {
  rows = selectDistinctPerformanceRows(rows);
  const hit = rows.filter((row) => row.hit).length;
  const miss = rows.filter((row) => row.hit === false).length;
  const push = rows.filter((row) => row.settlement === "push").length;
  const ranged = rows.filter((row) => validProfitRange(row.unitProfitRange));
  if (ranged.length > 0) {
    const lower = ranged.reduce((total, row) => total + row.unitProfitRange.lower, 0);
    const upper = ranged.reduce((total, row) => total + row.unitProfitRange.upper, 0);
    const profitRange = { lower, upper };
    const roiRange = { lower: lower / ranged.length, upper: upper / ranged.length };
    return {
      finished: rows.length,
      hit,
      miss,
      push,
      hitRate: hit + miss ? hit / (hit + miss) : 0,
      priced: ranged.length,
      profit: lower,
      roi: roiRange.lower,
      yield: roiRange.lower,
      profitRange,
      roiRange,
      yieldRange: roiRange,
    };
  }
  const priced = rows.filter((row) => Number.isFinite(row.odds) && row.odds > 1);
  const profit = priced.reduce((total, row) => total + settlementProfit(row.settlement, row.odds), 0);
  const roi = priced.length ? profit / priced.length : null;
  return { finished: rows.length, hit, miss, push, hitRate: hit + miss ? hit / (hit + miss) : 0, priced: priced.length, profit, roi, yield: roi };
}

export function groupSummary(rows, keyFn) {
  rows = selectDistinctPerformanceRows(rows);
  return Object.fromEntries([...Map.groupBy(rows, keyFn)].map(([key, items]) => [key, summarize(items)]));
}

function selectDistinctPerformanceRows(rows) {
  const selected = new Map();
  const ungrouped = [];

  rows.forEach((row, index) => {
    if (row.strategyVersion === UNIFIED_STRATEGY_VERSION) {
      ungrouped.push({ row, index });
      return;
    }
    if (typeof row.matchId !== "string" || !row.matchId.trim()) {
      ungrouped.push({ row, index });
      return;
    }

    const key = `${row.market ?? ""}|${row.modelVersion ?? ""}|${row.matchId}`;
    const current = selected.get(key);
    if (!current || comparePerformanceRepresentatives(row, index, current.row, current.index) < 0) {
      selected.set(key, { row, index });
    }
  });

  return [...selected.values(), ...ungrouped]
    .sort((left, right) => left.index - right.index)
    .map(({ row }) => row);
}

function comparePerformanceRepresentatives(left, leftIndex, right, rightIndex) {
  const edgeOrder = compareFiniteNumbers(left.edge, right.edge, false);
  if (edgeOrder) return edgeOrder;

  const savedAtOrder = compareFiniteNumbers(Date.parse(left.savedAt ?? ""), Date.parse(right.savedAt ?? ""), true);
  if (savedAtOrder) return savedAtOrder;

  const lineOrder = compareFiniteNumbers(left.line, right.line, true);
  return lineOrder || leftIndex - rightIndex;
}

function compareFiniteNumbers(left, right, ascending) {
  const leftValid = Number.isFinite(left);
  const rightValid = Number.isFinite(right);
  if (leftValid !== rightValid) return leftValid ? -1 : 1;
  if (!leftValid || left === right) return 0;
  return ascending ? left - right : right - left;
}

function settleResult(snapshot, result) {
  const terminal = terminalSettlement(result);
  return terminal ?? settle(snapshot, result?.actual);
}

function settle(snapshot, actual) {
  const market = canonicalMarket(snapshot.market);
  const selection = canonicalSelection(snapshot.selection ?? snapshot.prediction);
  if (market === "h2h") {
    const prediction = selection || normalize(snapshot.prediction);
    const result = canonicalH2hResult(actual);
    return prediction && prediction === result ? "win" : result ? "loss" : null;
  }
  if (market === "handicap") {
    const score = typeof actual === "string" ? actual.match(/(\d+)\s*-\s*(\d+)/) : null;
    if (!score || typeof snapshot.line !== "number" || (selection !== "home" && selection !== "away")) return null;
    const margin = Number(score[1]) - Number(score[2]);
    const returns = asianLines(snapshot.line).map((line) => Math.sign(selection === "home" ? margin + line : -(margin + line)));
    return settlementFromReturn(returns.reduce((sum, value) => sum + value, 0) / returns.length);
  }
  const total = parseFloat(actual);
  if (!Number.isFinite(total) || typeof snapshot.line !== "number") return null;
  if (selection !== "over" && selection !== "under") return null;
  const returns = asianLines(snapshot.line).map((line) => selection === "over" ? Math.sign(total - line) : Math.sign(line - total));
  return settlementFromReturn(returns.reduce((sum, value) => sum + value, 0) / returns.length);
}

function terminalSettlement(result) {
  for (const value of [result?.settlement, result?.status, result?.resolutionState, result?.actual]) {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (normalized === "void" || normalized === "unsettleable") return normalized;
  }
  return null;
}

function canonicalMarket(value) {
  if (value === "h2h" || value === "主客和") return "h2h";
  if (value === "handicap" || value === "亞洲讓球") return "handicap";
  if (value === "totals" || value === "大細波") return "totals";
  if (value === "corners" || value === "角球") return "corners";
  return value;
}

function canonicalSelection(value) {
  const normalized = normalize(value);
  if (normalized === "home" || normalized === "主" || normalized === "主勝") return "home";
  if (normalized === "away" || normalized === "客" || normalized === "客勝") return "away";
  if (normalized === "draw" || normalized === "和局") return "draw";
  if (normalized === "over" || normalized === "大") return "over";
  if (normalized === "under" || normalized === "細") return "under";
  return normalized;
}

function canonicalH2hResult(actual) {
  const score = typeof actual === "string" ? actual.match(/(\d+)\s*-\s*(\d+)/) : null;
  if (score) {
    const margin = Number(score[1]) - Number(score[2]);
    return margin > 0 ? "home" : margin < 0 ? "away" : "draw";
  }
  const result = canonicalSelection(actual);
  return result === "home" || result === "away" || result === "draw" ? result : "";
}

function normalize(value) {
  if (typeof value !== "string") return "";
  if (value.includes("大")) return "大";
  if (value.includes("細")) return "細";
  return value === "和" || value === "和局" ? "和局" : value;
}

function asianLines(line) {
  const quarter = Math.round((line - Math.floor(line)) * 4) / 4;
  if (quarter === 0.25) return [Math.floor(line), Math.floor(line) + 0.5];
  if (quarter === 0.75) return [Math.floor(line) + 0.5, Math.floor(line) + 1];
  return [line];
}

function settlementFromReturn(value) {
  if (value === 1) return "win";
  if (value === 0.5) return "half-win";
  if (value === 0) return "push";
  if (value === -0.5) return "half-loss";
  return "loss";
}

function settlementHit(settlement) {
  return settlement === "win" || settlement === "half-win" ? true : settlement === "loss" || settlement === "half-loss" ? false : null;
}

function settlementProfit(settlement, odds) {
  if (settlement === "win") return odds - 1;
  if (settlement === "half-win") return (odds - 1) / 2;
  if (settlement === "half-loss") return -0.5;
  if (settlement === "loss") return -1;
  return 0;
}

function observationSummary(value = []) {
  const observations = Array.isArray(value) ? value : [];
  let firstEvaluatedAt = null;
  let firstTime = Number.POSITIVE_INFINITY;
  let lastEvaluatedAt = null;
  let lastTime = Number.NEGATIVE_INFINITY;
  let buyableQuoteCount = 0;
  for (const observation of observations) {
    const first = Date.parse(observation?.firstEvaluatedAt ?? "");
    if (Number.isFinite(first) && first < firstTime) {
      firstTime = first;
      firstEvaluatedAt = observation.firstEvaluatedAt;
    }
    const last = Date.parse(observation?.lastEvaluatedAt ?? "");
    if (Number.isFinite(last) && last > lastTime) {
      lastTime = last;
      lastEvaluatedAt = observation.lastEvaluatedAt;
    }
    buyableQuoteCount += Array.isArray(observation?.buyableQuotes) ? observation.buyableQuotes.length : 0;
  }
  return { count: observations.length, firstEvaluatedAt, lastEvaluatedAt, buyableQuoteCount };
}

function qualifyingQuotes(snapshot) {
  return preKickObservations(snapshot)
    .flatMap((observation) => Array.isArray(observation.buyableQuotes) ? observation.buyableQuotes : [])
    .filter((quote) => Number.isFinite(quote?.odds) && quote.odds > 1);
}

function preKickObservations(snapshot) {
  const kickoff = Date.parse(snapshot?.commenceTime ?? "");
  return (Array.isArray(snapshot?.observations) ? snapshot.observations : [])
    .filter((observation) => {
      const evaluatedAt = Date.parse(observation?.lastEvaluatedAt ?? "");
      return Number.isFinite(evaluatedAt) && (!Number.isFinite(kickoff) || evaluatedAt < kickoff);
    });
}

function oddsRange(quotes) {
  if (quotes.length === 0) return null;
  const odds = quotes.map((quote) => quote.odds);
  return { min: Math.min(...odds), max: Math.max(...odds), count: quotes.length };
}

function profitRange(settlement, quotes) {
  const profits = quotes.map((quote) => settlementProfit(settlement, quote.odds));
  return { lower: Math.min(...profits), upper: Math.max(...profits) };
}

function closingBenchmark(snapshot) {
  const latest = preKickObservations(snapshot)
    .toSorted((left, right) => Date.parse(right.lastEvaluatedAt) - Date.parse(left.lastEvaluatedAt))[0];
  const quotes = Array.isArray(latest?.buyableQuotes)
    ? latest.buyableQuotes.filter((quote) => Number.isFinite(quote?.odds) && quote.odds > 1)
    : [];
  const quoteRange = oddsRange(quotes);
  return quoteRange ? { evaluatedAt: latest.lastEvaluatedAt, quoteRange } : "N/A";
}

function compareQuotes(left, right) {
  return right.odds - left.odds
    || String(left.bookmaker ?? "").localeCompare(String(right.bookmaker ?? ""))
    || String(left.provider ?? "").localeCompare(String(right.provider ?? ""));
}

function validProfitRange(value) {
  return Number.isFinite(value?.lower) && Number.isFinite(value?.upper);
}

function isPerformanceRow(row) {
  return PERFORMANCE_SETTLEMENTS.has(row?.settlement)
    && (row.strategyVersion !== UNIFIED_STRATEGY_VERSION || validProfitRange(row.unitProfitRange));
}

function isUnifiedOpportunity(item) {
  return item?.strategyVersion === UNIFIED_STRATEGY_VERSION;
}

function unifiedOpportunityIdentity(item) {
  return [item.fixtureId, item.market, item.selection, Number.isFinite(item.line) ? item.line : "", item.modelVersion, item.strategyVersion].join("|");
}

function fixtureMarketIdentity(item) {
  return `${item.fixtureId ?? item.matchId}|${canonicalMarket(item.market)}`;
}

export function bucket(chance) {
  if (!Number.isFinite(chance)) return "unknown";
  const low = Math.floor((chance * 100) / 5) * 5;
  return `${low}-${low + 5}%`;
}

function isPredictionSnapshot(item) {
  return item && typeof item.matchId === "string" && typeof item.market === "string" && typeof item.prediction === "string" && typeof item.savedAt === "string";
}

function snapshotsForResult(snapshots, result) {
  return snapshots.filter((snapshot) => {
    if (isUnifiedOpportunity(snapshot)) {
      const sameFixture = snapshot.fixtureId && result.fixtureId
        ? snapshot.fixtureId === result.fixtureId
        : snapshot.matchId === result.matchId;
      return sameFixture && canonicalMarket(snapshot.market) === canonicalMarket(result.market);
    }
    return snapshot.matchId === result.matchId
      && snapshot.market === result.market
      && (!Number.isFinite(result.line) || !Number.isFinite(snapshot.line) || snapshot.line === result.line);
  });
}

export function mergeSnapshots(existing, incoming) {
  const byKey = new Map();
  for (const item of [...existing, ...incoming]) {
    if (isPredictionSnapshot(item) && !byKey.has(snapshotIdentity(item))) {
      byKey.set(snapshotIdentity(item), { ...item, modelVersion: item.modelVersion ?? "legacy-v0" });
    }
  }
  return [...byKey.values()];
}

export function mergeResults(existing, incoming) {
  const byKey = new Map();
  for (const item of [...existing, ...incoming]) byKey.set(resultIdentity(item), item);
  return [...byKey.values()];
}

export function oddsScoreRows(events) {
  return (Array.isArray(events) ? events : []).flatMap((event) => {
    if (!event?.completed || !Array.isArray(event.scores)) return [];
    const home = Number(event.scores.find((score) => score.name === event.home_team)?.score);
    const away = Number(event.scores.find((score) => score.name === event.away_team)?.score);
    if (!Number.isFinite(home) || !Number.isFinite(away)) return [];
    const base = { matchId: event.id, homeTeam: event.home_team, awayTeam: event.away_team, commenceTime: event.commence_time, score: `${home}-${away}`, actual: `${home}-${away}`, prediction: "未有賽前快照", hit: null };
    return [
      { ...base, id: `${event.id}-odds-hdc-result`, market: "亞洲讓球" },
      { ...base, id: `${event.id}-odds-totals-result`, market: "大細波", actual: `${home + away} 球` },
    ];
  });
}

export function selectBacktestResults(liveResults, archivedResults) {
  return archivedResults.length ? archivedResults : liveResults;
}
