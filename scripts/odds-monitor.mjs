import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStorageBackend } from "./lib/storage-backend.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(root, "monitor.config.json");
const envPath = path.join(root, ".env.local");
const historyPath = path.join(root, "data", "odds-history.jsonl");

const MONITOR_PROVIDER = "odds-monitor";
const COMMENCE_EXPIRY_MS = 3 * 60 * 60_000;
const FALLBACK_EXPIRY_MS = 24 * 60 * 60_000;

let config;
let apiKey;
let store;
const lastAlerts = new Map();

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly && process.argv.includes("--self-test")) {
  runSelfTest();
  process.exit(0);
}

if (invokedDirectly) {
  await runMonitor();
}

async function runMonitor() {
  config = validateConfig(JSON.parse(await readFile(configPath, "utf8")));
  const env = await readEnv(envPath);
  apiKey = env.ODDS_API_KEY;

  if (!apiKey) {
    throw new Error("Missing ODDS_API_KEY in .env.local");
  }

  const once = process.argv.includes("--once");
  const storage = await createStorageBackend(process.env);
  store = storage.backend === "postgres" ? createPostgresHistoryStore(storage.sink) : createFileHistoryStore();

  try {
    await checkOdds();
    if (!once) {
      setInterval(checkOdds, config.pollSeconds * 1000);
    }
  } finally {
    if (once) {
      await storage.close();
    }
  }
}

async function checkOdds() {
  const url = new URL(`https://api.the-odds-api.com/v4/sports/${config.sportKey}/odds`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("regions", config.regions);
  url.searchParams.set("markets", config.markets);
  url.searchParams.set("oddsFormat", config.oddsFormat);
  url.searchParams.set("dateFormat", "iso");

  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    console.error(`[odds-monitor] network error: ${error.message}`);
    return;
  }
  const quota = {
    remaining: response.headers.get("x-requests-remaining"),
    used: response.headers.get("x-requests-used"),
    last: response.headers.get("x-requests-last"),
  };

  if (!response.ok) {
    const body = await response.text();
    console.error(`[odds-monitor] API ${response.status}: ${body}`);
    return;
  }

  const events = await response.json();
  const now = new Date();
  await store.writeSnapshots(collectSnapshots(events, now, config.markets));
  for (const rule of config.watchlist) {
    const event = events.find((item) => sameMatch(item, rule));
    if (!event) {
      continue;
    }

    for (const hit of matchingPrices(event, rule)) {
      if (!passes(hit.price, rule.operator, rule.targetPrice) || inCooldown(rule.id, hit.bookmaker, now)) {
        continue;
      }

      const alert = {
        type: "odds_alert",
        ruleId: rule.id,
        match: `${event.home_team} vs ${event.away_team}`,
        commenceTime: event.commence_time,
        market: rule.market,
        side: rule.side,
        point: rule.point,
        bookmaker: hit.bookmaker,
        price: hit.price,
        targetPrice: rule.targetPrice,
        operator: rule.operator,
        quota,
        createdAt: now.toISOString(),
        message: `${event.home_team} vs ${event.away_team} ${rule.side} ${rule.point} is ${hit.price} at ${hit.bookmaker}`,
      };

      await writeAlert(alert);
      lastAlerts.set(cooldownKey(rule.id, hit.bookmaker), now.getTime());
      console.log(`[odds-monitor] alert: ${alert.message}`);
    }
  }
}

function collectSnapshots(events, now, markets) {
  const wantedMarkets = new Set(String(markets).split(",").map((item) => item.trim()).filter(Boolean));
  return (Array.isArray(events) ? events : []).flatMap((event) =>
    (event.bookmakers ?? []).flatMap((bookmaker) =>
      (bookmaker.markets ?? [])
        .filter((market) => wantedMarkets.has(market.key))
        .flatMap((market) =>
          (market.outcomes ?? []).map((outcome) => ({
            timestamp: now.toISOString(),
            matchId: event.id,
            commenceTime: event.commence_time,
            homeTeam: event.home_team,
            awayTeam: event.away_team,
            bookmaker: bookmaker.title,
            market: market.key,
            side: outcome.name,
            point: Number(outcome.point),
            price: Number(outcome.price),
          })),
        ),
    ),
  ).filter((item) => item.matchId && item.bookmaker && Number.isFinite(item.price));
}

// File-mode store: appends history snapshots to data/odds-history.jsonl exactly as before.
export function createFileHistoryStore() {
  return {
    backend: "file",
    async writeSnapshots(snapshots) {
      if (snapshots.length === 0) {
        return;
      }
      await mkdir(path.dirname(historyPath), { recursive: true });
      await appendFile(historyPath, `${snapshots.map((item) => JSON.stringify(item)).join("\n")}\n`);
    },
  };
}

// Postgres-mode store: persists snapshots as flat live-odds rows through the sink.
// Rows with a non-positive or non-finite price are skipped with a warning because
// the live_odds repository rejects them.
export function createPostgresHistoryStore(sink, { warn = console.warn } = {}) {
  return {
    backend: "postgres",
    async writeSnapshots(snapshots) {
      if (snapshots.length === 0) {
        return;
      }
      const observedAt = snapshots[0].timestamp ?? new Date().toISOString();
      const flat = [];
      for (const snapshot of snapshots) {
        const price = Number(snapshot.price);
        if (!Number.isFinite(price) || price <= 0) {
          warn(`[odds-monitor] skipping snapshot with invalid price: matchId=${snapshot.matchId} market=${snapshot.market} side=${snapshot.side} price=${snapshot.price}`);
          continue;
        }
        flat.push(snapshotToFlatEntry(snapshot, price, observedAt));
      }
      await sink.saveLiveOdds(MONITOR_PROVIDER, observedAt, flat);
    },
  };
}

export function snapshotToFlatEntry(snapshot, price = Number(snapshot.price), observedAt = snapshot.timestamp) {
  const commenceMs = Date.parse(snapshot.commenceTime ?? "");
  const observedMs = Date.parse(observedAt ?? "");
  const expiresAt = Number.isFinite(commenceMs)
    ? new Date(commenceMs + COMMENCE_EXPIRY_MS).toISOString()
    : new Date((Number.isFinite(observedMs) ? observedMs : Date.now()) + FALLBACK_EXPIRY_MS).toISOString();
  const point = Number(snapshot.point);
  return {
    id: [snapshot.matchId, snapshot.bookmaker, snapshot.market, snapshot.side, Number.isFinite(point) ? point : ""].join("|"),
    matchId: snapshot.matchId,
    homeTeam: snapshot.homeTeam,
    awayTeam: snapshot.awayTeam,
    commenceTime: snapshot.commenceTime,
    market: snapshot.market,
    selection: snapshot.side,
    line: Number.isFinite(point) ? point : undefined,
    odds: price,
    bookmaker: snapshot.bookmaker,
    expiresAt,
  };
}

function sameMatch(event, rule) {
  const names = [event.home_team, event.away_team].map((name) => name?.toLowerCase());
  return names.includes(rule.homeTeam.toLowerCase()) && names.includes(rule.awayTeam.toLowerCase());
}

function matchingPrices(event, rule) {
  return (event.bookmakers ?? []).flatMap((bookmaker) => {
    const market = (bookmaker.markets ?? []).find((item) => item.key === rule.market);
    return (market?.outcomes ?? [])
      .filter((outcome) => outcome.name === rule.side && Number(outcome.point) === Number(rule.point))
      .map((outcome) => ({ bookmaker: bookmaker.title, price: Number(outcome.price) }));
  });
}

function passes(price, operator, target) {
  return operator === ">=" ? price >= target : price <= target;
}

function validateConfig(value) {
  if (!value || typeof value !== "object") {
    throw new Error("monitor.config.json must be an object");
  }
  if (!Number.isFinite(value.pollSeconds) || value.pollSeconds <= 0) {
    throw new Error("monitor.config.json pollSeconds must be a positive number");
  }
  if (!Array.isArray(value.watchlist)) {
    throw new Error("monitor.config.json watchlist must be an array");
  }
  for (const rule of value.watchlist) {
    if (!rule || typeof rule !== "object" || ![">=", "<="].includes(rule.operator)) {
      throw new Error("monitor.config.json watchlist rules need operator >= or <=");
    }
  }
  return value;
}

function inCooldown(ruleId, bookmaker, now) {
  const last = lastAlerts.get(cooldownKey(ruleId, bookmaker));
  return last ? now.getTime() - last < config.cooldownMinutes * 60 * 1000 : false;
}

function cooldownKey(ruleId, bookmaker) {
  return `${ruleId}:${bookmaker}`;
}

async function writeAlert(alert) {
  const inbox = path.resolve(root, config.inboxDir);
  await mkdir(inbox, { recursive: true });
  const safeTime = alert.createdAt.replace(/[:.]/g, "-");
  await writeFile(path.join(inbox, `${safeTime}-${alert.ruleId}.json`), JSON.stringify(alert, null, 2));
}

async function readEnv(file) {
  const text = await readFile(file, "utf8").catch(() => "");
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

function runSelfTest() {
  validateConfig({ pollSeconds: 1, watchlist: [{ operator: ">=" }] });
  assertThrows(() => validateConfig({ pollSeconds: 0, watchlist: [] }), "pollSeconds");
  assertThrows(() => validateConfig({ pollSeconds: 1, watchlist: "bad" }), "watchlist");
  assertThrows(() => validateConfig({ pollSeconds: 1, watchlist: [{ operator: ">" }] }), "operator");
  const snapshots = collectSnapshots(
    [
      {
        id: "event-1",
        commence_time: "2026-07-08T12:00:00Z",
        home_team: "Home",
        away_team: "Away",
        bookmakers: [
          {
            title: "Book",
            markets: [
              { key: "totals", outcomes: [{ name: "Over", point: 2.5, price: 1.91 }, { name: "Under", point: 2.5, price: 1.95 }] },
              { key: "h2h", outcomes: [{ name: "Home", price: 2.1 }] },
            ],
          },
        ],
      },
    ],
    new Date("2026-07-08T13:00:00Z"),
    "totals",
  );
  assert(snapshots.length === 2, "stores one snapshot per totals side");
  assert(snapshots[0].matchId === "event-1" && snapshots[0].point === 2.5, "maps totals snapshot fields");
  console.log("[odds-monitor] self-test passed");
}

function assert(value, message) {
  if (!value) {
    throw new Error(message);
  }
}

function assertThrows(callback, message) {
  try {
    callback();
  } catch (error) {
    if (error.message.includes(message)) {
      return;
    }
    throw error;
  }
  throw new Error(`Expected validation error containing ${message}`);
}
