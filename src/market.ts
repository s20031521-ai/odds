export type MarketKey = "totals" | "corners" | "handicap" | "h2h";

export const ALL_MARKETS: MarketKey[] = ["totals", "corners", "handicap", "h2h"];

export const MARKET_LABELS: Record<MarketKey, string> = {
  totals: "大細波",
  corners: "角球",
  handicap: "讓球",
  h2h: "主客和",
};

export function canonicalMarket(value: string): MarketKey | null {
  switch (value) {
    case "totals":
    case "大細波":
      return "totals";
    case "corners":
    case "角球":
    case "alternate_totals_corners":
      return "corners";
    case "handicap":
    case "亞洲讓球":
    case "spreads":
      return "handicap";
    case "h2h":
    case "主客和":
    case "moneyline":
      return "h2h";
    default:
      return null;
  }
}
