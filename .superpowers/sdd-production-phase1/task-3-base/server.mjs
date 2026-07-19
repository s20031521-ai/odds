import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifySnapshot, summarizeSnapshotQuality } from "./shared/snapshot-policy.mjs";
import {
  buildBacktest,
  buildHealth,
  bucket,
  flattenLiveCache,
  groupSummary,
  mergeResults,
  mergeSnapshots,
  oddsScoreRows,
  selectBacktestResults,
  summarize,
} from "./server/domain/backtest.mjs";
import { liveOddsIdentity } from "./server/domain/identity.mjs";

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
let snapshotWrite = Promise.resolve();
let resultWrite = Promise.resolve();

if (process.argv.includes("--self-test")) {
  function validSnapshot(overrides = {}) {
    const snapshot = { odds: 2, chance: 0.55, savedAt: "2026-07-11T05:00:00Z", commenceTime: "2026-07-11T06:00:00Z", modelVersion: "self-test-v1", ...overrides };
    if (!Number.isFinite(Date.parse(snapshot.savedAt))) snapshot.savedAt = "2026-07-11T05:00:00Z";
    if (!Number.isFinite(Date.parse(snapshot.commenceTime))) snapshot.commenceTime = "2026-07-11T06:00:00Z";
    if (!Number.isFinite(snapshot.odds) || snapshot.odds <= 1) snapshot.odds = 2;
    if (!Number.isFinite(snapshot.chance)) snapshot.chance = 0.55;
    if (!snapshot.modelVersion) snapshot.modelVersion = "self-test-v1";
    return snapshot;
  }
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
  ].map(validSnapshot);
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
  assert(readiness.priced === 3 && readiness.chanceCount === 3, "tracks completeness health for valid snapshots");
  assert(isIncomingPredictionSnapshot({ ...snapshots.at(-1), savedAt: "2026-07-11T07:00:00Z" }) === false, "rejects post-kick snapshots");
  const hdcBacktest = buildBacktest([
    { matchId: "hdc-half-win", market: "亞洲讓球", prediction: "主", line: -0.75, odds: 2, savedAt: "x" },
    { matchId: "hdc-half-loss", market: "亞洲讓球", prediction: "主", line: -0.25, odds: 2, savedAt: "x" },
    { matchId: "hdc-push", market: "亞洲讓球", prediction: "主", line: -1, odds: 2, savedAt: "x" },
    { matchId: "hdc-away", market: "亞洲讓球", prediction: "客", line: -0.25, odds: 2, savedAt: "x" },
  ].map(validSnapshot), [
    { matchId: "hdc-half-win", market: "亞洲讓球", actual: "2-1" },
    { matchId: "hdc-half-loss", market: "亞洲讓球", actual: "1-1" },
    { matchId: "hdc-push", market: "亞洲讓球", actual: "2-1" },
    { matchId: "hdc-away", market: "亞洲讓球", actual: "1-1" },
  ]);
  assert(hdcBacktest.rows.map((row) => row.settlement).join(",") === "half-win,half-loss,push,half-win", "settles HDC home and away quarter lines");
  const distinctRows = [
    { matchId: "distinct", market: "大細波", modelVersion: "totals-v1", prediction: "細", settlement: "loss", hit: false, odds: 2, edge: 0.04, savedAt: "2026-07-09T01:00:00Z", line: 2.5, chance: 0.44 },
    { matchId: "distinct", market: "大細波", modelVersion: "totals-v1", prediction: "大", settlement: "win", hit: true, odds: 2, edge: 0.08, savedAt: "2026-07-09T02:00:00Z", line: 3, chance: 0.81 },
  ];
  const distinctSummary = summarize(distinctRows);
  assert(distinctSummary.finished === 1 && distinctSummary.priced === 1 && distinctSummary.profit === 1 && distinctSummary.roi === 1, "summarizes one priced representative per match");
  assert(groupSummary(distinctRows, (row) => row.market)["大細波"].finished === 1, "groups distinct representatives by market");
  const distinctBuckets = groupSummary(distinctRows, (row) => bucket(row.chance));
  assert(Object.keys(distinctBuckets).join(",") === "80-85%" && distinctBuckets["80-85%"].finished === 1, "selects representatives before chance buckets");
  const merged = mergeSnapshots([snapshots[0]], [{ ...snapshots[0], odds: 9 }, snapshots[1]]);
  assert(merged.length === 2 && merged[0].odds === 2, "keeps first snapshot per versioned identity");
  assert(selectBacktestResults([{ matchId: "live" }], [{ matchId: "archive" }])[0].matchId === "archive", "prefers durable result archive");
  assert(mergeResults([{ matchId: "m", market: "亞洲讓球", actual: "1-0" }], [{ matchId: "m", market: "亞洲讓球", actual: "2-0" }])[0].actual === "2-0", "background result overrides duplicate archive identity");
  const scoreRows = oddsScoreRows([{ id: "odds-1", completed: true, commence_time: "2026-07-11T00:00:00Z", home_team: "A", away_team: "B", scores: [{ name: "A", score: "2" }, { name: "B", score: "1" }] }]);
  assert(scoreRows[0].actual === "2-1" && scoreRows[0].matchId === "odds-1", "converts The Odds API scores into HDC results");
  assert(scoreRows[1].actual === "3 球", "converts The Odds API scores into totals results");
  const scoreBacktest = buildBacktest([validSnapshot({ matchId: "odds-1", market: "大細波", prediction: "大", line: 2.5 })], scoreRows);
  assert(scoreBacktest.rows.find((row) => row.market === "大細波")?.settlement === "win", "settles imported totals from summed goals");
  assert(scoreRows.map((row) => row.market).join(",") === "亞洲讓球,大細波", "one score settles both focused goal markets");
  const live = flattenLiveCache({ soccer_test: { h2hEntries: [{ id: "h2h" }], handicapEntries: [{ id: "hdc" }], totalEntries: [{ id: "totals" }], cornerEntries: [{ id: "corners" }] } });
  assert(live.h2hEntries[0].id === "h2h" && live.handicapEntries[0].id === "hdc" && live.totalEntries[0].id === "totals" && live.cornerEntries[0].id === "corners", "exposes all source-neutral cached markets");
  const freshHealth = buildHealth({ collector: "2026-07-11T11:40:00Z", hkjc: "2026-07-11T11:50:00Z" }, Date.parse("2026-07-11T12:00:00Z"));
  assert(freshHealth.ok && freshHealth.dataFresh && freshHealth.staleSources.length === 0, "reports fresh data sources");
  const staleHealth = buildHealth({ collector: "2026-07-11T10:00:00Z" }, Date.parse("2026-07-11T12:00:00Z"));
  assert(staleHealth.ok && !staleHealth.dataFresh && staleHealth.staleSources.join(",") === "collector,hkjc", "reports stale and missing data sources without marking the server down");
  const validPolicySnapshot = { matchId: "quality-valid", market: "大細波", prediction: "大", line: 2.5, odds: 2, chance: 0.55, edge: 0.04, savedAt: "2026-07-11T10:00:00Z", commenceTime: "2026-07-11T11:00:00Z", modelVersion: "totals-loo-v1", source: "test" };
  assert(classifySnapshot({ ...validPolicySnapshot, commenceTime: undefined }).reason === "missing-commence-time", "classifies missing commence time");
  assert(classifySnapshot({ ...validPolicySnapshot, savedAt: validPolicySnapshot.commenceTime }).reason === "post-kickoff", "classifies post-kickoff snapshots");
  assert(classifySnapshot({ ...validPolicySnapshot, odds: 1 }).reason === "invalid-odds", "classifies invalid odds");
  assert(classifySnapshot({ ...validPolicySnapshot, chance: 2 }).reason === "invalid-chance", "classifies invalid chance");
  assert(classifySnapshot({ ...validPolicySnapshot, line: undefined }).reason === "missing-line", "classifies missing line");
  const incomingQuality = partitionIncomingSnapshots([validPolicySnapshot, { ...validPolicySnapshot, matchId: "quality-bad-odds", odds: 1 }]);
  assert(incomingQuality.snapshots.length === 1 && incomingQuality.rejectedByReason["invalid-odds"] === 1, "partially accepts writes and counts rejection reasons");
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
      const { snapshots, rejectedByReason } = partitionIncomingSnapshots(incoming);
      const rejected = incoming.length - snapshots.length;
      if (snapshots.length === 0) return send(res, 400, { error: "no valid prediction snapshots", saved: 0, rejected, rejectedByReason });
      const saved = await persistSnapshots(snapshots);
      return send(res, 200, { saved, rejected, rejectedByReason });
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

async function readHealth(now = Date.now()) {
  const [collector, hkjc] = await Promise.all([
    readJsonFile(collectorStatePath, {}),
    readJsonFile(hkjcPath, {}),
  ]);
  return buildHealth({ collector: collector.lastDiscoveryAt, hkjc: hkjc.generatedAt }, now);
}

function isIncomingPredictionSnapshot(item) {
  return classifySnapshot(item).status === "valid-current";
}

function partitionIncomingSnapshots(incoming) {
  const snapshots = [];
  const rejectedByReason = {};
  for (const item of incoming) {
    const classification = classifySnapshot(item);
    if (classification.status === "valid-current") snapshots.push(item);
    else {
      const reason = classification.reason ?? classification.status;
      rejectedByReason[reason] = (rejectedByReason[reason] ?? 0) + 1;
    }
  }
  return { snapshots, rejectedByReason };
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

function persistResults(incoming) {
  const write = resultWrite.then(async () => {
    const existing = await readJsonl(resultArchivePath);
    const byId = new Map(existing.map((item) => [liveOddsIdentity(item), item]));
    for (const item of incoming) byId.set(liveOddsIdentity(item), item);
    const merged = [...byId.values()];
    await mkdir(dataDir, { recursive: true });
    await writeFile(resultArchivePath, merged.map((item) => JSON.stringify(item)).join("\n") + (merged.length ? "\n" : ""));
    return merged.length - existing.length;
  });
  resultWrite = write.catch(() => {});
  return write;
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
