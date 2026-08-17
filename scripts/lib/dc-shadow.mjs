// dc-shadow-v1: shadow-mode wiring between the dc-v1 Dixon-Coles engine
// (scripts/lib/dixon-coles.mjs) and the unified opportunity pipeline.
//
// Shadow opportunities are recorded under strategyVersion "dc-shadow-v1" with
// modelVersion "dc-v1". They flow through the same recommendation_samples /
// recommendation_observations tables but never surface on the Today page
// (listCurrent is hardcoded to unified-buyable-v1). See ADR 0003.
//
// Quote economics: each quote is priced against the model's five-state
// settlement distribution (win / half-win / push / half-loss / loss), so
// quarter and integer Asian lines are valued exactly like
// server/domain/backtest.mjs settles them. `chance` on a quote is the
// *effective* chance (1 + EV) / odds — the probability a simple two-way bet
// would need to break even at the same price; for h2h it equals the model
// probability exactly.

import { BUY_EDGE_THRESHOLD } from "../../shared/unified-recommendations.mjs";
import { marketReferenceChance } from "./market-sharp.mjs";
import {
  expectedGoals,
  fitDixonColes,
  goalTotalDistribution,
  handicapSettlementDist,
  marginDistribution,
  marketProbabilities,
  scoreMatrix,
  settlementEV,
  totalsSettlementDist,
} from "./dixon-coles.mjs";

export const DC_SHADOW_STRATEGY_VERSION = "dc-shadow-v1";
export const DC_MODEL_VERSION = "dc-v1";
export const DC_BLEND_STRATEGY_VERSION = "dc-blend-v1";
export const DC_BLEND_MODEL_VERSION = "dc-v2";
// dc-v2 blend: 30% Dixon-Coles model, 70% sharp market consensus. The
// offline backtest showed the pure model trails the closing market; the
// literature consensus is that a market-anchored blend beats either side
// alone. Shadow evidence will confirm or refute that at HKJC prices.
export const DC_BLEND_MODEL_WEIGHT = 0.3;

const SUPPORTED_MARKETS = new Set(["h2h", "totals", "handicap"]);
const MARKET_SELECTIONS = {
  h2h: ["home", "draw", "away"],
  totals: ["over", "under"],
  handicap: ["home", "away"],
};

// ---------- league mapping ----------

// Keys are normalized (lowercase, diacritics stripped, non-alphanumeric →
// space, collapsed). Exact-match only: lookalike leagues (Hong Kong Premier
// League, La Liga 2, ...) must stay unmapped so shadow never prices the
// wrong competition.
const LEAGUE_CODES = new Map(Object.entries({
  "epl": "E0",
  "english premier league": "E0",
  "premier league england": "E0",
  "英格蘭超級聯賽": "E0",
  "la liga spain": "SP1",
  "spanish la liga": "SP1",
  "西班牙甲組聯賽": "SP1",
  "bundesliga germany": "D1",
  "german bundesliga": "D1",
  "德國甲組聯賽": "D1",
  "serie a italy": "I1",
  "italian serie a": "I1",
  "意大利甲組聯賽": "I1",
  "ligue 1 france": "F1",
  "french ligue 1": "F1",
  "法國甲組聯賽": "F1",
}));

export function leagueCodeFromName(name) {
  if (typeof name !== "string" || !name.trim()) return null;
  const normalized = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return LEAGUE_CODES.get(normalized) ?? null;
}

// ---------- team name canonicalization ----------

export function canonicalTeamName(name) {
  if (typeof name !== "string") return "";
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// Live-feed name (canonicalized) → football-data.co.uk name. Only pairs where
// plain normalization does NOT already match need an entry; membership in the
// fit's team list is always verified by resolveTeamName.
const TEAM_ALIASES = new Map(Object.entries({
  // E0 — England
  manchesterunited: "Man United",
  manchestercity: "Man City",
  tottenhamhotspur: "Tottenham",
  nottinghamforest: "Nott'm Forest",
  brightonandhovealbion: "Brighton",
  newcastleunited: "Newcastle",
  westhamunited: "West Ham",
  leedsunited: "Leeds",
  leicestercity: "Leicester",
  ipswichtown: "Ipswich",
  wolverhamptonwanderers: "Wolves",
  westbromwichalbion: "West Brom",
  lutontown: "Luton",
  norwichcity: "Norwich",
  coventrycity: "Coventry",
  hullcity: "Hull",
  stokecity: "Stoke",
  swanseacity: "Swansea",
  cardiffcity: "Cardiff",
  huddersfieldtown: "Huddersfield",
  // SP1 — Spain
  athleticbilbao: "Ath Bilbao",
  athleticclub: "Ath Bilbao",
  atleticomadrid: "Ath Madrid",
  celtavigo: "Celta",
  caosasuna: "Osasuna",
  elchecf: "Elche",
  espanyol: "Espanol",
  rcdespanyol: "Espanol",
  rayovallecano: "Vallecano",
  realbetis: "Betis",
  realsociedad: "Sociedad",
  realvalladolid: "Valladolid",
  realoviedo: "Oviedo",
  deportivolacoruna: "La Coruna",
  udlaspalmas: "Las Palmas",
  cdleganes: "Leganes",
  // D1 — Germany
  vfbstuttgart: "Stuttgart",
  "1fckoln": "FC Koln",
  tsghoffenheim: "Hoffenheim",
  fcschalke04: "Schalke 04",
  bayerleverkusen: "Leverkusen",
  bayer04leverkusen: "Leverkusen",
  borussiadortmund: "Dortmund",
  hamburgersv: "Hamburg",
  borussiamonchengladbach: "M'gladbach",
  eintrachtfrankfurt: "Ein Frankfurt",
  fsvmainz05: "Mainz",
  "1fsvmainz05": "Mainz",
  mainz05: "Mainz",
  scpaderborn: "Paderborn",
  scpaderborn07: "Paderborn",
  vflwolfsburg: "Wolfsburg",
  scfreiburg: "Freiburg",
  fcaugsburg: "Augsburg",
  herthabsc: "Hertha",
  vflbochum: "Bochum",
  "1fcunionberlin": "Union Berlin",
  fcstpauli: "St Pauli",
  "1fcheidenheim": "Heidenheim",
  svdarmstadt98: "Darmstadt",
  spvgggreutherfurth: "Greuther Furth",
  arminiabielefeld: "Bielefeld",
  // I1 — Italy
  acmilan: "Milan",
  asroma: "Roma",
  atalantabc: "Atalanta",
  hellasverona: "Verona",
  intermilan: "Inter",
  internazionale: "Inter",
  uslecce: "Lecce",
  // F1 — France
  asmonaco: "Monaco",
  rclens: "Lens",
  parissaintgermain: "Paris SG",
  psg: "Paris SG",
  lemansfc: "Le Mans",
  olympiquemarseille: "Marseille",
  olympiquelyon: "Lyon",
  olympiquelyonnais: "Lyon",
}));

// Maps a live-feed team name onto the football-data name used by the fit.
// Returns null when the team is not part of the fit (e.g. a newly promoted
// side with no history in the fitting window) so the fixture is skipped
// instead of silently priced with league-average ratings.
export function resolveTeamName(name, teams) {
  const canonical = canonicalTeamName(name);
  if (!canonical || !Array.isArray(teams)) return null;
  const byCanonical = new Map(teams.map((team) => [canonicalTeamName(team), team]));
  const direct = byCanonical.get(canonical);
  if (direct) return direct;
  const alias = TEAM_ALIASES.get(canonical);
  return alias && byCanonical.get(canonicalTeamName(alias)) === alias ? alias : null;
}

// ---------- quote economics ----------

// Prices one quote against a five-state settlement distribution.
// Returns null when the selection has no win component (or odds are invalid)
// — such a quote can never clear the edge gate.
export function quoteEvaluation(dist, odds) {
  if (!Number.isFinite(odds) || odds <= 1 || !dist) return null;
  const winComponent = (dist.win ?? 0) + (dist["half-win"] ?? 0) / 2;
  if (winComponent <= 0) return null;
  const edge = settlementEV(dist, odds);
  const chance = (1 + edge) / odds;
  // Solve EV(o) >= BUY_EDGE_THRESHOLD exactly:
  //   EV(o) = winComponent * (o - 1) - halfLoss/2 - loss
  const lossComponent = (dist.loss ?? 0) + (dist["half-loss"] ?? 0) / 2;
  const breakeven = (BUY_EDGE_THRESHOLD + winComponent + lossComponent) / winComponent;
  return {
    edge,
    chance,
    minimumBuyOdds: Math.ceil(breakeven * 100 - 1e-6) / 100,
  };
}

// ---------- opportunity building ----------

function fixtureDistributions(fit, homeTeam, awayTeam) {
  const { lambda, mu } = expectedGoals(fit, homeTeam, awayTeam);
  const matrix = scoreMatrix(lambda, mu, fit.rho);
  return {
    h2h: marketProbabilities(matrix),
    totals: goalTotalDistribution(matrix),
    margins: marginDistribution(matrix),
  };
}

function selectionDist(distributions, market, selection, line) {
  if (market === "h2h") {
    return { win: distributions.h2h[selection], "half-win": 0, push: 0, "half-loss": 0, loss: 1 - distributions.h2h[selection] };
  }
  if (market === "totals") return totalsSettlementDist(distributions.totals, line, selection);
  return handicapSettlementDist(distributions.margins, line, selection);
}

/**
 * Builds dc-shadow opportunities from the unified evaluation's fresh input
 * rows. `fitsByLeague` maps league code ("E0", ...) to a fitDixonColes result.
 * Every evaluated (fixture, market, line) group emits one opportunity per
 * selection; groups whose quotes all fall below the edge gate still emit an
 * empty-quotes shell, mirroring unified-sampler's emptyOpportunityShells so
 * existing samples observe the market drying up.
 */
export function buildShadowOpportunities(inputs, fitsByLeague) {
  const opportunities = [];
  walkShadowFixtures(inputs, fitsByLeague, ({ owner, distributions, groups }) => {
    for (const groupRows of groups.values()) {
      const { market } = groupRows[0];
      const line = market === "h2h" ? undefined : groupRows[0].line;
      for (const selection of MARKET_SELECTIONS[market]) {
        const dist = selectionDist(distributions, market, selection, line);
        const quotes = groupRows.flatMap((row) => {
          if (row.selection !== selection) return [];
          const evaluation = quoteEvaluation(dist, row.odds);
          if (!evaluation || evaluation.edge < BUY_EDGE_THRESHOLD) return [];
          return [{
            bookmaker: row.bookmaker,
            provider: row.provider,
            odds: row.odds,
            chance: evaluation.chance,
            edge: evaluation.edge,
            minimumBuyOdds: evaluation.minimumBuyOdds,
            observedAt: row.observedAt,
          }];
        }).sort(compareQuotes);
        opportunities.push(shadowShell(owner, DC_SHADOW_STRATEGY_VERSION, DC_MODEL_VERSION, market, selection, line, quotes));
      }
    }
  });
  return opportunities.sort(compareOpportunities);
}

// ---------- dc-v2: model-market blend ----------

/**
 * Prices one quote under the dc-v2 blend: (1−w) × market-consensus EV +
 * w × model five-state EV. For h2h the market side is exact; for quarter /
 * integer point lines the book's two-way no-vig price already absorbs push
 * economics, so the market side uses the standard two-way approximation.
 */
export function blendQuoteEvaluation(dist, marketChance, odds, modelWeight = DC_BLEND_MODEL_WEIGHT) {
  if (!Number.isFinite(odds) || odds <= 1 || !dist) return null;
  if (!Number.isFinite(marketChance) || marketChance <= 0 || marketChance >= 1) return null;
  const winComponent = (dist.win ?? 0) + (dist["half-win"] ?? 0) / 2;
  if (winComponent <= 0) return null;
  const lossComponent = (dist.loss ?? 0) + (dist["half-loss"] ?? 0) / 2;
  const w = modelWeight;
  const edge = (1 - w) * (marketChance * odds - 1) + w * settlementEV(dist, odds);
  const chance = (1 + edge) / odds;
  // Solve blended EV(o) = BUY_EDGE_THRESHOLD:
  //   (1−w)(c·o − 1) + w(a(o−1) − b) = threshold
  const breakeven = (BUY_EDGE_THRESHOLD + (1 - w) + w * (winComponent + lossComponent))
    / ((1 - w) * marketChance + w * winComponent);
  return {
    edge,
    chance,
    minimumBuyOdds: Math.ceil(breakeven * 100 - 1e-6) / 100,
  };
}

/**
 * Builds dc-blend-v1 shadow opportunities: same fixtures and distributions
 * as dc-shadow-v1, but each quote is priced against the model–market blend.
 * Groups without a market reference (no complete book) emit empty shells.
 */
export function buildBlendOpportunities(inputs, fitsByLeague, { modelWeight = DC_BLEND_MODEL_WEIGHT } = {}) {
  const opportunities = [];
  walkShadowFixtures(inputs, fitsByLeague, ({ owner, distributions, groups }) => {
    for (const groupRows of groups.values()) {
      const { market } = groupRows[0];
      const line = market === "h2h" ? undefined : groupRows[0].line;
      for (const selection of MARKET_SELECTIONS[market]) {
        const marketChance = marketReferenceChance(groupRows, market, selection);
        const dist = selectionDist(distributions, market, selection, line);
        const quotes = groupRows.flatMap((row) => {
          if (row.selection !== selection) return [];
          const evaluation = blendQuoteEvaluation(dist, marketChance, row.odds, modelWeight);
          if (!evaluation || evaluation.edge < BUY_EDGE_THRESHOLD) return [];
          return [{
            bookmaker: row.bookmaker,
            provider: row.provider,
            odds: row.odds,
            chance: evaluation.chance,
            edge: evaluation.edge,
            minimumBuyOdds: evaluation.minimumBuyOdds,
            observedAt: row.observedAt,
          }];
        }).sort(compareQuotes);
        opportunities.push(shadowShell(owner, DC_BLEND_STRATEGY_VERSION, DC_BLEND_MODEL_VERSION, market, selection, line, quotes));
      }
    }
  });
  return opportunities.sort(compareOpportunities);
}

// ---------- shared shadow internals ----------

// Walks every (fixture, market, line) group that has a usable league fit and
// resolved teams, computing the dc distributions once per fixture.
function walkShadowFixtures(inputs, fitsByLeague, callback) {
  const rows = (Array.isArray(inputs) ? inputs : []).filter((row) => row && SUPPORTED_MARKETS.has(row.market));
  const byFixture = new Map();
  for (const row of rows) {
    byFixture.set(row.fixtureId, [...(byFixture.get(row.fixtureId) ?? []), row]);
  }

  for (const fixtureRows of byFixture.values()) {
    const owner = fixtureRows.find((row) => row.provider === "hkjc") ?? fixtureRows[0];
    const leagueCode = fixtureRows.reduce((code, row) => code ?? leagueCodeFromName(row.league), null);
    if (!leagueCode) continue;
    const fit = fitsByLeague?.get(leagueCode);
    if (!fit) continue;
    const homeTeam = resolveTeamName(owner.homeTeam, fit.teams);
    const awayTeam = resolveTeamName(owner.awayTeam, fit.teams);
    if (!homeTeam || !awayTeam) continue;

    const groups = new Map();
    for (const row of fixtureRows) {
      const key = `${row.market}|${row.line ?? ""}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    // Point-market groups without a usable line cannot be priced.
    for (const [key, groupRows] of [...groups]) {
      if (groupRows[0].market !== "h2h" && !Number.isFinite(groupRows[0].line)) groups.delete(key);
    }

    callback({
      owner,
      fit,
      distributions: fixtureDistributions(fit, homeTeam, awayTeam),
      groups,
    });
  }
}

function shadowShell(owner, strategyVersion, modelVersion, market, selection, line, quotes) {
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
    strategyVersion,
    modelVersion,
    market,
    selection,
    ...(line === undefined ? {} : { line }),
    quotes,
  };
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

// ---------- fitting from team_match_history ----------

/**
 * Fits one dc-v1 model per requested league code from team_match_history
 * rows (accepts both repository camelCase and raw snake_case rows).
 * Leagues with insufficient data are skipped rather than throwing — shadow
 * mode must never take the unified sampler down.
 */
export function fitLeagues(historyRows, leagueCodes, refDate, fitOptions = {}) {
  const wanted = new Set(leagueCodes ?? []);
  const byCode = new Map();
  for (const row of Array.isArray(historyRows) ? historyRows : []) {
    const code = row?.leagueCode ?? row?.league_code;
    if (!wanted.has(code)) continue;
    const match = {
      homeTeam: row.homeTeam ?? row.home_team,
      awayTeam: row.awayTeam ?? row.away_team,
      homeGoals: row.homeGoals ?? row.home_goals,
      awayGoals: row.awayGoals ?? row.away_goals,
      matchDate: row.matchDate ?? row.match_date,
    };
    byCode.set(code, [...(byCode.get(code) ?? []), match]);
  }

  const fits = new Map();
  for (const [code, matches] of byCode) {
    try {
      fits.set(code, fitDixonColes(matches, { refDate, ...fitOptions }));
    } catch {
      // Too little history for a stable fit — skip this league for the run.
    }
  }
  return fits;
}
