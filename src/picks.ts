import type { AnalysisRow } from "./odds";

export function bestH2hPick(rows: AnalysisRow[], edgeThreshold: number) {
  const best = rows[0];
  if (!best || best.edge < edgeThreshold) {
    return { label: "唔買", chance: best?.fairProbability ?? 0, odds: best?.odds };
  }
  return { label: `買 ${best.outcomeLabel}`, chance: best.fairProbability, odds: best.odds };
}
