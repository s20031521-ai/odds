// market-sharp-v1: sharp-book-weighted market consensus with proper de-vig.
//
// Route-1 upgrade to the frozen unified models (ADR 0003). The production
// consensus-v1 / *-loo-v1 models average every book equally and de-vig
// proportionally (1/odds normalized), which (a) gives soft recreational
// books the same voice as Pinnacle and (b) inherits the favourite-longshot
// bias of proportional de-vigging.
//
// This experiment fixes both, under its own strategy/model versions so it
// gathers shadow evidence without touching the live strategy:
//   h2h:      Shin de-vig per book, sharp-weighted average   → consensus-v2
//   totals:   power de-vig, sharp-weighted leave-one-out     → totals-sharp-v1
//   handicap: power de-vig, sharp-weighted leave-one-out     → hdc-sharp-v1
//   corners:  power de-vig, sharp-weighted leave-one-out     → corner-sharp-v1
//
// Quotes keep the unified shape and the 3% edge gate, so the samples are
// directly comparable with the unified-buyable-v1 population.

import {
  BUY_EDGE_THRESHOLD,
  canonicalBookmaker,
  isValidDecimalOdds,
  minimumBuyOdds,
} from "../../shared/unified-recommendations.mjs";

export const SHARP_STRATEGY_VERSION = "market-sharp-v1";
export const SHARP_MODEL_VERSIONS = {
  h2h: "consensus-v2",
  totals: "totals-sharp-v1",
  handicap: "hdc-sharp-v1",
  corners: "corner-sharp-v1",
};

const SELECTIONS_FOR = {
  h2h: ["home", "draw", "away"],
  totals: ["over", "under"],
  handicap: ["home", "away"],
  corners: ["over", "under"],
};

// ---------- bookmaker sharpness weights ----------

// Canonical (canonicalBookmaker-normalized) name → weight. Sharp, high-limit
// books speak loudest; HKJC is the *target* we price against, so it barely
// informs the consensus. Unknown books get DEFAULT_WEIGHT.
const BOOKMAKER_WEIGHTS = new Map(Object.entries({
  pinnacle: 1.0,
  marathonbet: 0.9,
  betfair: 0.9,
  matchbook: 0.85,
  bet365: 0.6,
  williamhill: 0.5,
  unibet: 0.5,
  betsson: 0.5,
  betway: 0.5,
  betano: 0.35,
  superbet: 0.35,
  "1xbet": 0.3,
  betonlineag: 0.3,
  bovada: 0.25,
  betmgm: 0.25,
  betrivers: 0.25,
  draftkings: 0.25,
  fanduel: 0.25,
  hkjc: 0.1,
}));
const DEFAULT_WEIGHT = 0.4;

export function bookmakerWeight(bookmaker) {
  return BOOKMAKER_WEIGHTS.get(canonicalBookmaker(bookmaker)) ?? DEFAULT_WEIGHT;
}

// ---------- de-vig methods ----------

// Shin (1993) de-vig for the three-way h2h market. Solves for the insider
// trading probability z so the fair probabilities sum to 1. Handles the
// favourite-longshot bias that proportional de-vigging ignores.
//
//   π_i(z) = ( √(z² + 4(1−z) q_i² / c) − z ) / (2(1−z)),  c = Σq_i
//
// Σπ(0) = √c > 1 for any overround c > 1, and Σπ → Σq_i²/c < 1 as z → 1,
// so the root is bracketed and bisection is safe.
export function shinProbabilities(odds) {
  if (!odds || ![odds.home, odds.draw, odds.away].every(isValidDecimalOdds)) return null;
  const implied = [1 / odds.home, 1 / odds.draw, 1 / odds.away];
  const overround = implied.reduce((sum, q) => sum + q, 0);
  const proportional = () => {
    const fair = implied.map((q) => q / overround);
    return { home: fair[0], draw: fair[1], away: fair[2] };
  };
  if (overround <= 1) return proportional(); // no margin: proportional is exact

  const sumAt = (z) => implied.reduce((sum, q) => sum + (
    (Math.sqrt(z * z + (4 * (1 - z) * q * q) / overround) - z) / (2 * (1 - z))
  ), 0);
  if (!(sumAt(0) > 1) || !(sumAt(0.999) < 1)) return proportional();

  let low = 0;
  let high = 0.999;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const mid = (low + high) / 2;
    if (sumAt(mid) > 1) low = mid;
    else high = mid;
  }
  const z = (low + high) / 2;
  const fair = implied.map((q) => (
    (Math.sqrt(z * z + (4 * (1 - z) * q * q) / overround) - z) / (2 * (1 - z))
  ));
  return { home: fair[0], draw: fair[1], away: fair[2] };
}

// Power de-vig for two-way markets: find k ∈ (0, 1] with q1^(1/k) + q2^(1/k) = 1.
// (Overround > 1 needs k < 1: q^(1/k) < q then, deflating both sides.)
export function powerNoVigTwoWay(oddsA, oddsB) {
  if (!isValidDecimalOdds(oddsA) || !isValidDecimalOdds(oddsB)) return null;
  const qA = 1 / oddsA;
  const qB = 1 / oddsB;
  if (qA + qB <= 1) return [qA / (qA + qB), qB / (qA + qB)];
  // sumAt(1) > 1; sumAt(k) → 0 as k → 0+. Bracket and bisect.
  const sumAt = (k) => qA ** (1 / k) + qB ** (1 / k);
  let low = 1e-9;
  let high = 1;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const mid = (low + high) / 2;
    if (sumAt(mid) > 1) high = mid;
    else low = mid;
  }
  const k = (low + high) / 2;
  return [qA ** (1 / k), qB ** (1 / k)];
}

// ---------- opportunity building ----------

/**
 * Builds market-sharp-v1 shadow opportunities from the unified evaluation's
 * fresh deduped input rows. Same opportunity/quote shape as unified; empty
 * shells are emitted for every evaluated group so existing samples observe
 * the market drying up.
 */
export function buildSharpOpportunities(inputs) {
  const rows = (Array.isArray(inputs) ? inputs : []).filter((row) => row && SHARP_MODEL_VERSIONS[row.market]);
  const byFixture = new Map();
  for (const row of rows) {
    byFixture.set(row.fixtureId, [...(byFixture.get(row.fixtureId) ?? []), row]);
  }

  const opportunities = [];
  for (const fixtureRows of byFixture.values()) {
    const owner = fixtureRows.find((row) => row.provider === "hkjc") ?? fixtureRows[0];
    const groups = new Map();
    for (const row of fixtureRows) {
      const key = `${row.market}|${row.line ?? ""}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }

    for (const groupRows of groups.values()) {
      const { market } = groupRows[0];
      const line = market === "h2h" ? undefined : groupRows[0].line;
      if (market !== "h2h" && !Number.isFinite(line)) continue;
      const selections = SELECTIONS_FOR[market];
      const books = completeBooks(groupRows, selections);
      const fairByBook = new Map(books.map((book) => [book.key, fairForBook(market, book)]));

      for (let index = 0; index < selections.length; index += 1) {
        const selection = selections[index];
        const quotes = books.flatMap((book) => {
          const row = book.bySelection[selection];
          const chance = chanceForBook(market, books, fairByBook, book.key, index);
          if (!Number.isFinite(chance) || chance <= 0) return [];
          const edge = row.odds * chance - 1;
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
        }).sort(compareQuotes);
        opportunities.push({
          fixtureId: owner.fixtureId,
          ...(owner.matchId ? { matchId: owner.matchId } : {}),
          homeTeam: owner.homeTeam,
          awayTeam: owner.awayTeam,
          ...(owner.homeTeamZh ? { homeTeamZh: owner.homeTeamZh } : {}),
          ...(owner.awayTeamZh ? { awayTeamZh: owner.awayTeamZh } : {}),
          commenceTime: owner.commenceTime,
          ...(owner.league ? { league: owner.league } : {}),
          ...(owner.leagueZh ? { leagueZh: owner.leagueZh } : {}),
          strategyVersion: SHARP_STRATEGY_VERSION,
          modelVersion: SHARP_MODEL_VERSIONS[market],
          market,
          selection,
          ...(line === undefined ? {} : { line }),
          quotes,
        });
      }
    }
  }

  return opportunities.sort(compareOpportunities);
}

function fairForBook(market, book) {
  if (market === "h2h") {
    return shinProbabilities({
      home: book.bySelection.home.odds,
      draw: book.bySelection.draw.odds,
      away: book.bySelection.away.odds,
    });
  }
  const [firstSelection, secondSelection] = SELECTIONS_FOR[market];
  const pair = powerNoVigTwoWay(
    book.bySelection[firstSelection].odds,
    book.bySelection[secondSelection].odds,
  );
  return pair ? { [firstSelection]: pair[0], [secondSelection]: pair[1] } : null;
}

function chanceForBook(market, books, fairByBook, bookKey, selectionIndex) {
  if (market === "h2h") {
    // Full consensus: weighted average over every complete book.
    return weightedAverage(books.map((book) => ({
      weight: book.weight,
      value: fairByBook.get(book.key)?.[SELECTIONS_FOR.h2h[selectionIndex]],
    })));
  }
  // Leave-one-out like the frozen models, but sharp-weighted.
  const peers = books.filter((book) => book.key !== bookKey);
  if (peers.length === 0) return null;
  const firstSelection = SELECTIONS_FOR[market][0];
  const peerFirst = weightedAverage(peers.map((book) => ({
    weight: book.weight,
    value: fairByBook.get(book.key)?.[firstSelection],
  })));
  if (!Number.isFinite(peerFirst)) return null;
  return selectionIndex === 0 ? peerFirst : 1 - peerFirst;
}

function weightedAverage(entries) {
  let total = 0;
  let weight = 0;
  for (const entry of entries) {
    if (!Number.isFinite(entry.value)) continue;
    total += entry.weight * entry.value;
    weight += entry.weight;
  }
  return weight > 0 ? total / weight : null;
}

function completeBooks(rows, selections) {
  const books = new Map();
  for (const row of rows) {
    const key = canonicalBookmaker(row.bookmaker);
    if (!key) continue;
    books.set(key, [...(books.get(key) ?? []), row]);
  }
  return [...books.entries()].flatMap(([key, bookRows]) => {
    const bySelection = Object.fromEntries(bookRows.map((row) => [row.selection, row]));
    return selections.every((selection) => bySelection[selection] && isValidDecimalOdds(bySelection[selection].odds))
      ? [{ key, bySelection, weight: bookmakerWeight(bookRows[0].bookmaker) }]
      : [];
  });
}

/**
 * Full sharp-weighted consensus chance for one selection within a group of
 * rows sharing (fixture, market, line). Unlike the LOO chances used for the
 * strategy's own quotes, this includes every complete book — it is the
 * market reference that dc-v2 blends against. Returns null without at least
 * one complete book.
 */
export function marketReferenceChance(rows, market, selection) {
  const selections = SELECTIONS_FOR[market];
  if (!selections || !selections.includes(selection) || !Array.isArray(rows)) return null;
  const books = completeBooks(rows, selections);
  if (books.length === 0) return null;
  const fairByBook = new Map(books.map((book) => [book.key, fairForBook(market, book)]));
  const firstSelection = selections[0];
  const first = weightedAverage(books.map((book) => ({
    weight: book.weight,
    value: fairByBook.get(book.key)?.[firstSelection],
  })));
  if (!Number.isFinite(first)) return null;
  if (market === "h2h") {
    return weightedAverage(books.map((book) => ({
      weight: book.weight,
      value: fairByBook.get(book.key)?.[selection],
    })));
  }
  return selection === firstSelection ? first : 1 - first;
}

function compareQuotes(left, right) {
  return right.odds - left.odds
    || String(left.bookmaker ?? "").localeCompare(String(right.bookmaker ?? ""))
    || String(left.provider ?? "").localeCompare(String(right.provider ?? ""));
}

function compareOpportunities(left, right) {
  return Date.parse(left.commenceTime) - Date.parse(right.commenceTime)
    || String(left.fixtureId).localeCompare(String(right.fixtureId))
    || String(left.market).localeCompare(String(right.market))
    || (left.line ?? 0) - (right.line ?? 0)
    || String(left.selection).localeCompare(String(right.selection));
}
