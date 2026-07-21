export type Page = "today" | "fixtures" | "analysis" | "history";
export type FixtureAnalysisTab = "h2h" | "totals" | "corners" | "handicap";

export function pageFromHash(hash: string): Page {
  const value = cleanHash(hash);
  if (value === "fixtures" || value.startsWith("fixtures/") || value.startsWith("dashboard/")) return "fixtures";
  if (value.startsWith("analysis")) return "analysis";
  if (value.startsWith("history")) return "history";
  return "today";
}

export function fixtureIdFromHash(hash: string): string | null {
  const [, id] = cleanHash(hash).match(/^(?:fixtures|dashboard)\/(.+)$/) ?? [];
  return id ? decodeURIComponent(id) : null;
}

export function analysisMatchIdFromHash(hash: string): string | null {
  const value = cleanHash(hash);
  const questionIndex = value.indexOf("?");
  if (questionIndex < 0 || value.slice(0, questionIndex) !== "analysis") return null;
  const match = new URLSearchParams(value.slice(questionIndex + 1)).get("match");
  return match ? match : null;
}

export function tabForRouteTransition(current: FixtureAnalysisTab, hash: string): FixtureAnalysisTab {
  return fixtureIdFromHash(hash) ? "h2h" : current;
}

function cleanHash(hash: string): string {
  return hash.replace(/^#\/?/, "");
}
