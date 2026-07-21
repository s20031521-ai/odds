import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FreshnessBar } from "./FreshnessBar";

const NOW = Date.parse("2026-07-21T12:00:00Z");

describe("FreshnessBar", () => {
  it("shows a stale warning when data is not fresh", () => {
    const markup = renderToStaticMarkup(
      <FreshnessBar generatedAt="2026-07-21T10:00:00Z" dataFresh={false} now={NOW} />,
    );
    expect(markup).toContain("freshness-bar--stale");
    expect(markup).toContain("數據好耐冇更新，小心舊盤");
    expect(markup).toContain('role="status"');
  });

  it("shows minutes since sync when fresh", () => {
    const markup = renderToStaticMarkup(
      <FreshnessBar generatedAt="2026-07-21T11:45:00Z" dataFresh now={NOW} />,
    );
    expect(markup).toContain("賠率更新於 15 分鐘前");
    expect(markup).not.toContain("freshness-bar--stale");
  });

  it("shows 啱啱更新 for sub-minute freshness", () => {
    const markup = renderToStaticMarkup(
      <FreshnessBar generatedAt="2026-07-21T11:59:40Z" dataFresh now={NOW} />,
    );
    expect(markup).toContain("賠率啱啱更新");
  });

  it("never shows negative minutes when clock skews", () => {
    const markup = renderToStaticMarkup(
      <FreshnessBar generatedAt="2026-07-21T12:05:00Z" dataFresh now={NOW} />,
    );
    expect(markup).toContain("賠率啱啱更新");
  });

  it("shows 未有成功同步 when generatedAt is null or unparseable", () => {
    for (const generatedAt of [null, "not-a-date"]) {
      const markup = renderToStaticMarkup(
        <FreshnessBar generatedAt={generatedAt} dataFresh now={NOW} />,
      );
      expect(markup).toContain("未有成功同步");
    }
  });
});
