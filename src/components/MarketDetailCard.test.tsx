import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarketDetailCard } from "./MarketDetailCard";

describe("MarketDetailCard", () => {
  it("shows model vs bookie probabilities, edge, stake and odds", () => {
    const markup = renderToStaticMarkup(
      <MarketDetailCard market="主客和" detail={{
        kind: "ok", selection: "主勝", odds: 2.0,
        chance: 0.58, implied: 0.5, edge: 0.16, stake: 20, bookmaker: "Book A",
      }} />,
    );
    expect(markup).toContain("主客和");
    expect(markup).toContain("買：主勝");
    expect(markup).toContain("模型估 58.0%，莊家開 50.0%");
    expect(markup).toContain("Edge +16.0%");
    expect(markup).toContain("建議注碼 $20");
    expect(markup).toContain("2.00");
    expect(markup).toContain("Book A");
  });

  it("shows negative edge without double sign", () => {
    const markup = renderToStaticMarkup(
      <MarketDetailCard market="大細波" detail={{
        kind: "ok", selection: "大 2.5", odds: 1.9,
        chance: 0.5, implied: 1 / 1.9, edge: -0.05, stake: 0, bookmaker: "Book B",
      }} />,
    );
    expect(markup).toContain("Edge -5.0%");
  });

  it("shows empty state when the market has no data", () => {
    const markup = renderToStaticMarkup(<MarketDetailCard market="角球" detail={{ kind: "empty" }} />);
    expect(markup).toContain("角球");
    expect(markup).toContain("呢個市場冇盤");
  });

  it("shows the insufficient note for single-bookmaker markets", () => {
    const markup = renderToStaticMarkup(
      <MarketDetailCard market="亞洲讓球" detail={{ kind: "insufficient", note: "資料不足，唔買" }} />,
    );
    expect(markup).toContain("資料不足，唔買");
  });
});
