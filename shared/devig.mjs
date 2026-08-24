// Shared, pure de-vig primitives used by shadow market consensus and the
// quote-quality gate. Inputs are decimal odds; outputs are fair probabilities.

export function shinNoVigThreeWay(odds) {
  if (!Array.isArray(odds) || odds.length !== 3 || !odds.every(validDecimalOdds)) return null;
  const implied = odds.map((value) => 1 / value);
  const overround = implied.reduce((sum, value) => sum + value, 0);
  const proportional = () => implied.map((value) => value / overround);
  if (overround <= 1) return proportional();

  const sumAt = (z) => implied.reduce((sum, value) => sum + (
    (Math.sqrt(z * z + (4 * (1 - z) * value * value) / overround) - z) / (2 * (1 - z))
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
  return implied.map((value) => (
    (Math.sqrt(z * z + (4 * (1 - z) * value * value) / overround) - z) / (2 * (1 - z))
  ));
}

export function powerNoVigTwoWayOdds(oddsA, oddsB) {
  if (!validDecimalOdds(oddsA) || !validDecimalOdds(oddsB)) return null;
  const qA = 1 / oddsA;
  const qB = 1 / oddsB;
  if (qA + qB <= 1) return [qA / (qA + qB), qB / (qA + qB)];

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

function validDecimalOdds(value) {
  return Number.isFinite(value) && value > 1;
}
