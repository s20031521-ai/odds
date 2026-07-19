export function cornerPickLabel(pickLabel: string, bookmakerCount: number): string {
  if (bookmakerCount < 2) return "資料不足，唔買";
  if (pickLabel === "買大") return "買大角";
  if (pickLabel === "買細") return "買細角";
  return pickLabel;
}

type GroupableMarketCard = {
  id: string;
  matchId: string;
  commenceTime: string;
  line: number;
  pickLabel: string;
  bestEdge: number;
};

export function groupMarketCards<T extends GroupableMarketCard>(cards: T[]): Array<{ matchId: string; primary: T; lines: T[] }> {
  const grouped = new Map<string, T[]>();
  for (const card of cards) grouped.set(card.matchId, [...(grouped.get(card.matchId) ?? []), card]);
  return [...grouped.entries()].map(([matchId, lines]) => {
    const ranked = [...lines].sort((left, right) => cardRank(right) - cardRank(left) || right.bestEdge - left.bestEdge || left.line - right.line);
    return { matchId, primary: ranked[0], lines: [...lines].sort((left, right) => left.line - right.line) };
  }).sort((left, right) => Date.parse(left.primary.commenceTime) - Date.parse(right.primary.commenceTime));
}

export function hasPredictionSnapshot(row: { prediction: string; modelVersion?: string }): boolean {
  return Boolean(row.modelVersion) && row.prediction !== "未有賽前快照";
}

export function filterHistoryRows<T extends { market: string }>(rows: T[], market: string): T[] {
  return rows.filter((row) => row.market === market);
}

export function summarizeHistoryRows(rows: Array<{ hit: boolean | null; settlement?: string | null; prediction: string; modelVersion?: string }>) {
  const comparable = rows.filter(hasPredictionSnapshot);
  const win = comparable.filter((row) => row.settlement === "win" || row.settlement === "half-win").length;
  const loss = comparable.filter((row) => row.settlement === "loss" || row.settlement === "half-loss").length;
  const push = comparable.filter((row) => row.settlement === "push").length;
  const decided = win + loss;
  return {
    win,
    loss,
    push,
    winPercent: decided ? Math.round(win / decided * 1000) / 10 : 0,
    lossPercent: decided ? Math.round(loss / decided * 1000) / 10 : 0,
  };
}

export type PerformanceRow = {
  matchId?: string;
  prediction: string;
  settlement?: string | null;
  odds?: number;
  chance?: number;
  modelVersion?: string;
  market?: string;
};

export type PerformanceSummary = {
  key: string;
  matches: number;
  finished: number;
  win: number;
  loss: number;
  push: number;
  hitRate: number | null;
  priced: number;
  profit: number;
  roi: number | null;
};

export function summarizePerformanceRows<T extends PerformanceRow>(rows: T[], keyOf: (row: T) => string): PerformanceSummary[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.settlement) continue;
    const key = keyOf(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([key, items]) => {
    const win = items.filter((row) => row.settlement === "win" || row.settlement === "half-win").length;
    const loss = items.filter((row) => row.settlement === "loss" || row.settlement === "half-loss").length;
    const push = items.filter((row) => row.settlement === "push").length;
    const priced = items.filter((row) => Number.isFinite(row.odds) && Number(row.odds) > 1);
    const profit = priced.reduce((sum, row) => sum + settlementProfit(row.settlement, Number(row.odds)), 0);
    const matches = new Set(items.map((row, index) => row.matchId ?? `unknown-${index}`)).size;
    return { key, matches, finished: items.length, win, loss, push, hitRate: win + loss ? win / (win + loss) : null, priced: priced.length, profit, roi: priced.length ? profit / priced.length : null };
  });
}

export function excludeLegacyRows<T extends { modelVersion?: string }>(rows: T[]): T[] {
  return rows.filter((row) => row.modelVersion !== "legacy-v0");
}

export function currentModelRows<T extends { modelVersion?: string }>(rows: T[]): T[] {
  return rows.filter((row) => Boolean(row.modelVersion) && row.modelVersion !== "legacy-v0");
}

export function predictionDistribution(rows: PerformanceRow[]) {
  const settled = rows.filter((row) => row.settlement && row.prediction !== "未有賽前快照");
  const counts = new Map<string, number>();
  for (const row of settled) counts.set(row.prediction, (counts.get(row.prediction) ?? 0) + 1);
  return [...counts.entries()].map(([key, count]) => ({ key, count, percent: count / settled.length }));
}

export function calibrationBuckets(rows: PerformanceRow[]) {
  const valid = rows.filter((row) => row.settlement && Number.isFinite(row.chance) && Number(row.chance) >= 0 && Number(row.chance) <= 1);
  return summarizePerformanceRows(valid, (row) => String(Math.min(9, Math.floor(Number(row.chance) * 10))))
    .sort((left, right) => Number(left.key) - Number(right.key))
    .map((summary) => ({ key: `${summary.key}0–${summary.key}9%`, finished: summary.finished, hitRate: summary.hitRate ?? 0 }));
}

function settlementProfit(settlement: string | null | undefined, odds: number): number {
  if (settlement === "win") return odds - 1;
  if (settlement === "half-win") return (odds - 1) / 2;
  if (settlement === "half-loss") return -0.5;
  if (settlement === "loss") return -1;
  return 0;
}

function cardRank(card: GroupableMarketCard): number {
  if (card.pickLabel.startsWith("買")) return 2;
  if (card.pickLabel === "資料不足，唔買") return 0;
  return 1;
}