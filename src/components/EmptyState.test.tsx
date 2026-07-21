import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("stale: momonga-alert + 更新緊 message", () => {
    const markup = renderToStaticMarkup(<EmptyState reason="stale" />);
    expect(markup).toContain("mascot--alert");
    expect(markup).toContain("數據舊咗，唔好住落注 — 更新緊");
    expect(markup).toContain('role="status"');
  });

  it("no-fixtures: chiikawa-empty + 冇波睇 message", () => {
    const markup = renderToStaticMarkup(<EmptyState reason="no-fixtures" />);
    expect(markup).toContain("mascot--empty");
    expect(markup).toContain("今日冇波睇，聽日先嚟過");
  });

  it("no-value: chiikawa-empty + fixture count message", () => {
    const markup = renderToStaticMarkup(<EmptyState reason="no-value" fixtureCount={7} />);
    expect(markup).toContain("mascot--empty");
    expect(markup).toContain("今日 7 場波，但冇盤值博 — 慳返啖");
  });

  it("no-value defaults fixture count to 0", () => {
    const markup = renderToStaticMarkup(<EmptyState reason="no-value" />);
    expect(markup).toContain("今日 0 場波");
  });
});
