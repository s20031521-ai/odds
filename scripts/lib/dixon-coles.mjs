// dc-v1: Dixon-Coles time-decayed Poisson model (pure functions, zero dependencies).
//
// log λ_home = intercept + homeAdv + attack[home] − defence[away]
// log μ_away = intercept + attack[away] − defence[home]
// Low-score cells (0-0, 1-0, 0-1, 1-1) adjusted by Dixon-Coles tau/rho.
// Match weights decay as exp(−xi × days before refDate).
//
// Fitting: coordinate-wise Newton sweeps over attack/defence/intercept/homeAdv
// (tau treated as constant during those updates), alternating with an exact
// Newton step for rho on the tau-adjusted likelihood. Attacks and defences
// are re-centred after every sweep for identifiability.
//
// This engine is an *experiment* under ADR 0003: it runs under its own
// modelVersion and does not touch the existing four models.

const MAX_GOALS = 10;
const LOG_RATE_MIN = -8;
const LOG_RATE_MAX = 3;
const STEP_CAP = 0.3;
const RHO_STEP_CAP = 0.05;
const RHO_BOUNDS = [-0.35, 0.25];

// ---------- deterministic RNG + Poisson sampler (test/synthetic-data use) ----------

export function createRng(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function samplePoisson(rng, lambda) {
  if (!(lambda > 0)) return 0;
  if (lambda < 30) {
    const limit = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k += 1;
      p *= rng();
    } while (p > limit);
    return k - 1;
  }
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z));
}

// ---------- Poisson PMF + Dixon-Coles tau ----------

const LOG_FACTORIAL = [0];
function logFactorial(n) {
  for (let i = LOG_FACTORIAL.length; i <= n; i += 1) {
    LOG_FACTORIAL[i] = LOG_FACTORIAL[i - 1] + Math.log(i);
  }
  return LOG_FACTORIAL[n];
}

export function poissonPmf(k, lambda) {
  if (k < 0) return 0;
  return Math.exp(k * Math.log(lambda) - lambda - logFactorial(k));
}

export function tau(homeGoals, awayGoals, lambda, mu, rho) {
  if (homeGoals === 0 && awayGoals === 0) return 1 - lambda * mu * rho;
  if (homeGoals === 1 && awayGoals === 0) return 1 + mu * rho;
  if (homeGoals === 0 && awayGoals === 1) return 1 + lambda * rho;
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho;
  return 1;
}

// ---------- fitting ----------

function daysBetween(earlierIso, laterMs) {
  return (laterMs - Date.parse(`${earlierIso}T00:00:00Z`)) / 86_400_000;
}

function clampLogRate(value) {
  return Math.min(LOG_RATE_MAX, Math.max(LOG_RATE_MIN, value));
}

export function fitDixonColes(matches, { xi = 0.0019, refDate, maxOuter = 10, sweepsPerOuter = 8, tolerance = 1e-7, init } = {}) {
  const usable = (Array.isArray(matches) ? matches : []).filter((m) =>
    m && m.homeTeam && m.awayTeam && Number.isInteger(m.homeGoals) && Number.isInteger(m.awayGoals) && m.matchDate,
  );
  const teams = [...new Set(usable.flatMap((m) => [m.homeTeam, m.awayTeam]))];
  if (teams.length < 2 || usable.length === 0) throw new Error("fitDixonColes needs matches from at least two teams");

  const refMs = refDate ? Date.parse(refDate) : Math.max(...usable.map((m) => Date.parse(`${m.matchDate}T00:00:00Z`))) + 86_400_000;
  const data = usable.map((m, index) => ({
    index,
    home: m.homeTeam,
    away: m.awayTeam,
    homeGoals: m.homeGoals,
    awayGoals: m.awayGoals,
    weight: Math.exp(-xi * Math.max(0, daysBetween(m.matchDate, refMs))),
  }));
  const gamesByTeam = new Map(teams.map((t) => [t, { home: [], away: [] }]));
  for (const game of data) {
    gamesByTeam.get(game.home).home.push(game);
    gamesByTeam.get(game.away).away.push(game);
  }

  const meanGoals = data.reduce((sum, g) => sum + g.homeGoals + g.awayGoals, 0) / (2 * data.length);
  const params = {
    attack: Object.fromEntries(teams.map((t) => [t, Number.isFinite(init?.attack?.[t]) ? init.attack[t] : 0])),
    defence: Object.fromEntries(teams.map((t) => [t, Number.isFinite(init?.defence?.[t]) ? init.defence[t] : 0])),
    intercept: Number.isFinite(init?.intercept) ? init.intercept : Math.log(Math.max(0.5, meanGoals)),
    homeAdv: Number.isFinite(init?.homeAdv) ? init.homeAdv : 0.2,
    rho: Number.isFinite(init?.rho) ? init.rho : 0,
  };

  const rateHome = (g) => Math.exp(clampLogRate(params.intercept + params.homeAdv + params.attack[g.home] - params.defence[g.away]));
  const rateAway = (g) => Math.exp(clampLogRate(params.intercept + params.attack[g.away] - params.defence[g.home]));

  for (let outer = 0; outer < maxOuter; outer += 1) {
    let maxStep = 0;
    for (let sweep = 0; sweep < sweepsPerOuter; sweep += 1) {
      for (const team of teams) {
        const games = gamesByTeam.get(team);
        let score = 0;
        let information = 0;
        for (const g of games.home) {
          const lambda = rateHome(g);
          score += g.weight * (g.homeGoals - lambda);
          information += g.weight * lambda;
        }
        for (const g of games.away) {
          const mu = rateAway(g);
          score += g.weight * (g.awayGoals - mu);
          information += g.weight * mu;
        }
        const step = information > 0 ? Math.min(STEP_CAP, Math.max(-STEP_CAP, score / information)) : 0;
        params.attack[team] += step;
        maxStep = Math.max(maxStep, Math.abs(step));
      }
      for (const team of teams) {
        const games = gamesByTeam.get(team);
        let score = 0;
        let information = 0;
        for (const g of games.home) {
          const mu = rateAway(g);
          score -= g.weight * (g.awayGoals - mu);
          information += g.weight * mu;
        }
        for (const g of games.away) {
          const lambda = rateHome(g);
          score -= g.weight * (g.homeGoals - lambda);
          information += g.weight * lambda;
        }
        const step = information > 0 ? Math.min(STEP_CAP, Math.max(-STEP_CAP, score / information)) : 0;
        params.defence[team] += step;
        maxStep = Math.max(maxStep, Math.abs(step));
      }
      {
        let score = 0;
        let information = 0;
        let homeScore = 0;
        let homeInformation = 0;
        for (const g of data) {
          const lambda = rateHome(g);
          const mu = rateAway(g);
          score += g.weight * (g.homeGoals - lambda + g.awayGoals - mu);
          information += g.weight * (lambda + mu);
          homeScore += g.weight * (g.homeGoals - lambda);
          homeInformation += g.weight * lambda;
        }
        const interceptStep = information > 0 ? Math.min(STEP_CAP, Math.max(-STEP_CAP, score / information)) : 0;
        const homeStep = homeInformation > 0 ? Math.min(STEP_CAP, Math.max(-STEP_CAP, homeScore / homeInformation)) : 0;
        params.intercept += interceptStep;
        params.homeAdv += homeStep;
        maxStep = Math.max(maxStep, Math.abs(interceptStep), Math.abs(homeStep));
      }
      centre(params.attack, teams);
      centre(params.defence, teams);
    }
    params.rho = rhoStep(data, rateHome, rateAway, params.rho);
    if (maxStep < tolerance) break;
  }

  return {
    attack: params.attack,
    defence: params.defence,
    intercept: params.intercept,
    homeAdv: params.homeAdv,
    rho: params.rho,
    teams,
    xi,
    refDate: new Date(refMs).toISOString().slice(0, 10),
    matchCount: data.length,
  };
}

function centre(values, teams) {
  const mean = teams.reduce((sum, t) => sum + values[t], 0) / teams.length;
  for (const t of teams) values[t] -= mean;
}

function rhoStep(data, rateHome, rateAway, rho) {
  let score = 0;
  let information = 0;
  for (const g of data) {
    const derivative = tauDerivative(g.homeGoals, g.awayGoals, rateHome(g), rateAway(g));
    if (derivative === 0) continue;
    const adjusted = tau(g.homeGoals, g.awayGoals, rateHome(g), rateAway(g), rho);
    if (adjusted <= 0) continue;
    score += g.weight * (derivative / adjusted);
    information += g.weight * (derivative / adjusted) ** 2;
  }
  if (information === 0) return rho;
  const step = Math.min(RHO_STEP_CAP, Math.max(-RHO_STEP_CAP, score / information));
  return Math.min(RHO_BOUNDS[1], Math.max(RHO_BOUNDS[0], rho + step));
}

function tauDerivative(homeGoals, awayGoals, lambda, mu) {
  if (homeGoals === 0 && awayGoals === 0) return -lambda * mu;
  if (homeGoals === 1 && awayGoals === 0) return mu;
  if (homeGoals === 0 && awayGoals === 1) return lambda;
  if (homeGoals === 1 && awayGoals === 1) return -1;
  return 0;
}

// ---------- prediction ----------

export function expectedGoals(fit, homeTeam, awayTeam) {
  const attackHome = fit.attack[homeTeam] ?? 0;
  const defenceHome = fit.defence[homeTeam] ?? 0;
  const attackAway = fit.attack[awayTeam] ?? 0;
  const defenceAway = fit.defence[awayTeam] ?? 0;
  return {
    lambda: Math.exp(clampLogRate(fit.intercept + fit.homeAdv + attackHome - defenceAway)),
    mu: Math.exp(clampLogRate(fit.intercept + attackAway - defenceHome)),
  };
}

export function scoreMatrix(lambda, mu, rho, maxGoals = MAX_GOALS) {
  const matrix = [];
  let total = 0;
  for (let h = 0; h <= maxGoals; h += 1) {
    const row = [];
    for (let a = 0; a <= maxGoals; a += 1) {
      const p = tau(h, a, lambda, mu, rho) * poissonPmf(h, lambda) * poissonPmf(a, mu);
      row.push(p);
      total += p;
    }
    matrix.push(row);
  }
  return matrix.map((row) => row.map((p) => p / total));
}

export function marketProbabilities(matrix) {
  let home = 0;
  let draw = 0;
  let away = 0;
  let over25 = 0;
  for (let h = 0; h < matrix.length; h += 1) {
    for (let a = 0; a < matrix[h].length; a += 1) {
      const p = matrix[h][a];
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
      if (h + a > 2.5) over25 += p;
    }
  }
  return { home, draw, away, over25, under25: 1 - over25 };
}

export function marginDistribution(matrix) {
  const margins = new Map();
  for (let h = 0; h < matrix.length; h += 1) {
    for (let a = 0; a < matrix[h].length; a += 1) {
      const margin = h - a;
      margins.set(margin, (margins.get(margin) ?? 0) + matrix[h][a]);
    }
  }
  return margins;
}

export function goalTotalDistribution(matrix) {
  const totals = new Map();
  for (let h = 0; h < matrix.length; h += 1) {
    for (let a = 0; a < matrix[h].length; a += 1) {
      const total = h + a;
      totals.set(total, (totals.get(total) ?? 0) + matrix[h][a]);
    }
  }
  return totals;
}

// Mirrors server/domain/backtest.mjs asianLines: quarter lines split into two half-lines.
export function asianLines(line) {
  const quarter = Math.round((line - Math.floor(line)) * 4) / 4;
  if (quarter === 0.25) return [Math.floor(line), Math.floor(line) + 0.5];
  if (quarter === 0.75) return [Math.floor(line) + 0.5, Math.floor(line) + 1];
  return [line];
}

export function handicapSettlementDist(margins, line, side) {
  const dist = emptySettlementDist();
  const sublines = asianLines(line);
  for (const [margin, prob] of margins) {
    let value = 0;
    for (const subline of sublines) {
      const adjusted = side === "home" ? margin + subline : -(margin + subline);
      value += Math.abs(adjusted) < 1e-9 ? 0 : Math.sign(adjusted);
    }
    addSettlementReturn(dist, value / sublines.length, prob);
  }
  return dist;
}

// Mirrors server/domain/backtest.mjs settle() for totals: quarter lines split
// into two half-lines, "over" wins when total > line, "under" when line > total.
export function totalsSettlementDist(totals, line, side) {
  const dist = emptySettlementDist();
  const sublines = asianLines(line);
  for (const [total, prob] of totals) {
    let value = 0;
    for (const subline of sublines) {
      value += side === "over" ? Math.sign(total - subline) : Math.sign(subline - total);
    }
    addSettlementReturn(dist, value / sublines.length, prob);
  }
  return dist;
}

function emptySettlementDist() {
  return { win: 0, "half-win": 0, push: 0, "half-loss": 0, loss: 0 };
}

function addSettlementReturn(dist, meanReturn, prob) {
  if (meanReturn === 1) dist.win += prob;
  else if (meanReturn === 0.5) dist["half-win"] += prob;
  else if (meanReturn === 0) dist.push += prob;
  else if (meanReturn === -0.5) dist["half-loss"] += prob;
  else dist.loss += prob;
}

export function settlementEV(dist, odds) {
  return (dist.win ?? 0) * (odds - 1)
    + (dist["half-win"] ?? 0) * ((odds - 1) / 2)
    + (dist.push ?? 0) * 0
    + (dist["half-loss"] ?? 0) * -0.5
    + (dist.loss ?? 0) * -1;
}
