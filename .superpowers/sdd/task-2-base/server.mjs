import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, "data");
const predictionsPath = path.join(dataDir, "prediction-snapshots.jsonl");
const resultArchivePath = path.join(dataDir, "result-archive.jsonl");
const backgroundPredictionsPath = path.join(dataDir, "background-hdc-snapshots.jsonl");
const backgroundResultsPath = path.join(dataDir, "background-result-archive.jsonl");
const backgroundLivePath = path.join(dataDir, "background-hdc-odds.json");
const collectorStatePath = path.join(dataDir, "hdc-collector-state.json");
const hkjcPath = path.join(root, "public", "hkjc-odds.json");
const port = Number(process.env.PORT ?? 8787);
const SETTLEMENT_GRACE_MS = 180 * 60_000;
const DATA_FRESH_MS = 45 * 60_000;
let snapshotWrite = Promise.resolve();
let resultWrite = Promise.resolve();

if (process.argv.includes("--self-test")) {
  const snapshots = [
    { matchId: "draw", market: "主客和", prediction: "和局", odds: 2, chance: 0.62, savedAt: "x", modelVersion: "consensus-v1" },
    { matchId: "draw", market: "主客和", prediction: "主勝", odds: 2, chance: 0.55, savedAt: "x", modelVersion: "consensus-v2" },
    { matchId: "win", market: "大細波", prediction: "大", line: 2.25, odds: 2, savedAt: "x" },
    { matchId: "half-win", market: "角球", prediction: "大角", line: 9.75, odds: 2, savedAt: "x" },
    { matchId: "push", market: "大細波", prediction: "大", line: 3, odds: 2, savedAt: "x" },
    { matchId: "half-loss", market: "角球", prediction: "大角", line: 9.25, odds: 2, savedAt: "x" },
    { matchId: "loss", market: "大細波", prediction: "大", line: 2.25, odds: 2, savedAt: "x" },
    { matchId: "pending", market: "大細波", prediction: "細", line: 2.5, chance: 0.56, commenceTime: "2026-07-11T13:00:00Z", savedAt: "2026-07-11T11:00:00Z", modelVersion: "totals-loo-v1", source: "loo" },
    { matchId: "overdue", market: "大細波", prediction: "大", line: 2.5, chance: 0.61, commenceTime: "2026-07-11T06:00:00Z", savedAt: "2026-07-11T05:00:00Z", modelVersion: "totals-loo-v1", source: "loo" },
    { matchId: "overdue", market: "大細波", prediction: "大", line: 3, chance: 0.58, odds: 2, commenceTime: "2026-07-11T06:00:00Z", savedAt: "2026-07-11T05:00:00Z", modelVersion: "totals-loo-v1", source: "loo" },
  ];
  const backtest = buildBacktest(snapshots, [
    { matchId: "draw", market: "主客和", actual: "和" },
    { matchId: "win", market: "大細波", actual: "3 球" },
    { matchId: "half-win", market: "角球", actual: "10 角球" },
    { matchId: "push", market: "大細波", actual: "3 球" },
    { matchId: "half-loss", market: "角球", actual: "9 角球" },
    { matchId: "loss", market: "大細波", actual: "1 球" },
    { matchId: "no-snapshot", market: "主客和", actual: "主勝", prediction: "主勝", hit: true },
  ], Date.parse("2026-07-11T12:00:00Z"));
  assert(backtest.rows.at(-1).hit === null && backtest.rows.at(-1).prediction === "未有賽前快照", "never treats result-time picks as pre-match predictions");
  assert(backtest.rows[0].settlement === "win" && backtest.rows[1].settlement === "loss", "settles distinct model versions independently");
  assert(backtest.rows.slice(2, -1).map((row) => row.settlement).join(",") === "win,half-win,push,half-loss,loss", "settles Asian quarter lines");
  assert(backtest.summary.hitRate === 3 / 6, "excludes pushes from hit-rate denominator");
  assert(backtest.buckets["60-65%"].hit === 1, "buckets by chance");
  const readiness = backtest.readiness.find((item) => item.market === "大細波" && item.modelVersion === "totals-loo-v1");
  assert(readiness.snapshots === 3 && readiness.settled === 0 && readiness.pending === 3, "tracks current-model pending snapshots");
  assert(readiness.matches === 2 && readiness.pendingMatches === 2 && readiness.overdueMatches === 1, "deduplicates overdue lines into matches");
  assert(readiness.upcoming === 1 && readiness.overdue === 2 && readiness.settling === 0, "separates future and overdue results");
  assert(readiness.priced === 1 && readiness.chanceCount === 3, "tracks completeness health");
  assert(isIncomingPredictionSnapshot({ ...snapshots.at(-1), savedAt: "2026-07-11T07:00:00Z" }) === false, "rejects post-kick snapshots");
  const hdcBacktest = buildBacktest([
    { matchId: "hdc-half-win", market: "亞洲讓球", prediction: "主", line: -0.75, odds: 2, savedAt: "x" },
    { matchId: "hdc-half-loss", market: "亞洲讓球", prediction: "主", line: -0.25, odds: 2, savedAt: "x" },
    { matchId: "hdc-push", market: "亞洲讓球", prediction: "主", line: -1, odds: 2, savedAt: "x" },
    { matchId: "hdc-away", market: "亞洲讓球", prediction: "客", line: -0.25, odds: 2, savedAt: "x" },
  ], [
    { matchId: "hdc-half-win", market: "亞洲讓球", actual: "2-1" },
    { matchId: "hdc-half-loss", market: "亞洲讓球", actual: "1-1" },
    { matchId: "hdc-push", market: "亞洲讓球", actual: "2-1" },
    { matchId: "hdc-away", market: "亞洲讓球", actual: "1-1" },
  ]);
  assert(hdcBacktest.rows.map((row) => row.settlement).join(",") === "half-win,half-loss,push,half-win", "settles HDC home and away quarter lines");
  const merged = mergeSnapshots([snapshots[0]], [{ ...snapshots[0], odds: 9 }, snapshots[1]]);
  assert(merged.length === 2 && merged[0].odds === 2, "keeps first snapshot per versioned identity");
  assert(selectBacktestResults([{ matchId: "live" }], [{ matchId: "archive" }])[0].matchId === "archive", "prefers durable result archive");
  assert(mergeResults([{ matchId: "m", market: "亞洲讓球", actual: "1-0" }], [{ matchId: "m", market: "亞洲讓球", actual: "2-0" }])[0].actual === "2-0", "background result overrides duplicate archive identity");
  const scoreRows = oddsScoreRows([{ id: "odds-1", completed: true, commence_time: "2026-07-11T00:00:00Z", home_team: "A", away_team: "B", scores: [{ name: "A", score: "2" }, { name: "B", score: "1" }] }]);
  assert(scoreRows[0].actual === "2-1" && scoreRows[0].matchId === "odds-1", "converts The Odds API scores into HDC results");
  assert(scoreRows[1].actual === "3 球", "converts The Odds API scores into totals results");
  const scoreBacktest = buildBacktest([{ matchId: "odds-1", market: "大細波", prediction: "大", line: 2.5, odds: 2, savedAt: "x" }], scoreRows);
  assert(scoreBacktest.rows.find((row) => row.market === "大細波")?.settlement === "win", "settles imported totals from summed goals");
  assert(scoreRows.map((row) => row.market).join(",") === "亞洲讓球,大細波", "one score settles both focused goal markets");
  const live = flattenLiveCache({ soccer_test: { h2hEntries: [{ id: "h2h" }], handicapEntries: [{ id: "hdc" }], totalEntries: [{ id: "totals" }], cornerEntries: [{ id: "corners" }] } });
  assert(live.h2hEntries[0].id === "h2h" && live.handicapEntries[0].id === "hdc" && live.totalEntries[0].id === "totals" && live.cornerEntries[0].id === "corners", "exposes all source-neutral cached markets");
  const freshHealth = buildHealth({ collector: "2026-07-11T11:40:00Z", hkjc: "2026-07-11T11:50:00Z" }, Date.parse("2026-07-11T12:00:00Z"));
  assert(freshHealth.ok && freshHealth.dataFresh && freshHealth.staleSources.length === 0, "reports fresh data sources");
  const staleHealth = buildHealth({ collector: "2026-07-11T10:00:00Z" }, Date.parse("2026-07-11T12:00:00Z"));
  assert(staleHealth.ok && !staleHealth.dataFresh && staleHealth.staleSources.join(",") === "collector,hkjc", "reports stale and missing data sources without marking the server down");
  const validPolicySnapshot = { matchId: "quality-valid", market: "大細波", prediction: "大", line: 2.5, odds: 2, chance: 0.55, edge: 0.04, savedAt: "2026-07-11T10:00:00Z", commenceTime: "2026-07-11T11:00:00Z", modelVersion: "totals-loo-v1", source: "test" };
  const qualityBacktest = buildBacktest([
    validPolicySnapshot,
    { ...validPolicySnapshot, matchId: "quality-invalid", commenceTime: undefined },
    { ...validPolicySnapshot, matchId: "quality-legacy", modelVersion: undefined },
  ], [
    { matchId: "quality-valid", market: "大細波", actual: "3 球" },
    { matchId: "quality-invalid", market: "大細波", actual: "3 球" },
    { matchId: "quality-legacy", market: "大細波", actual: "3 球" },
  ], Date.parse("2026-07-11T12:00:00Z"));
  assert(qualityBacktest.snapshotQuality.validCurrent === 1 && qualityBacktest.snapshotQuality.invalid === 1 && qualityBacktest.snapshotQuality.legacy === 1, "classifies snapshot quality without rewriting rows");
  assert(qualityBacktest.rows.filter((row) => row.snapshotStatus === "valid-current").length === 1, "settles only valid current snapshots");
  console.log("[server] self-test passed");
  process.exit(0);
}

createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return send(res, 204, null);
    if (req.method === "GET" && req.url === "/health") return send(res, 200, await readHealth());
    if (req.method === "GET" && req.url === "/api/results") return send(res, 200, { resultEntries: (await readHkjc()).resultEntries ?? [] });
    if (req.method === "GET" && req.url === "/api/hdc-live") {
      const cached = await readJsonFile(backgroundLivePath, {});
      const live = flattenLiveCache(cached);
      return send(res, 200, { entries: live.h2hEntries, ...live });
    }
    if (req.method === "GET" && req.url === "/api/backtest") {
      const [uiSnapshots, backgroundSnapshots, hkjcResults, backgroundResults] = await Promise.all([
        readJsonl(predictionsPath), readJsonl(backgroundPredictionsPath), readJsonl(resultArchivePath), readJsonl(backgroundResultsPath),
      ]);
      const snapshots = mergeSnapshots(uiSnapshots, backgroundSnapshots);
      const archivedResults = mergeResults(hkjcResults, backgroundResults);
      const results = archivedResults.length ? archivedResults : (await readHkjc()).resultEntries ?? [];
      return send(res, 200, buildBacktest(snapshots, selectBacktestResults(results, archivedResults)));
    }
    if (req.method === "POST" && req.url?.startsWith("/api/import/odds-scores")) {
      const requestUrl = new URL(req.url, "http://127.0.0.1");
      const sport = requestUrl.searchParams.get("sport") ?? "";
      if (!/^soccer_[a-z0-9_]+$/.test(sport)) return send(res, 400, { error: "invalid sport" });
      const apiKey = await readEnvValue(path.join(root, ".env.local"), "ODDS_API_KEY");
      if (!apiKey) return send(res, 503, { error: "ODDS_API_KEY is not configured" });
      const url = new URL(`https://api.the-odds-api.com/v4/sports/${sport}/scores`);
      url.searchParams.set("apiKey", apiKey);
      url.searchParams.set("daysFrom", "3");
      url.searchParams.set("dateFormat", "iso");
      const response = await fetch(url);
      const body = await response.json();
      if (!response.ok) return send(res, response.status, body);
      const saved = await persistResults(oddsScoreRows(body));
      return send(res, 200, { saved });
    }
    if (req.method === "GET" && req.url?.startsWith("/api/odds")) {
      const requestUrl = new URL(req.url, "http://127.0.0.1");
      const sport = requestUrl.searchParams.get("sport") ?? "";
      const region = requestUrl.searchParams.get("region") ?? "us";
      if (!/^soccer_[a-z0-9_]+$/.test(sport) || !["uk", "eu", "us", "au"].includes(region)) return send(res, 400, { error: "invalid sport or region" });
      const apiKey = await readEnvValue(path.join(root, ".env.local"), "ODDS_API_KEY");
      if (!apiKey) return send(res, 503, { error: "ODDS_API_KEY is not configured" });
      const url = new URL(`https://api.the-odds-api.com/v4/sports/${sport}/odds`);
      url.searchParams.set("apiKey", apiKey);
      url.searchParams.set("regions", region);
      url.searchParams.set("markets", "h2h,totals,spreads");
      url.searchParams.set("oddsFormat", "decimal");
      url.searchParams.set("dateFormat", "iso");
      const response = await fetch(url);
      return send(res, response.status, await response.json());
    }
    if (req.method === "POST" && req.url === "/api/predictions") {
      const body = await readJson(req);
      const incoming = Array.isArray(body) ? body : [body];
      const snapshots = incoming.filter(isIncomingPredictionSnapshot);
      if (snapshots.length === 0) return send(res, 400, { error: "no valid prediction snapshots" });
      const saved = await persistSnapshots(snapshots);
      return send(res, 200, { saved, rejected: incoming.length - snapshots.length });
    }
    if (req.method === "POST" && req.url === "/api/import/hkjc") {
      const output = await run("node", ["scripts/hkjc-import.mjs"]);
      return send(res, 200, { output });
    }
    send(res, 404, { error: "not found" });
  } catch (error) {
    send(res, 500, { error: error instanceof Error ? error.message : "server error" });
  }
}).listen(port, "127.0.0.1", () => console.log(`[server] http://127.0.0.1:${port}`));

function flattenLiveCache(cached) {
  const items = Object.values(cached ?? {});
  return {
    h2hEntries: items.flatMap((item) => item?.h2hEntries ?? []),
    handicapEntries: items.flatMap((item) => item?.handicapEntries ?? item?.entries ?? []),
    totalEntries: items.flatMap((item) => item?.totalEntries ?? []),
    cornerEntries: items.flatMap((item) => item?.cornerEntries ?? []),
  };
}

async function readHealth(now = Date.now()) {
  const [collector, hkjc] = await Promise.all([
    readJsonFile(collectorStatePath, {}),
    readJsonFile(hkjcPath, {}),
  ]);
  return buildHealth({ collector: collector.lastDiscoveryAt, hkjc: hkjc.generatedAt }, now);
}

function buildHealth(updatedAtBySource, now = Date.now()) {
  const sources = Object.fromEntries(["collector", "hkjc"].map((name) => {
    const updatedAt = updatedAtBySource?.[name] ?? null;
    const timestamp = Date.parse(updatedAt ?? "");
    const ageMs = Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : null;
    return [name, { updatedAt, ageMs, stale: ageMs === null || ageMs > DATA_FRESH_MS }];
  }));
  const staleSources = Object.entries(sources).filter(([, source]) => source.stale).map(([name]) => name);
  return { ok: true, dataFresh: staleSources.length === 0, checkedAt: new Date(now).toISOString(), staleSources, sources };
}

function buildBacktest(snapshots, results, now = Date.now()) {
  const stored = mergeSnapshots([], snapshots);
  const rows = results.flatMap((row) => {
    const matches = snapshotsForResult(stored, row);
    if (matches.length === 0) return { ...row, prediction: "未有賽前快照", hit: null, settlement: null, odds: undefined, chance: undefined, modelVersion: undefined };
    return matches.map((snapshot) => {
      const settlement = settle(snapshot, row.actual);
      return {
        ...row,
        id: `${row.id ?? `${row.matchId}-${row.market}`}|${snapshotKey(snapshot)}`,
        prediction: snapshot.prediction,
        line: snapshot.line ?? row.line,
        odds: snapshot.odds,
        chance: snapshot.chance,
        modelVersion: snapshot.modelVersion,
        source: snapshot.source,
        settlement,
        hit: settlementHit(settlement),
      };
    });
  });
  const finished = rows.filter((row) => row.settlement);
  return { rows, summary: summarize(finished), byMarket: groupSummary(finished, (row) => row.market), buckets: groupSummary(finished, (row) => bucket(row.chance)), readiness: summarizeReadiness(stored, finished, results, now) };
}

function summarizeReadiness(snapshots, finished, results, now) {
  const settled = new Set(finished.map(snapshotKey));
  const commenceByMatch = new Map(results.filter((item) => item?.matchId && item?.commenceTime).map((item) => [item.matchId, item.commenceTime]));
  return [...Map.groupBy(snapshots, (item) => `${item.market}|${item.modelVersion ?? "legacy-v0"}`)].map(([key, items]) => {
    const [market, modelVersion] = key.split("|");
    const chances = items.map((item) => item.chance).filter(Number.isFinite);
    const directions = Object.fromEntries([...Map.groupBy(items, (item) => item.prediction)].map(([direction, matches]) => [direction, matches.length]));
    const [dominantDirection, dominantCount] = Object.entries(directions).sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
    const settledCount = items.filter((item) => settled.has(snapshotKey(item))).length;
    const pendingItems = items.filter((item) => !settled.has(snapshotKey(item)));
    const pendingStatus = pendingItems.reduce((status, item) => {
      const kickoff = Date.parse(item.commenceTime ?? commenceByMatch.get(item.matchId));
      if (!Number.isFinite(kickoff)) status.unknownPending += 1;
      else if (now < kickoff) status.upcoming += 1;
      else if (now < kickoff + SETTLEMENT_GRACE_MS) status.settling += 1;
      else status.overdue += 1;
      return status;
    }, { upcoming: 0, settling: 0, overdue: 0, unknownPending: 0 });
    const allMatchIds = new Set(items.map((item) => item.matchId));
    const settledMatchIds = new Set(items.filter((item) => settled.has(snapshotKey(item))).map((item) => item.matchId));
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

function summarize(rows) {
  const hit = rows.filter((row) => row.hit).length;
  const miss = rows.filter((row) => row.hit === false).length;
  const push = rows.filter((row) => row.settlement === "push").length;
  const priced = rows.filter((row) => Number.isFinite(row.odds) && row.odds > 1);
  const profit = priced.reduce((total, row) => total + settlementProfit(row.settlement, row.odds), 0);
  const roi = priced.length ? profit / priced.length : null;
  return { finished: rows.length, hit, miss, push, hitRate: hit + miss ? hit / (hit + miss) : 0, priced: priced.length, profit, roi, yield: roi };
}

function groupSummary(rows, keyFn) {
  return Object.fromEntries([...Map.groupBy(rows, keyFn)].map(([key, items]) => [key, summarize(items)]));
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

function bucket(chance) {
  if (!Number.isFinite(chance)) return "unknown";
  const low = Math.floor((chance * 100) / 5) * 5;
  return `${low}-${low + 5}%`;
}

function isPredictionSnapshot(item) {
  return item && typeof item.matchId === "string" && typeof item.market === "string" && typeof item.prediction === "string" && typeof item.savedAt === "string";
}

function isIncomingPredictionSnapshot(item) {
  if (!isPredictionSnapshot(item) || typeof item.commenceTime !== "string") return false;
  const savedAt = Date.parse(item.savedAt);
  const commenceTime = Date.parse(item.commenceTime);
  return Number.isFinite(savedAt) && Number.isFinite(commenceTime) && savedAt < commenceTime;
}

function snapshotKey(item) {
  return `${item.matchId}|${item.market}|${Number.isFinite(item.line) ? item.line : ""}|${item.modelVersion ?? "legacy-v0"}`;
}

function snapshotsForResult(snapshots, result) {
  return snapshots.filter((snapshot) =>
    snapshot.matchId === result.matchId
    && snapshot.market === result.market
    && (!Number.isFinite(result.line) || !Number.isFinite(snapshot.line) || snapshot.line === result.line));
}

function mergeSnapshots(existing, incoming) {
  const byKey = new Map();
  for (const item of [...existing, ...incoming]) {
    if (isPredictionSnapshot(item) && !byKey.has(snapshotKey(item))) {
      byKey.set(snapshotKey(item), { ...item, modelVersion: item.modelVersion ?? "legacy-v0" });
    }
  }
  return [...byKey.values()];
}

function mergeResults(existing, incoming) {
  const byKey = new Map();
  for (const item of [...existing, ...incoming]) byKey.set(`${item.matchId}|${item.market}`, item);
  return [...byKey.values()];
}

function persistSnapshots(incoming) {
  const write = snapshotWrite.then(async () => {
    const existing = await readJsonl(predictionsPath);
    const merged = mergeSnapshots(existing, incoming);
    await mkdir(dataDir, { recursive: true });
    await writeFile(predictionsPath, merged.map((item) => JSON.stringify(item)).join("\n") + (merged.length ? "\n" : ""));
    return merged.length - mergeSnapshots(existing, []).length;
  });
  snapshotWrite = write.catch(() => {});
  return write;
}

function oddsScoreRows(events) {
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

function persistResults(incoming) {
  const write = resultWrite.then(async () => {
    const existing = await readJsonl(resultArchivePath);
    const byId = new Map(existing.map((item) => [item.id ?? `${item.matchId}-${item.market}`, item]));
    for (const item of incoming) byId.set(item.id ?? `${item.matchId}-${item.market}`, item);
    const merged = [...byId.values()];
    await mkdir(dataDir, { recursive: true });
    await writeFile(resultArchivePath, merged.map((item) => JSON.stringify(item)).join("\n") + (merged.length ? "\n" : ""));
    return merged.length - existing.length;
  });
  resultWrite = write.catch(() => {});
  return write;
}

function selectBacktestResults(liveResults, archivedResults) {
  return archivedResults.length ? archivedResults : liveResults;
}

async function readHkjc() {
  return JSON.parse(await readFile(hkjcPath, "utf8"));
}

async function readJsonl(file) {
  try {
    const text = await readFile(file, "utf8");
    return text.trim() ? text.trim().split(/\r?\n/).map((line) => JSON.parse(line)) : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function readJsonFile(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
}

async function readEnvValue(file, key) {
  try {
    const text = await readFile(file, "utf8");
    const line = text.split(/\r?\n/).find((item) => item.trim().startsWith(`${key}=`));
    return line ? line.slice(line.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "") : "";
  } catch {
    return "";
  }
}

function send(res, status, body) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  });
  res.end(body === null ? "" : JSON.stringify(body));
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, shell: process.platform === "win32" });
    let output = "";
    child.stdout.on("data", (chunk) => output += chunk);
    child.stderr.on("data", (chunk) => output += chunk);
    child.on("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(output.trim() || `${command} exited ${code}`)));
  });
}

function assert(value, message) {
  if (!value) throw new Error(message);
}
