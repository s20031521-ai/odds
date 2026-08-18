#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { createStorageBackend } from "./lib/storage-backend.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const STATE_PATH = path.join(DATA, "hdc-collector-state.json");
const LOCK_PATH = path.join(DATA, "hdc-collector.lock");
const RESULT_PATH = path.join(DATA, "background-result-archive.jsonl");
const LIVE_PATH = path.join(DATA, "background-hdc-odds.json");
const API = "https://api.the-odds-api.com/v4";
const MIN_QUOTA = 50;
const DISCOVERY_MS = 15 * 60_000;
const ODDS_WINDOW_MS = 25 * 60_000;
const ODDS_NEAR_MS = 5 * 60_000;
const SCORE_DELAY_MS = 180 * 60_000;
const SCORE_RETRY_MS = 12 * 60 * 60_000;
const RATE_LIMIT_COOLDOWN_MS = 15 * 60_000;
const LOCK_STALE_MS = 30 * 60_000;
// Weekly key rotation: anchor is a Monday 00:00 local time. The active key is
// ODDS_API_KEYS[weekNumber % keyCount]; a new week always resets any failover
// offset and the cached quota figure (quota is per key).
const KEY_ROTATION_ANCHOR = "2026-08-17T00:00:00";
const KEY_ROTATE_THRESHOLD = 80;
const WEEK_MS = 7 * 24 * 60 * 60_000;
export function rotationWeek(now = new Date()) {
  return Math.floor((now.getTime() - Date.parse(KEY_ROTATION_ANCHOR)) / WEEK_MS);
}
export function weeklyKeyIndex(keyCount, now = new Date()) {
  if (!keyCount) return 0;
  const week = Math.max(0, rotationWeek(now));
  return ((week % keyCount) + keyCount) % keyCount;
}
// Rotates weekly (Monday 00:00 local) and fails over to the next key when the
// current one reports quotaRemaining <= KEY_ROTATE_THRESHOLD. Switching keys
// clears quotaRemaining so the fresh key is allowed to spend.
export function resolveKeyIndex(keys, state, now = new Date()) {
  if (!keys.length) return { index: 0, rotated: false, state };
  const week = rotationWeek(now);
  if (state.keyRotation?.week !== week) {
    state.keyRotation = { week, offset: 0 };
    state.quotaRemaining = null;
  }
  const base = weeklyKeyIndex(keys.length, now);
  let offset = state.keyRotation.offset ?? 0;
  let rotated = false;
  if (keys.length > 1 && offset < keys.length - 1 && state.quotaRemaining != null && Number(state.quotaRemaining) <= KEY_ROTATE_THRESHOLD) {
    offset += 1;
    state.keyRotation.offset = offset;
    state.quotaRemaining = null;
    rotated = true;
  }
  return { index: (base + offset) % keys.length, rotated, state };
}
export function activeSoccerKeys(sports) {
  return (Array.isArray(sports) ? sports : [])
    .filter((sport) => sport?.active === true && sport?.group === "Soccer" && sport?.has_outrights !== true && !String(sport?.key ?? "").endsWith("_winner"))
    .map((sport) => sport.key);
}

const nowMs = () => Date.now();
const formatApiTime = (value) => new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");
const elapsed = (last, now, interval) => !last || now - Date.parse(last) >= interval;
const eventTime = (event) => Date.parse(event.commence_time ?? event.commenceTime ?? "");
export function shouldRecoverLock(info, stat, now = Date.now(), isAlive = isProcessAlive) {
  const pid = Number(info?.pid);
  if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) return false;
  const createdAt = Date.parse(info?.createdAt ?? "");
  const lockTime = Number.isFinite(createdAt) ? createdAt : Number(stat?.mtimeMs);
  return Number.isFinite(lockTime) && now - lockTime > LOCK_STALE_MS;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function acquireCollectorLock() {
  await fs.mkdir(DATA, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const lock = await fs.open(LOCK_PATH, "wx");
      await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }) + "\n", "utf8");
      return lock;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const [info, stat] = await Promise.all([
        fs.readFile(LOCK_PATH, "utf8").then(JSON.parse).catch(() => ({})),
        fs.stat(LOCK_PATH).catch(() => null),
      ]);
      if (!shouldRecoverLock(info, stat)) return null;
      await fs.rm(LOCK_PATH, { force: true });
    }
  }
  return null;
}

export const shouldDiscover = (state, now) => elapsed(state.lastDiscoveryAt, now, DISCOVERY_MS);
export const dueOddsSports = (state, now, { nearPoll = false } = {}) => Object.entries(state.events ?? {}).flatMap(([sport, events]) => {
  const last = Date.parse(state.lastOddsAt?.[sport] ?? "");
  const due = events.some((event) => {
    const kickoff = eventTime(event);
    const delta = kickoff - now;
    if (delta > ODDS_NEAR_MS && delta <= ODDS_WINDOW_MS) return !Number.isFinite(last) || last < kickoff - ODDS_WINDOW_MS;
    if (nearPoll && delta > 0 && delta <= ODDS_NEAR_MS) return !Number.isFinite(last) || last < kickoff - ODDS_NEAR_MS;
    return false;
  });
  return due ? [sport] : [];
});
export const dueScoreSports = (state, now) => Object.entries(state.events ?? {}).flatMap(([sport, events]) => {
  const unresolved = events.some((event) => {
    const age = now - eventTime(event);
    return age >= SCORE_DELAY_MS && age <= 3 * 24 * 60 * 60_000 && !state.completedIds?.includes(event.id);
  });
  return unresolved && elapsed(state.lastScoresAt?.[sport], now, SCORE_RETRY_MS) ? [sport] : [];
});
const resultKey = (row) => `${row.matchId}|${row.market}`;
// Best-effort league attachment: discovered events carry sport_title (e.g. "EPL");
// live entries are matched by event id. Missing data leaves entries untouched.
export function withLeague(entries, events) {
  const titles = new Map((Array.isArray(events) ? events : []).flatMap((event) =>
    event?.id && typeof event?.sport_title === "string" && event.sport_title ? [[event.id, event.sport_title]] : []));
  return (Array.isArray(entries) ? entries : []).map((entry) =>
    entry?.league || !entry?.matchId || !titles.has(entry.matchId) ? entry : { ...entry, league: titles.get(entry.matchId) });
}
export function mergeImmutable(current, incoming, keyOf) {
  const map = new Map(current.map((row) => [keyOf(row), row]));
  for (const row of incoming) if (!map.has(keyOf(row))) map.set(keyOf(row), row);
  return [...map.values()];
}

function assert(condition, message) { if (!condition) throw new Error(message); }
function selfTest() {
  const now = Date.parse("2026-07-11T12:00:00Z");
  assert(shouldDiscover({}, now), "initial discovery");
  assert(!shouldDiscover({ lastDiscoveryAt: new Date(now - 14 * 60_000).toISOString() }, now), "15m discovery cooldown");
  const base = { events: { epl: [{ id: "1", commence_time: new Date(now + 24 * 60_000).toISOString() }] }, lastOddsAt: {} };
  assert(dueOddsSports(base, now)[0] === "epl", "first odds poll inside the 25m window");
  assert(dueOddsSports({ events: { epl: [{ id: "1", commence_time: new Date(now + 29 * 60_000).toISOString() }] }, lastOddsAt: {} }, now).length === 0, "does not poll before the 25m window");
  assert(dueOddsSports({ ...base, lastOddsAt: { epl: new Date(now - 1 * 60_000).toISOString() } }, now).length === 0, "does not repeat the early odds poll");
  const near = { events: { epl: [{ id: "1", commence_time: new Date(now + 4 * 60_000).toISOString() }] }, lastOddsAt: { epl: new Date(now - 16 * 60_000).toISOString() } };
  assert(dueOddsSports(near, now).length === 0, "skips the final 5m poll by default");
  assert(dueOddsSports(near, now, { nearPoll: true })[0] === "epl", "opt-in final 5m poll via HDC_NEAR_POLL=1");
  const scoreState = { events: { epl: [{ id: "1", commence_time: new Date(now - 181 * 60_000).toISOString() }] }, completedIds: [], lastScoresAt: {} };
  assert(dueScoreSports(scoreState, now)[0] === "epl", "starts score checks after 180m");
  assert(dueScoreSports({ ...scoreState, lastScoresAt: { epl: new Date(now - 11 * 60 * 60_000).toISOString() } }, now).length === 0, "waits 12h before score retry");
  assert(!paidAllowed({ quotaRemaining: 50 }, now), "keeps fifty credits in reserve");
  assert(!paidAllowed({ quotaRemaining: 257, quotaBlockedUntil: now + 60_000 }, now), "honors provider cooldown");
  assert(scoreRows([{ id: "1", completed: true, commence_time: "x", home_team: "A", away_team: "B", scores: [{ name: "A", score: "2" }, { name: "B", score: "1" }] }], "epl").map((row) => row.market).join(",") === "h2h,亞洲讓球,大細波", "one score settles H2H, HDC and totals");
  assert(!paidAllowed({ quotaRemaining: MIN_QUOTA }), "quota stop");
  assert(activeSoccerKeys([
    { key: "soccer_brazil_campeonato", group: "Soccer", active: true, has_outrights: false },
    { key: "soccer_fifa_world_cup_winner", group: "Soccer", active: true, has_outrights: true },
    { key: "basketball_nba", group: "Basketball", active: true, has_outrights: false },
    { key: "soccer_inactive", group: "Soccer", active: false, has_outrights: false },
  ]).join(",") === "soccer_brazil_campeonato", "discovers active soccer event markets without a hard-coded league list");
  assert(formatApiTime(Date.parse("2026-07-12T13:30:45.678Z")) === "2026-07-12T13:30:45Z", "formats provider time without rejected milliseconds");
  assert(dueCornerEvents([{ id: "in", commence_time: new Date(now + 10 * 60_000).toISOString() }, { id: "out", commence_time: new Date(now + 30 * 60_000).toISOString() }], now).map((event) => event.id).join() === "in", "selects corner events from current odds payload");
  assert(shouldRecoverLock({ createdAt: new Date(now - 31 * 60_000).toISOString() }, { mtimeMs: now - 31 * 60_000 }, now, () => false), "recovers an old lock whose owner is gone");
  assert(!shouldRecoverLock({ pid: 123, createdAt: new Date(now - 31 * 60_000).toISOString() }, { mtimeMs: now - 31 * 60_000 }, now, () => true), "never steals a lock from a live owner");
  const leagueEntries = withLeague([{ matchId: "1", homeTeam: "A" }, { matchId: "2", homeTeam: "B" }], [{ id: "1", sport_title: "EPL" }, { id: "2" }]);
  assert(leagueEntries[0].league === "EPL" && !("league" in leagueEntries[1]), "attaches the discovered sport_title as league by event id");
  assert(withLeague([{ matchId: "1", league: "Liga MX" }], [{ id: "1", sport_title: "EPL" }])[0].league === "Liga MX", "never overwrites an existing league");
  assert(withLeague(null, null).length === 0, "tolerates missing entries and events");
  const flatLeague = flattenSportEntries({ h2hEntries: [{ id: "m1-bk", matchId: "m1", homeTeam: "H", awayTeam: "A", commenceTime: "2026-07-12T13:00:00Z", bookmaker: "Book", league: "Liga MX", odds: { home: 2, draw: 3, away: 4 } }] });
  assert(flatLeague.length === 3 && flatLeague.every((row) => row.league === "Liga MX"), "passes league through the sport flattening");
  assert(flattenSportEntries({ h2hEntries: [{ id: "m2-bk", matchId: "m2", homeTeam: "H", awayTeam: "A", commenceTime: "2026-07-12T13:00:00Z", bookmaker: "Book", odds: { home: 2, draw: 3, away: 4 } }] }).every((row) => !("league" in row)), "omits league from flattened rows without league data");
  assert(weeklyKeyIndex(4, new Date("2026-08-16T23:59:59")) === 0, "before the anchor Monday still uses key 1");
  assert(weeklyKeyIndex(4, new Date("2026-08-17T00:00:00")) === 0, "week 1 uses key 1");
  assert(weeklyKeyIndex(4, new Date("2026-08-23T23:59:59")) === 0, "stays on key 1 all week");
  assert(weeklyKeyIndex(4, new Date("2026-08-24T00:00:00")) === 1, "Monday 00:00 switches to key 2");
  assert(weeklyKeyIndex(4, new Date("2026-09-14T12:00:00")) === 0, "four keys cycle back after four weeks");
  assert(weeklyKeyIndex(1, new Date("2026-08-24T00:00:00")) === 0, "single key never rotates");
  const failState = { keyRotation: { week: rotationWeek(new Date("2026-08-17T09:00:00")), offset: 0 }, quotaRemaining: 70 };
  const fail = resolveKeyIndex(["a", "b"], failState, new Date("2026-08-17T09:00:00"));
  assert(fail.index === 1 && fail.rotated && failState.quotaRemaining === null, "low quota fails over and clears cached quota");
  const freshWeek = resolveKeyIndex(["a", "b"], { keyRotation: { week: 0, offset: 1 }, quotaRemaining: 30 }, new Date("2026-09-14T12:00:00"));
  assert(freshWeek.index === 0 && !freshWeek.rotated && freshWeek.state.keyRotation.offset === 0, "a new week resets failover back to the scheduled key");
  const corners = [{ id: "p", home_team: "Aberdeen", away_team: "X" }, { id: "q", home_team: "Y", away_team: "Z" }];
  assert(priorityCornerEvents(corners, new Set(["aberdeen"])).map((event) => event.id).join() === "p", "corner calls gated to priority teams, case-insensitive");
  assert(priorityCornerEvents(corners, new Set()).length === 2, "empty priority set keeps legacy all-corners behavior");
  console.log("[hdc-collector] self-test passed");
}

function paidAllowed(state, now = Date.now()) {
  const hasQuota = state.quotaRemaining == null || Number(state.quotaRemaining) > MIN_QUOTA;
  const cooldownEnded = !state.quotaBlockedUntil || now >= Date.parse(state.quotaBlockedUntil);
  return hasQuota && cooldownEnded;
}
async function readKeys() {
  let text = "";
  try { text = await fs.readFile(path.join(ROOT, ".env.local"), "utf8"); } catch {}
  const values = Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, "")]] : [];
  }));
  const keys = String(process.env.ODDS_API_KEYS || values.ODDS_API_KEYS || "")
    .split(",").map((key) => key.trim()).filter(Boolean);
  const single = process.env.ODDS_API_KEY || values.ODDS_API_KEY;
  if (!keys.length && single) keys.push(single);
  return keys;
}
async function readJson(file, fallback) { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; } }
async function readJsonl(file) { try { return (await fs.readFile(file, "utf8")).split(/\r?\n/).filter(Boolean).map(JSON.parse); } catch { return []; } }
async function writeAtomic(file, content) { const tmp = `${file}.${process.pid}.tmp`; await fs.writeFile(tmp, content, "utf8"); await fs.rename(tmp, file); }
async function writeJsonl(file, rows) { await writeAtomic(file, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "")); }
async function fetchJson(url, key, state, store) {
  const target = new URL(url);
  target.searchParams.set("apiKey", key);
  const response = await fetch(target);
  const remaining = response.headers.get("x-requests-remaining");
  if (remaining != null) state.quotaRemaining = Number(remaining);
  const used = response.headers.get("x-requests-used");
  if (used != null) state.quotaUsed = Number(used);
  const last = response.headers.get("x-requests-last");
  if (last != null) state.quotaLastCost = Number(last);
  if (response.status === 429) {
    state.quotaBlockedUntil = new Date(Date.now() + RATE_LIMIT_COOLDOWN_MS).toISOString();
    await store.saveState(state);
  }
  if (!response.ok) throw new Error(`The Odds API ${response.status} at ${target.pathname}`);
  return response.json();
}

async function discover(key, state, store, now) {
  const sports = await fetchJson(`${API}/sports`, key, state, store);
  const tracked = activeSoccerKeys(sports);
  const pairs = [];
  for (const sport of tracked) pairs.push([sport, await fetchJson(`${API}/sports/${sport}/events`, key, state, store)]);
  state.events = Object.fromEntries(pairs);
  state.lastDiscoveryAt = new Date(now).toISOString();
  return tracked;
}
export function scoreRows(payload, sport) {
  return (Array.isArray(payload) ? payload : []).flatMap((event) => {
    const provider = `the-odds-api:${sport}`;
    if (isVoidStatus(event?.status)) {
      const base = {
        matchId: event.id,
        homeTeam: event.home_team,
        awayTeam: event.away_team,
        commenceTime: event.commence_time,
        actual: "void",
        status: "void",
        settlement: "void",
        source: provider,
        provider,
      };
      return [
        { ...base, id: `${event.id}-odds-h2h-void`, market: "h2h" },
        { ...base, id: `${event.id}-odds-hdc-void`, market: "亞洲讓球" },
        { ...base, id: `${event.id}-odds-totals-void`, market: "大細波" },
      ];
    }
    if (!event.completed || !Array.isArray(event.scores)) return [];
    const home = Number(event.scores.find((score) => score.name === event.home_team)?.score);
    const away = Number(event.scores.find((score) => score.name === event.away_team)?.score);
    if (!Number.isFinite(home) || !Number.isFinite(away)) return [];
    const base = { matchId: event.id, homeScore: home, awayScore: away, actual: `${home}-${away}`, commenceTime: event.commence_time, source: provider, provider };
    return [
      { ...base, id: `${event.id}-odds-h2h-result`, market: "h2h" },
      { ...base, id: `${event.id}-odds-hdc-result`, market: "亞洲讓球" },
      { ...base, id: `${event.id}-odds-totals-result`, market: "大細波", actual: `${home + away} 球` },
    ];
  });
}
function isVoidStatus(value) {
  return ["cancelled", "canceled", "abandoned", "void"].includes(String(value ?? "").trim().toLowerCase());
}
function dueCornerEvents(payload, now) {
  return (Array.isArray(payload) ? payload : []).filter((event) => {
    const time = eventTime(event);
    return time >= now && time <= now + ODDS_WINDOW_MS;
  });
}
// Corner calls cost 1 credit per event per poll round, so they are gated by
// the priority team list. An empty set means "no gating" (legacy behavior).
const normalizeTeamName = (value) => String(value ?? "").trim().toLowerCase();
export function priorityCornerEvents(events, priority) {
  if (!priority || !priority.size) return Array.isArray(events) ? events : [];
  return (Array.isArray(events) ? events : []).filter((event) =>
    priority.has(normalizeTeamName(event?.home_team)) || priority.has(normalizeTeamName(event?.away_team)));
}
async function loadPriorityTeams() {
  const list = await readJson(path.join(DATA, "priority-teams.json"), []);
  return new Set((Array.isArray(list) ? list : []).map(normalizeTeamName).filter(Boolean));
}

async function collectOdds(sports, key, state, store, now, priority) {
  if (!sports.length || !paidAllowed(state, now)) return { entriesBySport: {} };
  const vite = await createViteServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { parseOddsApiCorners, parseOddsApiEvents, parseOddsApiHandicaps, parseOddsApiTotals } = await vite.ssrLoadModule("/src/oddsApi.ts");
    const entriesBySport = {};
    for (const sport of sports) {
      if (!paidAllowed(state, now)) break;
      const url = new URL(`${API}/sports/${sport}/odds`);
      url.searchParams.set("regions", "us"); url.searchParams.set("markets", "h2h,spreads,totals"); url.searchParams.set("oddsFormat", "decimal");
      url.searchParams.set("commenceTimeFrom", formatApiTime(now));
      url.searchParams.set("commenceTimeTo", formatApiTime(now + ODDS_WINDOW_MS));
      const payload = await fetchJson(url, key, state, store);
      state.lastOddsAt[sport] = new Date(now).toISOString();
      const h2hEntries = parseOddsApiEvents(payload);
      const handicapEntries = parseOddsApiHandicaps(payload);
      const totalEntries = parseOddsApiTotals(payload);
      const cornerEntries = [];
      for (const event of priorityCornerEvents(dueCornerEvents(payload, now), priority)) {
        if (!paidAllowed(state, now)) break;
        const cornerUrl = new URL(`${API}/sports/${sport}/events/${event.id}/odds`);
        cornerUrl.searchParams.set("regions", "eu"); cornerUrl.searchParams.set("markets", "alternate_totals_corners"); cornerUrl.searchParams.set("oddsFormat", "decimal");
        cornerEntries.push(...parseOddsApiCorners(await fetchJson(cornerUrl, key, state, store)));
      }
      entriesBySport[sport] = {
        updatedAt: new Date(now).toISOString(),
        h2hEntries: withLeague(h2hEntries, state.events?.[sport]),
        handicapEntries: withLeague(handicapEntries, state.events?.[sport]),
        totalEntries: withLeague(totalEntries, state.events?.[sport]),
        cornerEntries: withLeague(cornerEntries, state.events?.[sport]),
      };
    }
    return { entriesBySport };
  } finally { await vite.close(); }
}
async function collectScores(sports, key, state, store, now) {
  const rows = [];
  for (const sport of sports) {
    if (!paidAllowed(state, now)) break;
    const payload = await fetchJson(`${API}/sports/${sport}/scores?daysFrom=3`, key, state, store);
    state.lastScoresAt[sport] = new Date(now).toISOString();
    const converted = scoreRows(payload, sport);
    rows.push(...converted);
    state.completedIds = [...new Set([...state.completedIds, ...converted.map((row) => row.matchId)])];
  }
  return rows;
}

const LIVE_EXPIRY_MS = 3 * 60 * 60_000;
const DEFAULT_STATE = () => ({ events: {}, lastOddsAt: {}, lastScoresAt: {}, completedIds: [] });

// File-mode store: preserves the legacy JSON/JSONL persistence byte-for-byte.
export function createFileStore() {
  return {
    backend: "file",
    async acquireLock(callback) {
      const lock = await acquireCollectorLock();
      if (!lock) return "busy";
      try {
        await callback();
        return "ran";
      } finally {
        await lock.close();
        await fs.rm(LOCK_PATH, { force: true });
      }
    },
    async loadState() {
      return readJson(STATE_PATH, DEFAULT_STATE());
    },
    async saveState(state) {
      await writeAtomic(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
    },
    async saveResults(rows) {
      const old = await readJsonl(RESULT_PATH);
      await writeJsonl(RESULT_PATH, mergeImmutable(old, rows, resultKey));
    },
    async saveLive(entriesBySport, now) {
      const live = await readJson(LIVE_PATH, {});
      Object.assign(live, entriesBySport);
      for (const [sport, cached] of Object.entries(live)) {
        cached.h2hEntries = (cached.h2hEntries ?? []).filter((entry) => Date.parse(entry.commenceTime) >= now - 3 * 60 * 60_000);
        cached.handicapEntries = (cached.handicapEntries ?? cached.entries ?? []).filter((entry) => Date.parse(entry.commenceTime) >= now - 3 * 60 * 60_000);
        cached.totalEntries = (cached.totalEntries ?? []).filter((entry) => Date.parse(entry.commenceTime) >= now - 3 * 60 * 60_000);
        cached.cornerEntries = (cached.cornerEntries ?? []).filter((entry) => Date.parse(entry.commenceTime) >= now - 3 * 60 * 60_000);
        delete cached.entries;
        if (!cached.h2hEntries.length && !cached.handicapEntries.length && !cached.totalEntries.length && !cached.cornerEntries.length && now - Date.parse(cached.updatedAt) > 24 * 60 * 60_000) delete live[sport];
      }
      await writeAtomic(LIVE_PATH, JSON.stringify(live, null, 2) + "\n");
    },
  };
}

// Postgres-mode store: persists exclusively through the sink; writes no files.
export function createPostgresStore(sink) {
  return {
    backend: "postgres",
    acquireLock: (callback) => sink.acquireCollectorLock("hdc-collector", callback),
    async loadState() {
      return (await sink.loadCollectorState("hdc-collector")) ?? DEFAULT_STATE();
    },
    saveState: (state) => sink.saveCollectorState("hdc-collector", state),
    saveResults: (rows) => sink.saveResults(rows),
    async saveLive(entriesBySport, now) {
      for (const [sport, bundle] of Object.entries(entriesBySport)) {
        const observedAt = bundle?.updatedAt ?? new Date(now).toISOString();
        await sink.saveLiveOdds(`the-odds-api:${sport}`, observedAt, flattenSportEntries(bundle));
      }
    },
  };
}

// Flattens one sport's { h2hEntries, handicapEntries, totalEntries, cornerEntries }
// bundle into the flat live-odds entry contract consumed by the repositories and
// the frontend normalizeLiveOddsPayload. The original entry travels under `raw`.
export function flattenSportEntries(bundle) {
  const flat = [];
  const base = (entry) => ({
    matchId: entry.matchId,
    homeTeam: entry.homeTeam,
    awayTeam: entry.awayTeam,
    commenceTime: entry.commenceTime,
    bookmaker: entry.bookmaker,
    expiresAt: new Date(Date.parse(entry.commenceTime) + LIVE_EXPIRY_MS).toISOString(),
    ...(entry.league ? { league: entry.league } : {}),
    raw: entry,
  });
  for (const entry of bundle?.h2hEntries ?? []) {
    for (const selection of ["home", "draw", "away"]) {
      flat.push({ ...base(entry), id: `${entry.id}:${selection}`, market: "h2h", selection, odds: entry.odds?.[selection] });
    }
  }
  for (const entry of bundle?.handicapEntries ?? []) {
    flat.push({ ...base(entry), id: `${entry.id}:home`, market: "spreads", selection: "home", line: entry.line, odds: entry.homeOdds });
    flat.push({ ...base(entry), id: `${entry.id}:away`, market: "spreads", selection: "away", line: entry.line, odds: entry.awayOdds });
  }
  for (const entry of bundle?.totalEntries ?? []) {
    flat.push({ ...base(entry), id: `${entry.id}:over`, market: "totals", selection: "over", line: entry.line, odds: entry.overOdds });
    flat.push({ ...base(entry), id: `${entry.id}:under`, market: "totals", selection: "under", line: entry.line, odds: entry.underOdds });
  }
  for (const entry of bundle?.cornerEntries ?? []) {
    flat.push({ ...base(entry), id: `${entry.id}:over`, market: "alternate_totals_corners", selection: "over", line: entry.line, odds: entry.overOdds });
    flat.push({ ...base(entry), id: `${entry.id}:under`, market: "alternate_totals_corners", selection: "under", line: entry.line, odds: entry.underOdds });
  }
  return flat;
}

async function main({ dryRun = false, store } = {}) {
  store ??= createFileStore();
  const keys = await readKeys();
  if (!keys.length) throw new Error("ODDS_API_KEY is missing");
  await fs.mkdir(DATA, { recursive: true });
  const state = await store.loadState();
  state.lastOddsAt ??= {}; state.lastScoresAt ??= {}; state.completedIds ??= [];
  const now = nowMs();
  const selection = resolveKeyIndex(keys, state, new Date(now));
  const key = keys[selection.index];
  const keyLabel = `key ${selection.index + 1}/${keys.length}`;
  if (selection.rotated) console.log(`[hdc-collector] quota low, failing over to ${keyLabel}`);
  // Near-window (5-min) poll is off by default; set HDC_NEAR_POLL=1 to re-enable.
  const nearPoll = process.env.HDC_NEAR_POLL === "1";
  // Corner calls are gated by data/priority-teams.json; set HDC_CORNER_ALL=1 to
  // call corners for every match (legacy behavior).
  const priority = process.env.HDC_CORNER_ALL === "1" ? new Set() : await loadPriorityTeams();
  let tracked = Object.keys(state.events ?? {});
  if (dryRun || shouldDiscover(state, now)) tracked = await discover(key, state, store, now);
  const oddsSports = dueOddsSports(state, now, { nearPoll });
  const scoreSports = dueScoreSports(state, now);
  if (dryRun) {
    console.log(JSON.stringify({ tracked, oddsSports, scoreSports, key: keyLabel, nearPoll, priorityTeams: priority.size, quotaRemaining: state.quotaRemaining ?? null }));
    return;
  }
  const { entriesBySport } = await collectOdds(oddsSports, key, state, store, now, priority);
  const results = await collectScores(scoreSports, key, state, store, now);
  await store.saveResults(results);
  await store.saveLive(entriesBySport, now);
  await store.saveState(state);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly && process.argv.includes("--self-test")) selfTest();
else if (invokedDirectly) {
  const storage = await createStorageBackend(process.env);
  const store = storage.backend === "postgres" ? createPostgresStore(storage.sink) : createFileStore();
  try {
    // Lock miss ("busy") exits quietly with code 0, same as the legacy file lock.
    await store.acquireLock(() => main({ dryRun: process.argv.includes("--dry-run"), store }));
  } finally {
    await storage.close();
  }
}
