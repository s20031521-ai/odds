import { settleAsianTotal } from "./asianTotals";
import { settleAsianHandicap } from "./handicap";
import { classifySnapshot } from "../shared/snapshot-policy.mjs";

export type PredictionSnapshot = {
  matchId: string;
  market: string;
  prediction: string;
  side?: "主" | "客";
  savedAt: string;
  commenceTime: string;
  chance?: number;
  edge?: number;
  odds?: number;
  line?: number;
  modelVersion?: string;
  source?: string;
  bookmaker?: string;
};

export type PredictionResultRow = {
  matchId: string;
  market: string;
  actual: string;
  prediction: string;
  hit: boolean | null;
  line?: number;
};

const STORAGE_KEY = "odds-tool:prediction-snapshots";
type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function snapshotKey(snapshot: Pick<PredictionSnapshot, "matchId" | "market" | "line" | "modelVersion">): string {
  return `${snapshot.matchId}|${snapshot.market}|${Number.isFinite(snapshot.line) ? snapshot.line : ""}|${snapshot.modelVersion ?? "legacy-v0"}`;
}

export function savePredictionSnapshots(snapshots: PredictionSnapshot[], storage: StorageLike = localStorage): void {
  const current = readSnapshotMap(storage);
  for (const snapshot of snapshots) {
    if (classifySnapshot(snapshot).status !== "valid-current") continue;
    const key = snapshotKey(snapshot);
    if (!current[key]) current[key] = snapshot;
  }
  storage.setItem(STORAGE_KEY, JSON.stringify(current));
}

export function isPreKickSnapshot(snapshot: Pick<PredictionSnapshot, "savedAt" | "commenceTime">): boolean {
  const savedAt = Date.parse(snapshot.savedAt);
  const commenceTime = Date.parse(snapshot.commenceTime);
  return Number.isFinite(savedAt) && Number.isFinite(commenceTime) && savedAt < commenceTime;
}

export async function postPredictionSnapshots(snapshots: PredictionSnapshot[], csrfToken = ""): Promise<void> {
  if (snapshots.length === 0) return;
  await fetch("/api/v1/predictions", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(csrfToken ? { "x-csrf-token": csrfToken } : {}) },
    body: JSON.stringify(snapshots),
  });
}

export function applyPredictionSnapshots<T extends PredictionResultRow>(rows: T[], storage: StorageLike = localStorage): T[] {
  const snapshots = Object.values(readSnapshotMap(storage));
  return rows.map((row) => {
    if (row.hit !== null) return row;
    const snapshot = snapshots.find((item) => item.matchId === row.matchId && item.market === row.market && (row.line === undefined || item.line === row.line));
    if (!snapshot) return row;
    const hit = comparePrediction(snapshot, row.actual);
    return { ...row, prediction: snapshot.prediction, line: snapshot.line ?? row.line, hit };
  });
}

function readSnapshotMap(storage: StorageLike): Record<string, PredictionSnapshot> {
  try {
    return JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}") as Record<string, PredictionSnapshot>;
  } catch {
    return {};
  }
}

function comparePrediction(snapshot: PredictionSnapshot, actual: string): boolean | null {
  if (snapshot.market === "主客和") return normalizeOutcome(snapshot.prediction) === normalizeOutcome(actual);
  if (snapshot.market === "亞洲讓球") {
    const score = actual.match(/(\d+)\s*-\s*(\d+)/);
    if (!score || typeof snapshot.line !== "number" || (snapshot.prediction !== "主" && snapshot.prediction !== "客")) return null;
    const settlement = settleAsianHandicap(snapshot.prediction, snapshot.line, Number(score[1]), Number(score[2]));
    return settlement === "win" || settlement === "half-win" ? true : settlement === "loss" || settlement === "half-loss" ? false : null;
  }
  const settlement = settleHighLow(normalizeHighLow(snapshot.prediction), snapshot.line, parseFloat(actual));
  return settlement === "win" || settlement === "half-win" ? true : settlement === "loss" || settlement === "half-loss" ? false : null;
}

export function normalizeOutcome(value: string): string {
  return value === "和" ? "和局" : value;
}

export function settleHighLow(side: string, line: number | undefined, total: number): "win" | "half-win" | "push" | "half-loss" | "loss" | null {
  if ((side !== "大" && side !== "細") || typeof line !== "number" || !Number.isFinite(line) || !Number.isFinite(total)) return null;
  return settleAsianTotal(side, line, total);
}

function normalizeHighLow(value: string): "大" | "細" | string {
  if (value.includes("大")) return "大";
  if (value.includes("細")) return "細";
  return value;
}
