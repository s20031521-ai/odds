import assert from "node:assert/strict";
import test from "node:test";

import { minimumBuyOdds } from "../shared/unified-recommendations.mjs";
import {
  expectedGoals,
  goalTotalDistribution,
  handicapSettlementDist,
  marginDistribution,
  marketProbabilities,
  scoreMatrix,
  settlementEV,
  totalsSettlementDist,
} from "./lib/dixon-coles.mjs";
import {
  DC_BLEND_MODEL_VERSION,
  DC_BLEND_STRATEGY_VERSION,
  DC_MODEL_VERSION,
  DC_SHADOW_STRATEGY_VERSION,
  blendQuoteEvaluation,
  buildBlendOpportunities,
  buildShadowOpportunities,
  canonicalTeamName,
  fitLeagues,
  leagueCodeFromName,
  quoteEvaluation,
  resolveTeamName,
} from "./lib/dc-shadow.mjs";
import { marketReferenceChance } from "./lib/market-sharp.mjs";

// ---------- league mapping ----------

test("leagueCodeFromName maps The Odds API sport_title values", () => {
  assert.equal(leagueCodeFromName("EPL"), "E0");
  assert.equal(leagueCodeFromName("La Liga - Spain"), "SP1");
  assert.equal(leagueCodeFromName("Bundesliga - Germany"), "D1");
  assert.equal(leagueCodeFromName("Serie A - Italy"), "I1");
  assert.equal(leagueCodeFromName("Ligue 1 - France"), "F1");
});

test("leagueCodeFromName maps HKJC tournament names (English and Chinese)", () => {
  assert.equal(leagueCodeFromName("English Premier League"), "E0");
  assert.equal(leagueCodeFromName("英格蘭超級聯賽"), "E0");
  assert.equal(leagueCodeFromName("西班牙甲組聯賽"), "SP1");
  assert.equal(leagueCodeFromName("德國甲組聯賽"), "D1");
  assert.equal(leagueCodeFromName("意大利甲組聯賽"), "I1");
  assert.equal(leagueCodeFromName("法國甲組聯賽"), "F1");
});

test("leagueCodeFromName rejects lookalike and unknown leagues", () => {
  assert.equal(leagueCodeFromName("Hong Kong Premier League"), null);
  assert.equal(leagueCodeFromName("Premiership - Scotland"), null);
  assert.equal(leagueCodeFromName("La Liga 2 - Spain"), null);
  assert.equal(leagueCodeFromName("Bundesliga 2 - Germany"), null);
  assert.equal(leagueCodeFromName("Serie B - Italy"), null);
  assert.equal(leagueCodeFromName("Ligue 2 - France"), null);
  assert.equal(leagueCodeFromName("EFL Championship"), null);
  assert.equal(leagueCodeFromName(""), null);
  assert.equal(leagueCodeFromName(null), null);
  assert.equal(leagueCodeFromName(undefined), null);
});

// ---------- team name canonicalization ----------

test("canonicalTeamName strips case, punctuation and diacritics", () => {
  assert.equal(canonicalTeamName("Alavés"), "alaves");
  assert.equal(canonicalTeamName("Nott'm Forest"), "nottmforest");
  assert.equal(canonicalTeamName("1. FC Köln"), "1fckoln");
  assert.equal(canonicalTeamName(" Borussia  Mönchengladbach "), "borussiamonchengladbach");
  assert.equal(canonicalTeamName(""), "");
  assert.equal(canonicalTeamName(null), "");
});

const FIT_TEAMS = [
  "Arsenal", "Man United", "Tottenham", "Nott'm Forest", "Brighton", "Wolves",
  "Ath Bilbao", "Ath Madrid", "Celta", "Osasuna", "Vallecano", "Betis", "Espanol",
  "Dortmund", "M'gladbach", "Ein Frankfurt", "FC Koln", "Hoffenheim", "Leverkusen",
  "Mainz", "Union Berlin", "St Pauli", "Milan", "Roma", "Inter", "Verona",
  "Monaco", "Lens", "Paris SG", "Marseille", "Lyon",
];

test("resolveTeamName matches football-data names directly after normalization", () => {
  assert.equal(resolveTeamName("Arsenal", FIT_TEAMS), "Arsenal");
  assert.equal(resolveTeamName("arsenal", FIT_TEAMS), "Arsenal");
  assert.equal(resolveTeamName("Alavés", ["Alaves"]), "Alaves");
});

test("resolveTeamName maps The Odds API aliases to football-data names", () => {
  assert.equal(resolveTeamName("Manchester United", FIT_TEAMS), "Man United");
  assert.equal(resolveTeamName("Tottenham Hotspur", FIT_TEAMS), "Tottenham");
  assert.equal(resolveTeamName("Nottingham Forest", FIT_TEAMS), "Nott'm Forest");
  assert.equal(resolveTeamName("Brighton and Hove Albion", FIT_TEAMS), "Brighton");
  assert.equal(resolveTeamName("Wolverhampton Wanderers", FIT_TEAMS), "Wolves");
  assert.equal(resolveTeamName("Athletic Bilbao", FIT_TEAMS), "Ath Bilbao");
  assert.equal(resolveTeamName("Atlético Madrid", FIT_TEAMS), "Ath Madrid");
  assert.equal(resolveTeamName("Celta Vigo", FIT_TEAMS), "Celta");
  assert.equal(resolveTeamName("CA Osasuna", FIT_TEAMS), "Osasuna");
  assert.equal(resolveTeamName("Rayo Vallecano", FIT_TEAMS), "Vallecano");
  assert.equal(resolveTeamName("Real Betis", FIT_TEAMS), "Betis");
  assert.equal(resolveTeamName("Espanyol", FIT_TEAMS), "Espanol");
  assert.equal(resolveTeamName("Borussia Dortmund", FIT_TEAMS), "Dortmund");
  assert.equal(resolveTeamName("Borussia Monchengladbach", FIT_TEAMS), "M'gladbach");
  assert.equal(resolveTeamName("Borussia Mönchengladbach", FIT_TEAMS), "M'gladbach");
  assert.equal(resolveTeamName("Eintracht Frankfurt", FIT_TEAMS), "Ein Frankfurt");
  assert.equal(resolveTeamName("1. FC Köln", FIT_TEAMS), "FC Koln");
  assert.equal(resolveTeamName("TSG Hoffenheim", FIT_TEAMS), "Hoffenheim");
  assert.equal(resolveTeamName("Bayer Leverkusen", FIT_TEAMS), "Leverkusen");
  assert.equal(resolveTeamName("FSV Mainz 05", FIT_TEAMS), "Mainz");
  assert.equal(resolveTeamName("1. FC Union Berlin", FIT_TEAMS), "Union Berlin");
  assert.equal(resolveTeamName("FC St. Pauli", FIT_TEAMS), "St Pauli");
  assert.equal(resolveTeamName("AC Milan", FIT_TEAMS), "Milan");
  assert.equal(resolveTeamName("AS Roma", FIT_TEAMS), "Roma");
  assert.equal(resolveTeamName("Inter Milan", FIT_TEAMS), "Inter");
  assert.equal(resolveTeamName("Hellas Verona", FIT_TEAMS), "Verona");
  assert.equal(resolveTeamName("AS Monaco", FIT_TEAMS), "Monaco");
  assert.equal(resolveTeamName("RC Lens", FIT_TEAMS), "Lens");
  assert.equal(resolveTeamName("Paris Saint-Germain", FIT_TEAMS), "Paris SG");
  assert.equal(resolveTeamName("Olympique Marseille", FIT_TEAMS), "Marseille");
  assert.equal(resolveTeamName("Olympique Lyonnais", FIT_TEAMS), "Lyon");
});

test("resolveTeamName returns null for teams outside the fit", () => {
  assert.equal(resolveTeamName("Elversberg", FIT_TEAMS), null);
  assert.equal(resolveTeamName("APIA Leichhardt", FIT_TEAMS), null);
  assert.equal(resolveTeamName("", FIT_TEAMS), null);
});

// ---------- quote evaluation (five-state economics) ----------

test("quoteEvaluation reduces to chance/edge/minimumBuyOdds for two-way win-loss", () => {
  const evaluation = quoteEvaluation({ win: 0.5, "half-win": 0, push: 0, "half-loss": 0, loss: 0.5 }, 2.2);
  assert.ok(Math.abs(evaluation.edge - 0.1) < 1e-12); // 0.5 * 1.2 - 0.5
  assert.ok(Math.abs(evaluation.chance - 0.5) < 1e-12); // (1 + edge) / odds
  assert.equal(evaluation.minimumBuyOdds, minimumBuyOdds(0.5)); // 2.06
});

test("quoteEvaluation prices push-heavy lines exactly", () => {
  const dist = { win: 0.4, "half-win": 0, push: 0.3, "half-loss": 0, loss: 0.3 };
  const evaluation = quoteEvaluation(dist, 2.0);
  assert.ok(Math.abs(evaluation.edge - 0.1) < 1e-12); // 0.4 * 1 - 0.3
  assert.ok(Math.abs(evaluation.chance - 0.55) < 1e-12); // (1 + 0.1) / 2
  // break-even + 3%: a = 0.4, o* = (0.03 + 0.4 + 0.3) / 0.4 = 1.825 → 1.83
  assert.equal(evaluation.minimumBuyOdds, 1.83);
  assert.ok(settlementEV(dist, evaluation.minimumBuyOdds) >= 0.03);
});

test("quoteEvaluation prices quarter lines with half states exactly", () => {
  const dist = { win: 0.3, "half-win": 0.2, push: 0, "half-loss": 0.1, loss: 0.4 };
  const evaluation = quoteEvaluation(dist, 2.5);
  // ev = 0.3 * 1.5 + 0.2 * 0.75 - 0.1 * 0.5 - 0.4 = 0.15
  assert.ok(Math.abs(evaluation.edge - 0.15) < 1e-12);
  assert.ok(Math.abs(evaluation.chance - 0.46) < 1e-12); // 1.15 / 2.5
  // a = 0.3 + 0.1 = 0.4, o* = (0.03 + 0.4 + 0.05 + 0.4) / 0.4 = 2.2
  assert.equal(evaluation.minimumBuyOdds, 2.2);
  assert.ok(settlementEV(dist, evaluation.minimumBuyOdds) >= 0.03);
});

test("quoteEvaluation keeps chance inside [0, 1] even for heavy underdogs", () => {
  const evaluation = quoteEvaluation({ win: 0.05, "half-win": 0, push: 0, "half-loss": 0, loss: 0.95 }, 12);
  assert.ok(evaluation.chance >= 0 && evaluation.chance <= 1);
  assert.ok(evaluation.edge < 0); // 0.05 * 11 - 0.95 < 0
});

test("quoteEvaluation returns null when the selection can never win", () => {
  assert.equal(quoteEvaluation({ win: 0, "half-win": 0, push: 0.4, "half-loss": 0, loss: 0.6 }, 5), null);
  assert.equal(quoteEvaluation({ win: 0.5, "half-win": 0, push: 0, "half-loss": 0, loss: 0.5 }, 1), null);
  assert.equal(quoteEvaluation({ win: 0.5, "half-win": 0, push: 0, "half-loss": 0, loss: 0.5 }, Number.NaN), null);
});

// ---------- totals settlement distribution ----------

test("totalsSettlementDist settles half lines", () => {
  const totals = new Map([[0, 0.1], [1, 0.2], [2, 0.3], [3, 0.25], [4, 0.15]]);
  const over = totalsSettlementDist(totals, 2.5, "over");
  assert.ok(Math.abs(over.win - 0.4) < 1e-12);
  assert.ok(Math.abs(over.loss - 0.6) < 1e-12);
  const under = totalsSettlementDist(totals, 2.5, "under");
  assert.ok(Math.abs(under.win - 0.6) < 1e-12);
  assert.ok(Math.abs(under.loss - 0.4) < 1e-12);
});

test("totalsSettlementDist settles integer lines with push", () => {
  const totals = new Map([[1, 0.3], [2, 0.4], [3, 0.3]]);
  const over = totalsSettlementDist(totals, 2, "over");
  assert.ok(Math.abs(over.win - 0.3) < 1e-12);
  assert.ok(Math.abs(over.push - 0.4) < 1e-12);
  assert.ok(Math.abs(over.loss - 0.3) < 1e-12);
});

test("totalsSettlementDist settles quarter lines with half states", () => {
  const totals = new Map([[1, 0.2], [2, 0.5], [3, 0.3]]);
  const over = totalsSettlementDist(totals, 2.25, "over");
  // sublines 2 and 2.5: total 2 → push half + loss half → half-loss
  assert.ok(Math.abs(over.win - 0.3) < 1e-12);
  assert.ok(Math.abs(over["half-loss"] - 0.5) < 1e-12);
  assert.ok(Math.abs(over.loss - 0.2) < 1e-12);
  const under = totalsSettlementDist(totals, 2.75, "under");
  // sublines 2.5 and 3: total 3 → loss half + push half → half-loss
  assert.ok(Math.abs(under["half-loss"] - 0.3) < 1e-12);
  assert.ok(Math.abs(under.win - 0.7) < 1e-12);
});

// ---------- buildShadowOpportunities ----------

function shadowFit() {
  return {
    attack: { Alpha: 0.25, Beta: -0.15 },
    defence: { Alpha: 0.1, Beta: -0.2 },
    intercept: Math.log(1.25),
    homeAdv: 0.22,
    rho: -0.06,
    teams: ["Alpha", "Beta"],
  };
}

function shadowDists(fit = shadowFit(), home = "Alpha", away = "Beta") {
  const { lambda, mu } = expectedGoals(fit, home, away);
  const matrix = scoreMatrix(lambda, mu, fit.rho);
  return {
    matrix,
    h2h: marketProbabilities(matrix),
    totals: goalTotalDistribution(matrix),
    margins: marginDistribution(matrix),
  };
}

function quoteRow(overrides) {
  return {
    fixtureId: "fix-1",
    matchId: "match-1",
    homeTeam: "Alpha United",
    awayTeam: "Beta City",
    commenceTime: "2026-08-20T12:00:00.000Z",
    league: "Test Premier League",
    provider: "hdc",
    bookmaker: "Book A",
    market: "h2h",
    selection: "home",
    odds: 2.5,
    observedAt: "2026-08-20T09:00:00.000Z",
    ...overrides,
  };
}

// alpha/beta fake league mapping relies on a registered test league name.
const FITS = new Map([["E0", { ...shadowFit(), teams: ["Alpha United", "Beta City"] }]]);

function englishRows(...rows) {
  return rows.map((row) => ({ ...row, league: "EPL" }));
}

test("buildShadowOpportunities emits dc probabilities for h2h with unified-shaped quotes", () => {
  const dists = shadowDists(FITS.get("E0"), "Alpha United", "Beta City");
  const homeChance = dists.h2h.home;
  const generous = 1 / homeChance + 0.4; // clears the 3% gate comfortably
  const rows = englishRows(
    quoteRow({ homeTeam: "Alpha United", awayTeam: "Beta City", selection: "home", odds: generous }),
    quoteRow({ selection: "draw", odds: 3.4 }),
    quoteRow({ selection: "away", odds: 3.1 }),
  );
  const opportunities = buildShadowOpportunities(rows, FITS);
  const home = opportunities.find((item) => item.market === "h2h" && item.selection === "home");
  assert.ok(home);
  assert.equal(home.strategyVersion, DC_SHADOW_STRATEGY_VERSION);
  assert.equal(home.modelVersion, DC_MODEL_VERSION);
  assert.equal(home.fixtureId, "fix-1");
  assert.equal(home.homeTeam, "Alpha United");
  assert.equal(home.quotes.length, 1);
  const quote = home.quotes[0];
  assert.ok(Math.abs(quote.chance - homeChance) < 1e-9);
  assert.ok(Math.abs(quote.edge - (generous * homeChance - 1)) < 1e-9);
  assert.equal(quote.minimumBuyOdds, minimumBuyOdds(homeChance));
  assert.equal(quote.bookmaker, "Book A");
  assert.equal(quote.provider, "hdc");
  assert.equal(quote.observedAt, "2026-08-20T09:00:00.000Z");
});

test("buildShadowOpportunities gates quotes below the 3% edge into empty shells", () => {
  const dists = shadowDists(FITS.get("E0"), "Alpha United", "Beta City");
  const stingy = 1 / dists.h2h.home; // zero edge
  const rows = englishRows(
    quoteRow({ selection: "home", odds: stingy }),
    quoteRow({ selection: "draw", odds: stingy }),
  );
  const opportunities = buildShadowOpportunities(rows, FITS);
  const home = opportunities.find((item) => item.market === "h2h" && item.selection === "home");
  assert.ok(home, "shell still emitted for the evaluated group");
  assert.equal(home.quotes.length, 0);
  assert.equal(opportunities.every((item) => item.quotes.length === 0), true);
});

test("buildShadowOpportunities prices totals lines with five-state economics", () => {
  const fit = FITS.get("E0");
  const dists = shadowDists(fit, "Alpha United", "Beta City");
  const overDist = totalsSettlementDist(dists.totals, 2.5, "over");
  const rows = englishRows(
    quoteRow({ market: "totals", selection: "over", line: 2.5, odds: 2.4 }),
    quoteRow({ market: "totals", selection: "under", line: 2.5, odds: 1.6 }),
  );
  const opportunities = buildShadowOpportunities(rows, FITS);
  const over = opportunities.find((item) => item.market === "totals" && item.selection === "over");
  const under = opportunities.find((item) => item.market === "totals" && item.selection === "under");
  for (const [item, dist, odds] of [[over, overDist, 2.4], [under, totalsSettlementDist(dists.totals, 2.5, "under"), 1.6]]) {
    const expectedEV = settlementEV(dist, odds);
    if (expectedEV >= 0.03) {
      assert.equal(item.quotes.length, 1);
      assert.ok(Math.abs(item.quotes[0].edge - expectedEV) < 1e-9);
      assert.ok(Math.abs(item.quotes[0].chance - (1 + expectedEV) / odds) < 1e-9);
    } else {
      assert.equal(item.quotes.length, 0);
    }
  }
});

test("buildShadowOpportunities prices quarter handicap lines with half states", () => {
  const fit = FITS.get("E0");
  const dists = shadowDists(fit, "Alpha United", "Beta City");
  const homeDist = handicapSettlementDist(dists.margins, -0.75, "home");
  const rows = englishRows(
    quoteRow({ market: "handicap", selection: "home", line: -0.75, odds: 2.1 }),
    quoteRow({ market: "handicap", selection: "away", line: -0.75, odds: 1.85 }),
  );
  const opportunities = buildShadowOpportunities(rows, FITS);
  const home = opportunities.find((item) => item.market === "handicap" && item.selection === "home");
  assert.equal(home.line, -0.75);
  const expectedEV = settlementEV(homeDist, 2.1);
  if (expectedEV >= 0.03) {
    assert.equal(home.quotes.length, 1);
    assert.ok(Math.abs(home.quotes[0].edge - expectedEV) < 1e-9);
    assert.ok(Math.abs(home.quotes[0].chance - (1 + expectedEV) / 2.1) < 1e-9);
    assert.ok(settlementEV(homeDist, home.quotes[0].minimumBuyOdds) >= 0.03 - 1e-9);
  } else {
    assert.equal(home.quotes.length, 0);
  }
});

test("buildShadowOpportunities qualifies multiple bookmakers independently", () => {
  const dists = shadowDists(FITS.get("E0"), "Alpha United", "Beta City");
  const fair = 1 / dists.h2h.home;
  const rows = englishRows(
    quoteRow({ selection: "home", odds: fair + 0.5, bookmaker: "Book A" }),
    quoteRow({ selection: "home", odds: fair + 0.2, bookmaker: "Book B", provider: "hkjc" }),
    quoteRow({ selection: "home", odds: fair - 0.2, bookmaker: "Book C" }),
  );
  const opportunities = buildShadowOpportunities(rows, FITS);
  const home = opportunities.find((item) => item.market === "h2h" && item.selection === "home");
  assert.deepEqual(home.quotes.map((quote) => quote.bookmaker), ["Book A", "Book B"]); // odds desc
  // owner row preference: hkjc provider supplies display fields
  assert.equal(home.quotes[1].provider, "hkjc");
});

test("buildShadowOpportunities skips unmappable leagues, teams and corners", () => {
  const rows = [
    quoteRow({ league: "Hong Kong Premier League" }), // unknown league
    quoteRow({ league: "EPL", homeTeam: "Elversberg", awayTeam: "Beta City", fixtureId: "fix-2" }), // unknown team
    quoteRow({ league: "EPL", market: "corners", selection: "over", line: 9.5, fixtureId: "fix-3" }), // unsupported market
  ];
  assert.deepEqual(buildShadowOpportunities(rows, FITS), []);
});

test("buildShadowOpportunities uses the league from any row when the owner row lacks one", () => {
  const rows = [
    quoteRow({ league: undefined, provider: "hkjc", selection: "home", odds: 5 }),
    quoteRow({ league: "EPL", provider: "hdc", selection: "away", odds: 5 }),
  ];
  const opportunities = buildShadowOpportunities(rows, FITS);
  assert.ok(opportunities.length > 0);
  assert.equal(opportunities[0].strategyVersion, DC_SHADOW_STRATEGY_VERSION);
});

test("buildShadowOpportunities returns nothing without a fit for the league", () => {
  const rows = englishRows(quoteRow({ selection: "home", odds: 9 }));
  assert.deepEqual(buildShadowOpportunities(rows, new Map()), []);
});

// ---------- fitLeagues ----------

test("fitLeagues fits only the requested leagues and tolerates thin data", () => {
  const history = [];
  const rng = (seed => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)(42);
  const teams = ["Alpha", "Beta", "Gamma", "Delta"];
  for (let day = 0; day < 120; day += 7) {
    for (let pair = 0; pair < 2; pair += 1) {
      const home = teams[(day / 7 + pair) % 4];
      const away = teams[(day / 7 + pair + 1) % 4];
      history.push({
        league_code: "E0",
        match_date: `2026-01-${String((day % 27) + 1).padStart(2, "0")}`,
        home_team: home,
        away_team: away,
        home_goals: Math.floor(rng() * 4),
        away_goals: Math.floor(rng() * 3),
      });
    }
  }
  history.push({ league_code: "SP1", match_date: "2026-01-04", home_team: "Solo", away_team: "Solo B", home_goals: 1, away_goals: 0 });
  const fits = fitLeagues(history, ["E0", "SP1", "D1"], "2026-08-01T00:00:00.000Z");
  assert.ok(fits.get("E0")?.teams.includes("Alpha"));
  assert.equal(fits.has("SP1"), true); // two teams, one match — still fittable
  assert.equal(fits.has("D1"), false); // no history at all
});

// ---------- dc-v2 blend ----------

test("blendQuoteEvaluation combines market and model EV exactly", () => {
  const dist = { win: 0.5, "half-win": 0, push: 0, "half-loss": 0, loss: 0.5 };
  const evaluation = blendQuoteEvaluation(dist, 0.48, 2.2, 0.3);
  // edge = 0.7 * (0.48*2.2 - 1) + 0.3 * (0.5*1.2 - 0.5) = 0.7*0.056 + 0.3*0.1
  assert.ok(Math.abs(evaluation.edge - 0.0692) < 1e-9);
  assert.ok(Math.abs(evaluation.chance - (1 + 0.0692) / 2.2) < 1e-9);
  // breakeven = (0.03 + 0.7 + 0.3) / (0.7*0.48 + 0.3*0.5) = 1.03 / 0.486
  assert.equal(evaluation.minimumBuyOdds, 2.12);
  const blendedAtMin = 0.7 * (0.48 * evaluation.minimumBuyOdds - 1)
    + 0.3 * settlementEV(dist, evaluation.minimumBuyOdds);
  assert.ok(blendedAtMin >= 0.03 - 1e-9);
});

test("blendQuoteEvaluation reduces to a probability blend for h2h", () => {
  const dist = { win: 0.4, "half-win": 0, push: 0, "half-loss": 0, loss: 0.6 };
  const evaluation = blendQuoteEvaluation(dist, 0.45, 2.5, 0.3);
  assert.ok(Math.abs(evaluation.chance - (0.7 * 0.45 + 0.3 * 0.4)) < 1e-12);
  assert.ok(Math.abs(evaluation.edge - (evaluation.chance * 2.5 - 1)) < 1e-12);
});

test("blendQuoteEvaluation rejects missing market reference or unwinnable sides", () => {
  const dist = { win: 0.5, "half-win": 0, push: 0, "half-loss": 0, loss: 0.5 };
  assert.equal(blendQuoteEvaluation(dist, null, 2), null);
  assert.equal(blendQuoteEvaluation(dist, 0, 2), null);
  assert.equal(blendQuoteEvaluation({ win: 0, "half-win": 0, push: 1, "half-loss": 0, loss: 0 }, 0.5, 2), null);
  assert.equal(blendQuoteEvaluation(dist, 0.5, 1), null);
});

function blendBook(bookmaker, provider, homeOdds, drawOdds, awayOdds) {
  return [
    quoteRow({ bookmaker, provider, selection: "home", odds: homeOdds }),
    quoteRow({ bookmaker, provider, selection: "draw", odds: drawOdds }),
    quoteRow({ bookmaker, provider, selection: "away", odds: awayOdds }),
  ];
}

test("buildBlendOpportunities prices h2h against the model-market blend", () => {
  const rows = englishRows(
    ...blendBook("Pinnacle", "hdc", 2.0, 3.5, 3.8),
    ...blendBook("1xBet", "hdc", 2.6, 3.3, 2.8),
  );
  const opportunities = buildBlendOpportunities(rows, FITS);
  const home = opportunities.find((item) => item.market === "h2h" && item.selection === "home");
  assert.ok(home);
  assert.equal(home.strategyVersion, DC_BLEND_STRATEGY_VERSION);
  assert.equal(home.modelVersion, DC_BLEND_MODEL_VERSION);

  const fit = FITS.get("E0");
  const dists = shadowDists(fit, "Alpha United", "Beta City");
  const marketChance = marketReferenceChance(rows, "h2h", "home");
  const expectedChance = 0.7 * marketChance + 0.3 * dists.h2h.home;
  const softQuote = home.quotes.find((quote) => quote.bookmaker === "1xBet");
  assert.ok(softQuote, "the soft book's 2.6 overlay clears the blended gate");
  assert.ok(Math.abs(softQuote.chance - expectedChance) < 1e-9);
  assert.ok(Math.abs(softQuote.edge - (expectedChance * 2.6 - 1)) < 1e-9);
  // The blend sits between the two components.
  assert.ok(expectedChance > Math.min(marketChance, dists.h2h.home));
  assert.ok(expectedChance < Math.max(marketChance, dists.h2h.home));
});

test("buildBlendOpportunities prices totals with the five-state model side", () => {
  const rows = englishRows(
    quoteRow({ market: "totals", selection: "over", line: 2.5, odds: 2.6, bookmaker: "Pinnacle" }),
    quoteRow({ market: "totals", selection: "under", line: 2.5, odds: 1.55, bookmaker: "Pinnacle" }),
    quoteRow({ market: "totals", selection: "over", line: 2.5, odds: 2.5, bookmaker: "Bet365" }),
    quoteRow({ market: "totals", selection: "under", line: 2.5, odds: 1.6, bookmaker: "Bet365" }),
  );
  const opportunities = buildBlendOpportunities(rows, FITS);
  const over = opportunities.find((item) => item.market === "totals" && item.selection === "over");
  assert.ok(over);
  const fit = FITS.get("E0");
  const dists = shadowDists(fit, "Alpha United", "Beta City");
  const overDist = totalsSettlementDist(dists.totals, 2.5, "over");
  const marketChance = marketReferenceChance(rows, "totals", "over");
  for (const quote of over.quotes) {
    const expectedEdge = 0.7 * (marketChance * quote.odds - 1) + 0.3 * settlementEV(overDist, quote.odds);
    assert.ok(Math.abs(quote.edge - expectedEdge) < 1e-9);
    assert.ok(quote.edge >= 0.03);
  }
});

test("buildBlendOpportunities emits empty shells when no complete book exists", () => {
  const rows = englishRows(
    quoteRow({ market: "totals", selection: "over", line: 2.5, odds: 9, bookmaker: "Lone Book" }),
    // no under → no complete book → no market reference
  );
  const opportunities = buildBlendOpportunities(rows, FITS);
  assert.equal(opportunities.length, 2); // over + under shells
  assert.equal(opportunities.every((item) => item.quotes.length === 0), true);
});

test("buildBlendOpportunities skips unmappable fixtures like the pure shadow", () => {
  const rows = [
    quoteRow({ league: "Hong Kong Premier League" }),
    quoteRow({ league: "EPL", homeTeam: "Elversberg", awayTeam: "Beta City", fixtureId: "fix-9" }),
  ];
  assert.deepEqual(buildBlendOpportunities(rows, FITS), []);
});
