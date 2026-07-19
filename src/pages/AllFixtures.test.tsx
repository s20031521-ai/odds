import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AllFixtures } from "./AllFixtures";

describe("AllFixtures", () => {
  it("provides the all-fixtures heading and semantic wrapper around passed existing content", () => {
    const markup = renderToStaticMarkup(
      <AllFixtures
        marketNavigation={<nav aria-label="市場選擇">原有市場 tabs</nav>}
        content={<section data-existing-content>完整市場內容</section>}
      />,
    );

    expect(markup).toMatch(/^<section/);
    expect(markup).toContain("全部賽事");
    expect(markup).toContain("查看所有即將開賽賽事及市場分析。");
    expect(markup).toContain("原有市場 tabs");
    expect(markup).toContain("完整市場內容");
  });
});
