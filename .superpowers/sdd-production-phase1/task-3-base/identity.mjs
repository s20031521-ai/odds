export function snapshotIdentity(snapshot) {
  return `${snapshot.matchId}|${snapshot.market}|${Number.isFinite(snapshot.line) ? snapshot.line : ""}|${snapshot.modelVersion ?? "legacy-v0"}`;
}

export function resultIdentity(result) {
  return `${result.matchId}|${result.market}`;
}

export function liveOddsIdentity(entry) {
  return entry.id ?? `${entry.matchId}-${entry.market}`;
}
