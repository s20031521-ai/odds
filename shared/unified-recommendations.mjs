export const UNIFIED_STRATEGY_VERSION = "unified-buyable-v1";
export const BUY_EDGE_THRESHOLD = 0.03;
export const FRESHNESS_MS = 45 * 60_000;

const H2H_MODEL_VERSION = "consensus-v1";
const MODEL_VERSIONS = {
  handicap: "hdc-loo-v2",
  totals: "totals-loo-v1",
  corners: "corner-loo-v1",
};
const MARKET_ALIASES = new Map([
  ["h2h", "h2h"],
  ["spreads", "handicap"],
  ["handicap", "handicap"],
  ["totals", "totals"],
  ["alternate_totals_corners", "corners"],
  ["corners", "corners"],
]);
const POINT_SELECTIONS = {
  handicap: ["home", "away"],
  totals: ["over", "under"],
  corners: ["over", "under"],
};
const HKJC_ALIASES = new Set([
  "hkjc",
  "hongkongjockeyclub",
  "thehongkongjockeyclub",
  "香港賽馬會",
  "香港赛马会",
]);

export function minimumBuyOdds(chance) {
  return Math.ceil((((1 + BUY_EDGE_THRESHOLD) / chance) - Number.EPSILON) * 100) / 100;
}

export function canonicalBookmaker(name) {
  if (typeof name !== "string") return "";
  const normalized = name.normalize("NFKC").trim().toLocaleLowerCase("en").replace(/[\p{P}\p{S}\s]+/gu, "");
  return HKJC_ALIASES.has(normalized) ? "hkjc" : normalized;
}

export function normalizeUnifiedMarket(market) {
  return typeof market === "string" ? (MARKET_ALIASES.get(market.trim().toLowerCase()) ?? null) : null;
}

export function isValidDecimalOdds(value) {
  return Number.isFinite(value) && value > 1;
}

export function fairProbabilitiesForOdds(odds) {
  const raw = {
    home: 1 / odds.home,
    draw: 1 / odds.draw,
    away: 1 / odds.away,
  };
  const total = raw.home + raw.draw + raw.away;
  return {
    home: raw.home / total,
    draw: raw.draw / total,
    away: raw.away / total,
  };
}

export function h2hConsensusForOdds(oddsSets) {
  if (oddsSets.length === 0) return null;
  const total = { home: 0, draw: 0, away: 0 };
  for (const odds of oddsSets) {
    const fair = fairProbabilitiesForOdds(odds);
    total.home += fair.home;
    total.draw += fair.draw;
    total.away += fair.away;
  }
  const average = {
    home: total.home / oddsSets.length,
    draw: total.draw / oddsSets.length,
    away: total.away / oddsSets.length,
  };
  const sum = average.home + average.draw + average.away;
  return {
    home: average.home / sum,
    draw: average.draw / sum,
    away: average.away / sum,
  };
}

export function valueEdgeForQuote(odds, chance) {
  return isValidDecimalOdds(odds) && Number.isFinite(chance) && chance > 0
    ? odds * chance - 1
    : Number.NEGATIVE_INFINITY;
}

export function noVigFirstChance(firstOdds, secondOdds) {
  const first = 1 / firstOdds;
  return first / (first + 1 / secondOdds);
}

export function dedupeFreshQuotes(rows, evaluatedAt) {
  if (!Array.isArray(rows)) return [];
  const evaluatedMs = parseTime(evaluatedAt);
  if (evaluatedMs === null) return [];
  const grouped = new Map();
  for (const row of rows) {
    const normalized = normalizeQuote(row, evaluatedMs);
    if (!normalized) continue;
    const key = quoteIdentity(normalized);
    grouped.set(key, [...(grouped.get(key) ?? []), normalized]);
  }

  const deduped = [];
  for (const candidates of grouped.values()) {
    const newestMs = Math.max(...candidates.map((row) => row.observedMs));
    const newest = candidates.filter((row) => row.observedMs === newestMs);
    const winner = resolveEqualTimeQuotes(newest);
    if (winner) deduped.push(stripInternal(winner));
  }
  return deduped.sort(compareInputs);
}

export function evaluateUnifiedOdds(rows, evaluatedAt) {
  const inputs = dedupeFreshQuotes(rows, evaluatedAt);
  const opportunities = [
    ...evaluateH2h(inputs),
    ...evaluatePointMarkets(inputs),
  ].sort(compareOpportunities);
  return { opportunities, inputs };
}

export function observationFingerprint(value) {
  return sha256(stableJson(value));
}

function evaluateH2h(inputs) {
  const fixtures = groupBy(inputs.filter((row) => row.market === "h2h"), (row) => row.fixtureId);
  const opportunities = [];
  for (const fixtureRows of fixtures.values()) {
    const books = completeBooks(fixtureRows, ["home", "draw", "away"]);
    const consensus = h2hConsensusForOdds(books.map(({ bySelection }) => ({
      home: bySelection.home.odds,
      draw: bySelection.draw.odds,
      away: bySelection.away.odds,
    })));
    if (!consensus) continue;
    for (const selection of ["home", "draw", "away"]) {
      const quotes = books.flatMap(({ bySelection }) => {
        const row = bySelection[selection];
        return qualifyingQuote(row, consensus[selection]);
      }).sort(compareQuotes);
      if (quotes.length > 0) opportunities.push(opportunity(fixtureRows, H2H_MODEL_VERSION, "h2h", selection, undefined, quotes));
    }
  }
  return opportunities;
}

function evaluatePointMarkets(inputs) {
  const pointRows = inputs.filter((row) => row.market !== "h2h");
  const groups = groupBy(pointRows, (row) => `${row.fixtureId}|${row.market}|${row.line}`);
  const opportunities = [];
  for (const groupRows of groups.values()) {
    const market = groupRows[0].market;
    const selections = POINT_SELECTIONS[market];
    const books = completeBooks(groupRows, selections);
    if (books.length < 2) continue;
    const firstChances = new Map(books.map((book) => [
      book.bookmakerKey,
      noVigFirstChance(book.bySelection[selections[0]].odds, book.bySelection[selections[1]].odds),
    ]));
    for (let index = 0; index < selections.length; index += 1) {
      const selection = selections[index];
      const quotes = books.flatMap((book) => {
        const peerFirstChances = books
          .filter((peer) => peer.bookmakerKey !== book.bookmakerKey)
          .map((peer) => firstChances.get(peer.bookmakerKey));
        const peerFirstChance = average(peerFirstChances);
        const chance = index === 0 ? peerFirstChance : 1 - peerFirstChance;
        return qualifyingQuote(book.bySelection[selection], chance);
      }).sort(compareQuotes);
      if (quotes.length > 0) {
        opportunities.push(opportunity(groupRows, MODEL_VERSIONS[market], market, selection, groupRows[0].line, quotes));
      }
    }
  }
  return opportunities;
}

function qualifyingQuote(row, chance) {
  const edge = valueEdgeForQuote(row.odds, chance);
  if (edge < BUY_EDGE_THRESHOLD) return [];
  return [{
    bookmaker: row.bookmaker,
    provider: row.provider,
    odds: row.odds,
    chance,
    edge,
    minimumBuyOdds: minimumBuyOdds(chance),
    observedAt: row.observedAt,
  }];
}

function opportunity(rows, modelVersion, market, selection, line, quotes) {
  const owner = rows.find((row) => row.provider === "hkjc") ?? rows[0];
  return {
    fixtureId: owner.fixtureId,
    ...(owner.matchId ? { matchId: owner.matchId } : {}),
    homeTeam: owner.homeTeam,
    awayTeam: owner.awayTeam,
    ...(owner.homeTeamZh ? { homeTeamZh: owner.homeTeamZh } : {}),
    ...(owner.awayTeamZh ? { awayTeamZh: owner.awayTeamZh } : {}),
    commenceTime: owner.commenceTime,
    ...(owner.league ? { league: owner.league } : {}),
    ...(owner.leagueZh ? { leagueZh: owner.leagueZh } : {}),
    strategyVersion: UNIFIED_STRATEGY_VERSION,
    modelVersion,
    market,
    selection,
    ...(line === undefined ? {} : { line }),
    quotes,
  };
}

function normalizeQuote(row, evaluatedMs) {
  if (!row || typeof row !== "object") return null;
  const fixtureId = nonEmpty(row.fixtureId);
  const homeTeam = nonEmpty(row.homeTeam);
  const awayTeam = nonEmpty(row.awayTeam);
  const provider = nonEmpty(row.provider);
  const bookmaker = nonEmpty(row.bookmaker);
  const bookmakerKey = canonicalBookmaker(bookmaker);
  const market = normalizeUnifiedMarket(row.market);
  const selection = typeof row.selection === "string" ? row.selection.trim().toLowerCase() : "";
  const observedMs = parseTime(row.observedAt);
  const commenceMs = parseTime(row.commenceTime);
  if (!fixtureId || !homeTeam || !awayTeam || !provider || !bookmakerKey || !market) return null;
  if (!validSelection(market, selection) || !isValidDecimalOdds(row.odds)) return null;
  if (observedMs === null || commenceMs === null) return null;
  if (observedMs > evaluatedMs || evaluatedMs - observedMs > FRESHNESS_MS || commenceMs <= evaluatedMs) return null;
  if (market === "h2h" && row.line !== undefined && row.line !== null) return null;
  if (market !== "h2h" && !Number.isFinite(row.line)) return null;

  return {
    ...(nonEmpty(row.id) ? { id: row.id.trim() } : {}),
    fixtureId: fixtureId.trim(),
    ...(nonEmpty(row.matchId) ? { matchId: row.matchId.trim() } : {}),
    homeTeam: homeTeam.trim(),
    awayTeam: awayTeam.trim(),
    ...(nonEmpty(row.homeTeamZh) ? { homeTeamZh: row.homeTeamZh.trim() } : {}),
    ...(nonEmpty(row.awayTeamZh) ? { awayTeamZh: row.awayTeamZh.trim() } : {}),
    commenceTime: new Date(commenceMs).toISOString(),
    ...(nonEmpty(row.league) ? { league: row.league.trim() } : {}),
    ...(nonEmpty(row.leagueZh) ? { leagueZh: row.leagueZh.trim() } : {}),
    provider: provider.trim(),
    bookmaker: bookmaker.trim(),
    bookmakerKey,
    market,
    selection,
    ...(market === "h2h" ? {} : { line: row.line }),
    odds: row.odds,
    observedAt: new Date(observedMs).toISOString(),
    observedMs,
  };
}

function validSelection(market, selection) {
  return market === "h2h"
    ? selection === "home" || selection === "draw" || selection === "away"
    : POINT_SELECTIONS[market].includes(selection);
}

function quoteIdentity(row) {
  return [row.fixtureId, row.market, row.selection, row.line ?? "", row.bookmakerKey].join("|");
}

function resolveEqualTimeQuotes(rows) {
  if (rows.length === 1) return rows[0];
  const native = rows.filter((row) => row.bookmakerKey === "hkjc" && row.provider.trim().toLowerCase() === "hkjc");
  if (native.length === 1) return native[0];
  const signatures = new Set(rows.map((row) => stableJson(stripInternal(row))));
  return signatures.size === 1 ? [...rows].sort(compareInputs)[0] : null;
}

function stripInternal({ bookmakerKey: _bookmakerKey, observedMs: _observedMs, ...row }) {
  return row;
}

function completeBooks(rows, selections) {
  const books = groupBy(rows, (row) => canonicalBookmaker(row.bookmaker));
  return [...books.entries()].flatMap(([bookmakerKey, bookRows]) => {
    const bySelection = Object.fromEntries(bookRows.map((row) => [row.selection, row]));
    return selections.every((selection) => bySelection[selection]) ? [{ bookmakerKey, bySelection }] : [];
  });
}

function groupBy(values, keyFor) {
  const groups = new Map();
  for (const value of values) {
    const key = keyFor(value);
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  return groups;
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function parseTime(value) {
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function compareInputs(left, right) {
  return left.fixtureId.localeCompare(right.fixtureId)
    || left.market.localeCompare(right.market)
    || (left.line ?? 0) - (right.line ?? 0)
    || left.selection.localeCompare(right.selection)
    || canonicalBookmaker(left.bookmaker).localeCompare(canonicalBookmaker(right.bookmaker))
    || left.provider.localeCompare(right.provider);
}

function compareQuotes(left, right) {
  return right.odds - left.odds
    || canonicalBookmaker(left.bookmaker).localeCompare(canonicalBookmaker(right.bookmaker))
    || left.provider.localeCompare(right.provider);
}

function compareOpportunities(left, right) {
  return Date.parse(left.commenceTime) - Date.parse(right.commenceTime)
    || left.fixtureId.localeCompare(right.fixtureId)
    || left.market.localeCompare(right.market)
    || (left.line ?? 0) - (right.line ?? 0)
    || left.selection.localeCompare(right.selection);
}

function stableJson(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (typeof value === "bigint") throw new TypeError("Cannot fingerprint BigInt values");
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") return undefined;
  if (seen.has(value)) throw new TypeError("Cannot fingerprint cyclic values");
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = `[${value.map((item) => stableJson(item, seen) ?? "null").join(",")}]`;
  } else {
    const fields = Object.keys(value).sort().flatMap((key) => {
      const field = stableJson(value[key], seen);
      return field === undefined ? [] : [`${JSON.stringify(key)}:${field}`];
    });
    result = `{${fields.join(",")}}`;
  }
  seen.delete(value);
  return result;
}

function sha256(value) {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const source = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(source);
  bytes[source.length] = 0x80;
  const view = new DataView(bytes.buffer);
  const bitLength = source.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(words[index - 15], 7) ^ rotateRight(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rotateRight(words[index - 2], 17) ^ rotateRight(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + constants[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }
  return state.map((word) => word.toString(16).padStart(8, "0")).join("");
}

function rotateRight(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}
