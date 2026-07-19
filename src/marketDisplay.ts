export type SnapshotQuality = {
  raw: number;
  validCurrent: number;
  legacy: number;
  invalid: number;
  invalidReasons: Record<string, number>;
};

export type BacktestResponseState<ResultEntry, ModelReadiness> = {
  resultEntries: ResultEntry[];
  readiness: ModelReadiness[];
  snapshotQuality: SnapshotQuality | null;
};

export function clearBacktestResponseState<ResultEntry, ModelReadiness>(
  _state: BacktestResponseState<ResultEntry, ModelReadiness>,
): BacktestResponseState<ResultEntry, ModelReadiness> {
  return { resultEntries: [], readiness: [], snapshotQuality: null };
}

export function isSnapshotQuality(value: unknown): value is SnapshotQuality {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const quality = value as Record<string, unknown>;
  if (!["raw", "validCurrent", "legacy", "invalid"].every((key) => isNonnegativeInteger(quality[key]))) return false;
  const reasons = quality.invalidReasons;
  if (!reasons || typeof reasons !== "object" || Array.isArray(reasons)) return false;
  return Object.values(reasons).every(isNonnegativeInteger);
}

export function cornerPickLabel(pickLabel: string, bookmakerCount: number): string {
  if (bookmakerCount < 2) return "資料不足，唔買";
  if (pickLabel === "買大") return "買大角";
  if (pickLabel === "買細") return "買細角";
  return pickLabel;
}

export function snapshotQualityMessage(quality: { raw: number; validCurrent: number; legacy: number; invalid: number; invalidReasons: Record<string, number> }): string | null {
  if (quality.legacy === 0 && quality.invalid === 0) return null;
  return `已隔離 ${quality.legacy} 個 legacy 同 ${quality.invalid} 個無效 snapshots；current 統計只使用 ${quality.validCurrent} 個有效 snapshots。`;
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

export function hasPredictionSnapshot(row: { prediction: string; modelVersion?: string; snapshotStatus?: string }): boolean {
  return Boolean(row.modelVersion)
    && row.prediction !== "未有賽前快照"
    && (!("snapshotStatus" in row) || row.snapshotStatus === "valid-current");
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
  edge?: number;
  savedAt?: string;
  line?: number;
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

export function selectDistinctPerformanceRows<T extends PerformanceRow>(rows: T[]): T[] {
  const selected = new Map<string, { row: T; index: number }>();
  const ungrouped: Array<{ row: T; index: number }> = [];

  rows.forEach((row, index) => {
    if (!row.matchId?.trim()) {
      ungrouped.push({ row, index });
      return;
    }

    const key = `${row.market ?? ""}|${row.modelVersion ?? ""}|${row.matchId}`;
    const current = selected.get(key);
    if (!current || comparePerformanceRepresentatives(row, index, current.row, current.index) < 0) {
      selected.set(key, { row, index });
    }
  });

  return [...selected.values(), ...ungrouped]
    .sort((left, right) => left.index - right.index)
    .map(({ row }) => row);
}

export function summarizePerformanceRows<T extends PerformanceRow>(rows: T[], keyOf: (row: T) => string): PerformanceSummary[] {
  const groups = new Map<string, T[]>();
  for (const row of selectDistinctPerformanceRows(rows)) {
    if (!row.settlement) continue;
    const key = keyOf(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([key, items]) => {
    const win = items.filter((row) => row.settlement === "win" || row.settlement === "half-win").length;
    const loss = items.filter((row) => row.settlement === "loss" || row.settlement === "half-loss").length;
    const push = items.filter((row) => row.settlement === "push").length;
    const priced = items.filter((row) => Number.isFinite(row.odds) && Number(row.odds) > 1);
    const profit = normalizeDecimal(priced.reduce((sum, row) => sum + settlementProfit(row.settlement, Number(row.odds)), 0));
    const matches = new Set(items.map((row, index) => row.matchId ?? `unknown-${index}`)).size;
    return { key, matches, finished: items.length, win, loss, push, hitRate: win + loss ? win / (win + loss) : null, priced: priced.length, profit, roi: priced.length ? profit / priced.length : null };
  });
}

export function excludeLegacyRows<T extends { modelVersion?: string }>(rows: T[]): T[] {
  return rows.filter((row) => row.modelVersion !== "legacy-v0");
}

export function currentModelRows<T extends { modelVersion?: string; snapshotStatus?: string }>(rows: T[]): T[] {
  return rows.filter((row) => Boolean(row.modelVersion)
    && row.modelVersion !== "legacy-v0"
    && (!("snapshotStatus" in row) || row.snapshotStatus === "valid-current"));
}

export function predictionDistribution(rows: PerformanceRow[]) {
  rows = selectDistinctPerformanceRows(rows);
  const settled = rows.filter((row) => row.settlement && row.prediction !== "未有賽前快照");
  const counts = new Map<string, number>();
  for (const row of settled) counts.set(row.prediction, (counts.get(row.prediction) ?? 0) + 1);
  return [...counts.entries()].map(([key, count]) => ({ key, count, percent: count / settled.length }));
}

export function calibrationBuckets(rows: PerformanceRow[]) {
  rows = selectDistinctPerformanceRows(rows);
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

function normalizeDecimal(value: number): number {
  return Math.round(value * 1e12) / 1e12;
}

function comparePerformanceRepresentatives(left: PerformanceRow, leftIndex: number, right: PerformanceRow, rightIndex: number): number {
  const edgeOrder = compareFiniteNumbers(left.edge, right.edge, false);
  if (edgeOrder) return edgeOrder;

  const savedAtOrder = compareFiniteNumbers(Date.parse(left.savedAt ?? ""), Date.parse(right.savedAt ?? ""), true);
  if (savedAtOrder) return savedAtOrder;

  const lineOrder = compareFiniteNumbers(left.line, right.line, true);
  return lineOrder || leftIndex - rightIndex;
}

function compareFiniteNumbers(left: number | undefined, right: number | undefined, ascending: boolean): number {
  const leftValid = Number.isFinite(left);
  const rightValid = Number.isFinite(right);
  if (leftValid !== rightValid) return leftValid ? -1 : 1;
  if (!leftValid || left === right) return 0;
  return ascending ? Number(left) - Number(right) : Number(right) - Number(left);
}

function cardRank(card: GroupableMarketCard): number {
  if (card.pickLabel.startsWith("買")) return 2;
  if (card.pickLabel === "資料不足，唔買") return 0;
  return 1;
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
