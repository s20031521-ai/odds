export type DashboardMode = "simple" | "pro";

export const DASHBOARD_MODE_STORAGE_KEY = "dashboard-mode";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function readDashboardMode(storage: StorageLike | undefined = defaultStorage()): DashboardMode {
  try {
    return storage?.getItem(DASHBOARD_MODE_STORAGE_KEY) === "pro" ? "pro" : "simple";
  } catch {
    return "simple";
  }
}

export function writeDashboardMode(mode: DashboardMode, storage: StorageLike | undefined = defaultStorage()): void {
  try {
    storage?.setItem(DASHBOARD_MODE_STORAGE_KEY, mode);
  } catch {
    // 私隱模式等寫入失敗:忽略,mode 只維持喺記憶體。
  }
}
