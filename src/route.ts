export type Page = "today" | "fixtures" | "bets" | "performance";

export function pageFromHash(hash: string): Page {
  const value = hash.replace(/^#\/?/, "");
  if (value.startsWith("bets")) return "bets";
  if (value.startsWith("performance")) return "performance";
  if (value.startsWith("fixtures")) return "fixtures";
  return "today";
}
