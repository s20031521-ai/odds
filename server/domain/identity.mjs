export function snapshotIdentity(snapshot) {
  return `${snapshot.matchId}|${snapshot.market}|${Number.isFinite(snapshot.line) ? snapshot.line : ""}|${snapshot.modelVersion ?? "legacy-v0"}`;
}

export function opportunityIdentity(opportunity) {
  return [
    opportunity.fixtureId,
    opportunity.market,
    opportunity.selection,
    Number.isFinite(opportunity.line) ? opportunity.line : "",
    opportunity.modelVersion,
    opportunity.strategyVersion ?? "legacy-v0",
  ].join("|");
}

export function resultIdentity(result) {
  const market = result.fixtureId ? canonicalResultMarket(result.market) : result.market;
  return `${result.fixtureId ?? result.matchId}|${market}`;
}

function canonicalResultMarket(value) {
  if (value === "主客和" || value === "h2h" || value === "moneyline") return "h2h";
  if (value === "亞洲讓球" || value === "handicap" || value === "spreads") return "handicap";
  if (value === "大細波" || value === "totals") return "totals";
  if (value === "角球" || value === "corners" || value === "alternate_totals_corners") return "corners";
  return value;
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
