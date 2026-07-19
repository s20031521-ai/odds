export type SnapshotStatus = "valid-current" | "legacy" | "invalid";

export type SnapshotClassification = {
  status: SnapshotStatus;
  reason: string | null;
};

export type SnapshotQuality = {
  raw: number;
  validCurrent: number;
  legacy: number;
  invalid: number;
  invalidReasons: Record<string, number>;
};

export function classifySnapshot(value: unknown): SnapshotClassification;
export function summarizeSnapshotQuality(values: readonly unknown[]): SnapshotQuality;
