export function snapshotIdentity(snapshot) {
  return `${snapshot.matchId}|${snapshot.market}|${Number.isFinite(snapshot.line) ? snapshot.line : ""}|${snapshot.modelVersion ?? "legacy-v0"}`;
}

export function resultIdentity(result) {
  return `${result.matchId}|${result.market}`;
}

export function providerResultIdentity(entry) {
  return entry.id ?? `${entry.matchId}-${entry.market}`;
}

export function liveOddsIdentity(entry) {
  const base = `${entry.provider}|${entry.matchId}|${entry.market}|${entry.selection}|${Number.isFinite(entry.line) ? entry.line : ""}`;
  // The Odds API returns one entry per bookmaker; without the bookmaker the
  // identity collides inside a single provider snapshot (Phase 2 production
  // incident 2026-07-19). Blank/absent bookmaker keeps the legacy 5-part form.
  const bookmaker = typeof entry.bookmaker === "string" ? entry.bookmaker.trim() : "";
  return bookmaker ? `${base}|${bookmaker}` : base;
}
