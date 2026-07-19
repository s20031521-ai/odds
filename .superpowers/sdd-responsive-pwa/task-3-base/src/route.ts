export type Page = "dashboard" | "fixtures" | "analysis" | "history";

export function pageFromHash(hash: string): Page {
  const value = cleanHash(hash);
  if (value === "fixtures") return "fixtures";
  if (value.startsWith("analysis")) return "analysis";
  if (value.startsWith("history")) return "history";
  return "dashboard";
}

export function fixtureIdFromHash(hash: string): string | null {
  const [, id] = cleanHash(hash).match(/^dashboard\/(.+)$/) ?? [];
  return id ? decodeURIComponent(id) : null;
}

function cleanHash(hash: string): string {
  return hash.replace(/^#\/?/, "");
}
