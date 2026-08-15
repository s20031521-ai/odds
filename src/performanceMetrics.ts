/** Aggregations for the 表現分析 overview (B4.1): overall accuracy, sparkline, 7-day rolling diff. */

export type SettledRow = {
  commenceTime: string;
  settlement?: "win" | "half-win" | "push" | "half-loss" | "loss";
  modelVersion?: string;
};

const DAY_MS = 86_400_000;

function isWin(s: SettledRow["settlement"]): boolean {
  return s === "win" || s === "half-win";
}

function isLoss(s: SettledRow["settlement"]): boolean {
  return s === "loss" || s === "half-loss";
}

function decided(rows: SettledRow[]): SettledRow[] {
  return rows.filter((r) => isWin(r.settlement) || isLoss(r.settlement));
}

/** Overall hit rate across all decided rows (0–100); null when no data. */
export function computeOverallAccuracy(rows: SettledRow[]): number | null {
  const decidedRows = decided(rows);
  if (decidedRows.length === 0) return null;
  const wins = decidedRows.filter((r) => isWin(r.settlement)).length;
  return Math.round((wins / decidedRows.length) * 1000) / 10;
}

/** Daily hit rates for the last `days` days (oldest first); null for days without decided rows. */
export function computeDailyHitRates(
  rows: SettledRow[],
  days = 14,
  now: number = Date.now(),
): Array<number | null> {
  const startOfDay = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const today = startOfDay(now);
  const buckets: SettledRow[][] = Array.from({ length: days }, () => []);
  for (const row of decided(rows)) {
    const t = Date.parse(row.commenceTime);
    if (!Number.isFinite(t)) continue;
    const index = Math.floor((today - startOfDay(t)) / DAY_MS);
    if (index >= 0 && index < days) buckets[days - 1 - index].push(row);
  }
  return buckets.map((bucket) => {
    if (bucket.length === 0) return null;
    const wins = bucket.filter((r) => isWin(r.settlement)).length;
    return (wins / bucket.length) * 100;
  });
}

/** Hit-rate difference: last 7 days minus the 7 days before (percentage points); null if either side empty. */
export function computeRollingDiff(rows: SettledRow[], now: number = Date.now()): number | null {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const end = today.getTime() + DAY_MS;
  const mid = end - 7 * DAY_MS;
  const start = mid - 7 * DAY_MS;
  const inRange = (row: SettledRow, from: number, to: number) => {
    const t = Date.parse(row.commenceTime);
    return Number.isFinite(t) && t >= from && t < to;
  };
  const recent = decided(rows.filter((r) => inRange(r, mid, end)));
  const previous = decided(rows.filter((r) => inRange(r, start, mid)));
  if (recent.length === 0 || previous.length === 0) return null;
  const rate = (rs: SettledRow[]) => rs.filter((r) => isWin(r.settlement)).length / rs.length;
  return Math.round((rate(recent) - rate(previous)) * 1000) / 10;
}

/** Build an SVG path for the sparkline; null days are skipped by bridging neighbours. */
export function sparklinePath(
  values: Array<number | null>,
  width = 200,
  height = 80,
): string {
  const points: Array<[number, number]> = [];
  const defined = values
    .map((v, i) => (v === null ? null : ([i, v] as [number, number])))
    .filter((p): p is [number, number] => p !== null);
  if (defined.length === 0) return "";
  const min = Math.min(...defined.map(([, v]) => v));
  const max = Math.max(...defined.map(([, v]) => v));
  const span = max - min || 1;
  const lastIndex = values.length - 1 || 1;
  for (const [i, v] of defined) {
    const x = (i / lastIndex) * width;
    const y = height - 8 - ((v - min) / span) * (height - 16);
    points.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  }
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
}
