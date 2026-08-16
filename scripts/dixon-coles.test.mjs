import test from "node:test";
import assert from "node:assert/strict";

import {
  fitDixonColes,
  expectedGoals,
  scoreMatrix,
  marketProbabilities,
  marginDistribution,
  handicapSettlementDist,
  settlementEV,
  createRng,
  samplePoisson,
} from "./lib/dixon-coles.mjs";

// ---------- helpers ----------

function makeSyntheticLeague({ seasons = 6, rho = 0 } = {}) {
  const teams = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"];
  const attack = { Alpha: 0.5, Bravo: 0.35, Charlie: 0.2, Delta: 0.1, Echo: -0.1, Foxtrot: -0.2, Golf: -0.35, Hotel: -0.5 };
  const defence = { Alpha: -0.4, Bravo: -0.25, Charlie: -0.15, Delta: -0.05, Echo: 0.05, Foxtrot: 0.15, Golf: 0.25, Hotel: 0.4 };
  const intercept = 0.15;
  const homeAdv = 0.25;
  const rng = createRng(42);
  const matches = [];
  const start = Date.UTC(2020, 7, 1);
  let day = 0;
  for (let season = 0; season < seasons; season += 1) {
    for (let round = 0; round < 2; round += 1) {
      for (const home of teams) {
        for (const away of teams) {
          if (home === away) continue;
          const lambda = Math.exp(intercept + homeAdv + attack[home] - defence[away]);
          const mu = Math.exp(intercept + attack[away] - defence[home]);
          let homeGoals; let awayGoals;
          if (rho === 0) {
            homeGoals = samplePoisson(rng, lambda);
            awayGoals = samplePoisson(rng, mu);
          } else {
            ({ homeGoals, awayGoals } = sampleCorrelated(rng, lambda, mu, rho));
          }
          matches.push({
            matchDate: new Date(start + day * 86_400_000).toISOString().slice(0, 10),
            homeTeam: home, awayTeam: away, homeGoals, awayGoals,
          });
          day += 2;
        }
      }
    }
  }
  return { matches, attack, defence, homeAdv };
}

function sampleCorrelated(rng, lambda, mu, rho) {
  const matrix = scoreMatrix(lambda, mu, rho, 8);
  let roll = rng();
  for (let h = 0; h <= 8; h += 1) {
    for (let a = 0; a <= 8; a += 1) {
      roll -= matrix[h][a];
      if (roll <= 0) return { homeGoals: h, awayGoals: a };
    }
  }
  return { homeGoals: 8, awayGoals: 8 };
}

// ---------- RNG / sampler ----------

test("seeded rng is deterministic and uniform-ish", () => {
  const a = createRng(7);
  const b = createRng(7);
  const seqA = Array.from({ length: 5 }, () => a());
  const seqB = Array.from({ length: 5 }, () => b());
  assert.deepEqual(seqA, seqB);
  assert.ok(seqA.every((v) => v >= 0 && v < 1));
});

test("samplePoisson recovers lambda as sample mean", () => {
  const rng = createRng(123);
  const lambda = 1.7;
  let sum = 0;
  const n = 20000;
  for (let i = 0; i < n; i += 1) sum += samplePoisson(rng, lambda);
  assert.ok(Math.abs(sum / n - lambda) < 0.05, `mean ${sum / n} vs ${lambda}`);
});

// ---------- fitting ----------

test("fitter recovers team strength ordering and home advantage", () => {
  const { matches, attack, homeAdv } = makeSyntheticLeague({ seasons: 8 });
  const fit = fitDixonColes(matches, { xi: 0 });
  const teams = Object.keys(attack);
  const fitOrder = [...teams].sort((a, b) => fit.attack[b] - fit.attack[a]);
  // mid-table teams with tiny true gaps (Echo -0.1 vs Foxtrot -0.2) sit inside
  // sampling noise, so assert strong rank correlation, not exact ordering
  const trueVals = teams.map((t) => attack[t]);
  const fitVals = teams.map((t) => fit.attack[t]);
  const meanT = trueVals.reduce((a, b) => a + b) / teams.length;
  const meanF = fitVals.reduce((a, b) => a + b) / teams.length;
  let cov = 0; let varT = 0; let varF = 0;
  for (let i = 0; i < teams.length; i += 1) {
    cov += (trueVals[i] - meanT) * (fitVals[i] - meanF);
    varT += (trueVals[i] - meanT) ** 2;
    varF += (fitVals[i] - meanF) ** 2;
  }
  const correlation = cov / Math.sqrt(varT * varF);
  assert.ok(correlation > 0.96, `attack correlation ${correlation}`);
  assert.equal(fitOrder[0], "Alpha");
  assert.equal(fitOrder[teams.length - 1], "Hotel");
  assert.ok(Math.abs(fit.homeAdv - homeAdv) < 0.1, `homeAdv ${fit.homeAdv} vs ${homeAdv}`);
  const meanAttack = teams.reduce((s, t) => s + fit.attack[t], 0) / teams.length;
  assert.ok(Math.abs(meanAttack) < 1e-9, "attacks are centred");
  const maxErr = Math.max(...teams.map((t) => Math.abs(fit.attack[t] - attack[t])));
  assert.ok(maxErr < 0.2, `max attack error ${maxErr}`);
});

test("fitter recovers a negative rho from correlated data", () => {
  const { matches } = makeSyntheticLeague({ seasons: 8, rho: -0.12 });
  const fit = fitDixonColes(matches, { xi: 0.001 });
  assert.ok(fit.rho < -0.03, `rho ${fit.rho} should be clearly negative`);
  assert.ok(fit.rho > -0.35, `rho ${fit.rho} should stay sane`);
});

test("fitter stays finite when a team never scores", () => {
  // three teams minimum: with only two teams the model is under-identified
  const rng = createRng(9);
  const matches = [];
  const teams = ["Strong", "Medium", "Goalless"];
  const lambdaFor = (home, away) =>
    home === "Goalless" || away === "Goalless" ? (home === "Goalless" ? 0 : 2.2) : 1.4;
  for (let round = 0; round < 40; round += 1) {
    for (const home of teams) {
      for (const away of teams) {
        if (home === away) continue;
        matches.push({
          matchDate: "2024-08-10",
          homeTeam: home,
          awayTeam: away,
          homeGoals: home === "Goalless" ? 0 : samplePoisson(rng, lambdaFor(home, away)),
          awayGoals: away === "Goalless" ? 0 : samplePoisson(rng, lambdaFor(home, away)),
        });
      }
    }
  }
  const fit = fitDixonColes(matches, { xi: 0 });
  assert.ok(Number.isFinite(fit.attack.Goalless));
  assert.ok(Number.isFinite(fit.defence.Goalless));
  assert.ok(fit.attack.Goalless < -1, `goalless attack ${fit.attack.Goalless} should be very low`);
  assert.ok(fit.attack.Goalless < fit.attack.Medium);
  assert.ok(fit.attack.Goalless < fit.attack.Strong);
});

// ---------- prediction ----------

test("score matrix normalises to one and respects rho sign", () => {
  const independent = scoreMatrix(1.5, 1.1, 0);
  const sum = independent.flat().reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  const correlated = scoreMatrix(1.5, 1.1, -0.15);
  // negative rho inflates 0-0 and 1-1 relative to independence
  assert.ok(correlated[0][0] > independent[0][0]);
  assert.ok(correlated[1][1] > independent[1][1]);
});

test("market probabilities sum to one and home favourite wins more often", () => {
  const fit = fitDixonColes(makeSyntheticLeague().matches, { xi: 0.001 });
  const { lambda, mu } = expectedGoals(fit, "Alpha", "Hotel");
  assert.ok(lambda > mu, "strong home team should out-xG weak away team");
  const probs = marketProbabilities(scoreMatrix(lambda, mu, fit.rho));
  const total = probs.home + probs.draw + probs.away;
  assert.ok(Math.abs(total - 1) < 1e-9);
  assert.ok(probs.home > 0.45, `Alpha at home vs Hotel should be clear favourite, got ${probs.home}`);
  assert.ok(probs.over25 + probs.under25 === 1);
});

test("totals probability matches analytic Poisson sum when rho is zero", () => {
  const lambda = 1.4;
  const mu = 1.2;
  const matrix = scoreMatrix(lambda, mu, 0);
  const probs = marketProbabilities(matrix);
  // total goals ~ Poisson(lambda + mu) exactly when independent
  let analyticUnder = 0;
  const totalLambda = lambda + mu;
  let term = Math.exp(-totalLambda);
  for (let k = 0; k <= 2; k += 1) {
    if (k > 0) term *= totalLambda / k;
    analyticUnder += term;
  }
  assert.ok(Math.abs(probs.under25 - analyticUnder) < 1e-6);
});

// ---------- handicap EV ----------

test("handicap settlement distribution: quarter line -0.25 settles a draw as half-loss, never push", () => {
  const matrix = scoreMatrix(1.6, 1.0, 0);
  const margins = marginDistribution(matrix);
  const pDraw = margins.get(0);
  const quarter = handicapSettlementDist(margins, -0.25, "home");
  // 亞洲盤語義：-0.25 = 半注 0 盤 + 半注 -0.5 盤。
  // 和局(margin 0)：0 盤嗰半注走盤、-0.5 嗰半注輸 → 合計「半輸」，唔可能存在 push。
  assert.ok(Math.abs(quarter["half-loss"] - pDraw) < 1e-12, `half-loss ${quarter["half-loss"]} vs P(draw) ${pDraw}`);
  assert.equal(quarter.push, 0);
  // 主隊贏任何波差：兩條子線全贏
  const winMass = [...margins].filter(([m]) => m >= 1).reduce((s, [, p]) => s + p, 0);
  assert.ok(Math.abs(quarter.win - winMass) < 1e-12);
  // 主隊輸任何波差：兩條子線全輸
  const lossMass = [...margins].filter(([m]) => m <= -1).reduce((s, [, p]) => s + p, 0);
  assert.ok(Math.abs(quarter.loss - lossMass) < 1e-12);
  // 機率總和為一
  const total = Object.values(quarter).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-12);
});

test("handicap settlement distribution matches backtest asianLines splitting", () => {
  const matrix = scoreMatrix(1.6, 1.0, 0);
  const margins = marginDistribution(matrix);
  const quarter = handicapSettlementDist(margins, -0.75, "home");
  // -0.75 = 半注 -0.5 + 半注 -1；主隊贏一球：-0.5 贏、-1 走盤 → 半贏
  const pWinBy1 = margins.get(1);
  assert.ok(Math.abs(quarter["half-win"] - pWinBy1) < 1e-12);
});

test("settlementEV matches manual five-state calculation", () => {
  const dist = { win: 0.5, "half-win": 0.1, push: 0.1, "half-loss": 0.1, loss: 0.2 };
  const odds = 2.0;
  // 0.5*(1) + 0.1*(0.5) + 0.1*0 + 0.1*(-0.5) + 0.2*(-1)
  const expected = 0.5 * 1 + 0.1 * 0.5 + 0.1 * 0 + 0.1 * -0.5 + 0.2 * -1;
  assert.ok(Math.abs(settlementEV(dist, odds) - expected) < 1e-12);
});

test("unknown teams fall back to league average without NaN", () => {
  const fit = fitDixonColes(makeSyntheticLeague().matches, { xi: 0.001 });
  const { lambda, mu } = expectedGoals(fit, "Alpha", "Newly Promoted FC");
  assert.ok(Number.isFinite(lambda) && Number.isFinite(mu));
  assert.ok(lambda > 1, "strong team at home vs unknown should still score freely");
});

test("warm start: refitting with prior params as init lands on the same answer", () => {
  const { matches } = makeSyntheticLeague({ seasons: 4 });
  const cold = fitDixonColes(matches, { xi: 0.001 });
  const warm = fitDixonColes(matches, { xi: 0.001, init: cold, maxOuter: 2, sweepsPerOuter: 3 });
  for (const team of Object.keys(cold.attack)) {
    assert.ok(Math.abs(warm.attack[team] - cold.attack[team]) < 0.01, `${team} drifted`);
    assert.ok(Math.abs(warm.defence[team] - cold.defence[team]) < 0.01, `${team} defence drifted`);
  }
  assert.ok(Math.abs(warm.homeAdv - cold.homeAdv) < 0.01);
  assert.ok(Math.abs(warm.rho - cold.rho) < 0.02);
});
