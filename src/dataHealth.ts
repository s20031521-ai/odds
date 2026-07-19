export type DataHealth = {
  ok: boolean;
  dataFresh: boolean;
  staleSources: string[];
};

export type DataLoadState = {
  hkjc: boolean | null;
  hdc: boolean | null;
};

export function dataLoadStateAfter(
  state: DataLoadState,
  source: keyof DataLoadState,
  succeeded: boolean,
): DataLoadState {
  return { ...state, [source]: succeeded };
}

export function dataLoadsReady(state: DataLoadState): boolean {
  return state.hkjc === true && state.hdc === true;
}

export function dataLoadWarning(state: DataLoadState): string | null {
  const failed = (["hkjc", "hdc"] as const)
    .filter((source) => state[source] === false)
    .map((source) => source.toUpperCase());
  return failed.length
    ? `${failed.join("／")} 資料載入失敗，已暫停顯示值得買機會。`
    : null;
}

export function dataFreshFromHealth(health: unknown): boolean {
  return typeof health === "object"
    && health !== null
    && (health as { dataFresh?: unknown }).dataFresh === true
    && Array.isArray((health as { staleSources?: unknown }).staleSources);
}

const sourceLabels: Record<string, string> = {
  collector: "後台收集器",
  hkjc: "HKJC",
};

export function dataHealthWarning(health: DataHealth): string | null {
  if (health.dataFresh || health.staleSources.length === 0) return null;
  const sources = health.staleSources.map((source) => sourceLabels[source] ?? source).join("、");
  return `資料已過期：${sources}。畫面可能唔係最新，請先恢復資料收集。`;
}
