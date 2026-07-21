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

export function excludeLegacyRows<T extends { modelVersion?: string }>(rows: T[]): T[] {
  return rows.filter((row) => row.modelVersion !== "legacy-v0");
}

function cardRank(card: GroupableMarketCard): number {
  if (card.pickLabel.startsWith("買")) return 2;
  if (card.pickLabel === "資料不足，唔買") return 0;
  return 1;
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
