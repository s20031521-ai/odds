import { classifySnapshot, summarizeSnapshotQuality } from "../../shared/snapshot-policy.mjs";
import { resultIdentity, snapshotIdentity } from "./identity.mjs";

const SETTLEMENT_GRACE_MS = 180 * 60_000;
const DATA_FRESH_MS = 45 * 60_000;

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
  const stored = mergeSnapshots([], snapshots);
  const snapshotQuality = summarizeSnapshotQuality(stored);
  const usable = stored.filter((item) => classifySnapshot(item).status === "valid-current");
  const rows = results.flatMap((row) => {
    const matches = snapshotsForResult(usable, row);
    if (matches.length === 0) return { ...row, prediction: "未有賽前快照", hit: null, settlement: null, odds: undefined, chance: undefined, modelVersion: undefined };
    return matches.map((snapshot) => {
      const settlement = settle(snapshot, row.actual);
      return {
        ...row,
        id: `${row.id ?? `${row.matchId}-${row.market}`}|${snapshotIdentity(snapshot)}`,
        prediction: snapshot.prediction,
        line: snapshot.line ?? row.line,
        odds: snapshot.odds,
        chance: snapshot.chance,
        edge: snapshot.edge,
        savedAt: snapshot.savedAt,
        snapshotStatus: "valid-current",
        modelVersion: snapshot.modelVersion,
        source: snapshot.source,
        settlement,
        hit: settlementHit(settlement),
      };
    });
  });
  const finished = rows.filter((row) => row.settlement);
  return { rows, summary: summarize(finished), byMarket: groupSummary(finished, (row) => row.market), buckets: groupSummary(finished, (row) => bucket(row.chance)), readiness: summarizeReadiness(usable, finished, results, now), snapshotQuality };
}

function summarizeReadiness(snapshots, finished, results, now) {
  const settled = new Set(finished.map(snapshotIdentity));
  const commenceByMatch = new Map(results.filter((item) => item?.matchId && item?.commenceTime).map((item) => [item.matchId, item.commenceTime]));
  return [...Map.groupBy(snapshots, (item) => `${item.market}|${item.modelVersion ?? "legacy-v0"}`)].map(([key, items]) => {
    const [market, modelVersion] = key.split("|");
    const chances = items.map((item) => item.chance).filter(Number.isFinite);
    const directions = Object.fromEntries([...Map.groupBy(items, (item) => item.prediction)].map(([direction, matches]) => [direction, matches.length]));
    const [dominantDirection, dominantCount] = Object.entries(directions).sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
    const settledCount = items.filter((item) => settled.has(snapshotIdentity(item))).length;
    const pendingItems = items.filter((item) => !settled.has(snapshotIdentity(item)));
    const pendingStatus = pendingItems.reduce((status, item) => {
      const kickoff = Date.parse(item.commenceTime ?? commenceByMatch.get(item.matchId));
      if (!Number.isFinite(kickoff)) status.unknownPending += 1;
      else if (now < kickoff) status.upcoming += 1;
      else if (now < kickoff + SETTLEMENT_GRACE_MS) status.settling += 1;
      else status.overdue += 1;
      return status;
    }, { upcoming: 0, settling: 0, overdue: 0, unknownPending: 0 });
    const allMatchIds = new Set(items.map((item) => item.matchId));
    const settledMatchIds = new Set(items.filter((item) => settled.has(snapshotIdentity(item))).map((item) => item.matchId));
    const pendingByMatch = Map.groupBy(pendingItems, (item) => item.matchId);
    const pendingMatchStatus = [...pendingByMatch.values()].reduce((status, matchItems) => {
      const item = matchItems[0];
      const kickoff = Date.parse(item.commenceTime ?? commenceByMatch.get(item.matchId));
      if (!Number.isFinite(kickoff)) status.unknownPendingMatches += 1;
      else if (now < kickoff) status.upcomingMatches += 1;
      else if (now < kickoff + SETTLEMENT_GRACE_MS) status.settlingMatches += 1;
      else status.overdueMatches += 1;
      return status;
    }, { upcomingMatches: 0, settlingMatches: 0, overdueMatches: 0, unknownPendingMatches: 0 });
    return {
      market, modelVersion, snapshots: items.length, settled: settledCount, pending: items.length - settledCount,
      matches: allMatchIds.size, settledMatches: settledMatchIds.size, pendingMatches: pendingByMatch.size,
      ...pendingStatus, ...pendingMatchStatus,
      priced: items.filter((item) => Number.isFinite(item.odds) && item.odds > 1).length,
      chanceCount: chances.length, chanceAverage: chances.length ? chances.reduce((sum, value) => sum + value, 0) / chances.length : null,
      chanceMin: chances.length ? Math.min(...chances) : null, chanceMax: chances.length ? Math.max(...chances) : null,
      bookmakerCount: items.filter((item) => typeof item.bookmaker === "string" && item.bookmaker).length,
      sources: [...new Set(items.map((item) => item.source).filter(Boolean))], directions,
      dominantDirection, dominantShare: items.length ? dominantCount / items.length : 0,
    };
  });
}

export function summarize(rows) {
  rows = selectDistinctPerformanceRows(rows);
  const hit = rows.filter((row) => row.hit).length;
  const miss = rows.filter((row) => row.hit === false).length;
  const push = rows.filter((row) => row.settlement === "push").length;
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

function settle(snapshot, actual) {
  if (snapshot.market === "主客和") {
    const prediction = normalize(snapshot.prediction);
    const result = normalize(actual);
    return prediction && prediction === result ? "win" : result ? "loss" : null;
  }
  if (snapshot.market === "亞洲讓球") {
    const score = typeof actual === "string" ? actual.match(/(\d+)\s*-\s*(\d+)/) : null;
    if (!score || typeof snapshot.line !== "number" || (snapshot.prediction !== "主" && snapshot.prediction !== "客")) return null;
    const margin = Number(score[1]) - Number(score[2]);
    const returns = asianLines(snapshot.line).map((line) => Math.sign(snapshot.prediction === "主" ? margin + line : -(margin + line)));
    return settlementFromReturn(returns.reduce((sum, value) => sum + value, 0) / returns.length);
  }
  const total = parseFloat(actual);
  if (!Number.isFinite(total) || typeof snapshot.line !== "number") return null;
  const prediction = normalize(snapshot.prediction);
  if (prediction !== "大" && prediction !== "細") return null;
  const returns = asianLines(snapshot.line).map((line) => prediction === "大" ? Math.sign(total - line) : Math.sign(line - total));
  return settlementFromReturn(returns.reduce((sum, value) => sum + value, 0) / returns.length);
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

export function bucket(chance) {
  if (!Number.isFinite(chance)) return "unknown";
  const low = Math.floor((chance * 100) / 5) * 5;
  return `${low}-${low + 5}%`;
}

function isPredictionSnapshot(item) {
  return item && typeof item.matchId === "string" && typeof item.market === "string" && typeof item.prediction === "string" && typeof item.savedAt === "string";
}

function snapshotsForResult(snapshots, result) {
  return snapshots.filter((snapshot) =>
    snapshot.matchId === result.matchId
    && snapshot.market === result.market
    && (!Number.isFinite(result.line) || !Number.isFinite(snapshot.line) || snapshot.line === result.line));
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
