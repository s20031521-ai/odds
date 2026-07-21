// @ts-expect-error Vitest runs this file in Node; the app intentionally has no Node type dependency.
import { existsSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AppShell } from "./AppShell";

const navigationItems = [
  ["#/today", "今日"],
  ["#/fixtures", "賽程"],
  ["#/analysis", "分析"],
  ["#/history", "紀錄"],
] as const;

function renderShell(
  route: "today" | "fixtures" | "history" | "analysis" = "today",
  dataWarning?: string,
) {
  return renderToStaticMarkup(
    <AppShell route={route} dataWarning={dataWarning}>
      <span>內容測試</span>
    </AppShell>,
  );
}

function anchorTagsFor(markup: string, href: string): string[] {
  return (markup.match(/<a\b[^>]*>/g) ?? []).filter((tag) => tag.includes(`href="${href}"`));
}

describe("AppShell contract", () => {
  test("exports the required AppShell component", () => {
    const componentUrl = new URL("./AppShell.tsx", import.meta.url);

    expect(existsSync(componentUrl)).toBe(true);

    const source = readFileSync(componentUrl, "utf8");

    expect(source).toContain("export function AppShell");
  });

  test("renders every exact route and label in both labelled navigations", () => {
    const markup = renderShell();

    expect(markup.match(/<nav\b[^>]*aria-label="[^"]+"/g) ?? []).toHaveLength(2);
    for (const [href, label] of navigationItems) {
      expect(anchorTagsFor(markup, href)).toHaveLength(2);
      expect(markup.split(`>${label}</a>`)).toHaveLength(3);
    }
  });

  test("marks only the active route current in both navigations", () => {
    const markup = renderShell("fixtures");

    for (const [href] of navigationItems) {
      const anchors = anchorTagsFor(markup, href);
      expect(anchors).toHaveLength(2);
      for (const anchor of anchors) {
        if (href === "#/fixtures") {
          expect(anchor).toContain('aria-current="page"');
        } else {
          expect(anchor).not.toContain("aria-current");
        }
      }
    }
  });

  test("provides a skip link and focusable main-content target", () => {
    const markup = renderShell();

    expect(markup).toContain('href="#main-content"');
    expect(markup).toMatch(/<main\b[^>]*id="main-content"[^>]*tabindex="-1"/);
  });

  test("renders exactly one alert for a non-empty data warning", () => {
    const markup = renderShell("today", "資料暫時過期");

    expect(markup.match(/role="alert"/g) ?? []).toHaveLength(1);
    expect(markup).toContain("資料暫時過期");
  });

  test("does not render an alert for blank or missing warnings", () => {
    for (const warning of [undefined, "", "   "]) {
      expect(renderShell("today", warning)).not.toContain('role="alert"');
    }
  });

  test("renders children inside the main content region", () => {
    const markup = renderShell();
    const mainContent = markup.match(/<main\b[^>]*id="main-content"[^>]*>([\s\S]*?)<\/main>/)?.[1];

    expect(mainContent).toBeDefined();
    expect(mainContent).toContain("<span>內容測試</span>");
  });

  test("includes concise iPhone and iPad Add to Home Screen guidance", () => {
    const markup = renderShell();
    const layout = readFileSync(new URL("../styles/layout.css", import.meta.url), "utf8");

    expect(markup).toContain('aria-label="安裝提示"');
    expect(markup).toContain("iPhone / iPad：Safari 分享 → 加入主畫面");
    expect(layout).toContain(".pwa-install-hint");
  });
});

describe("soft-night CSS contract", () => {
  test("uses accessible colors for the active navigation item", () => {
    const layoutUrl = new URL("../styles/layout.css", import.meta.url);
    const layout = readFileSync(layoutUrl, "utf8");
    const activeRule = layout.match(/\.app-navigation a\[aria-current="page"\]\s*\{([^}]*)\}/)?.[1];

    expect(activeRule).toBeDefined();
    expect(activeRule).toContain("background: var(--color-accent-pink);");
    expect(activeRule).toContain("color: var(--color-text);");
  });

  test("defines the exact design tokens", () => {
    const tokensUrl = new URL("../styles/tokens.css", import.meta.url);
    expect(existsSync(tokensUrl)).toBe(true);
    const tokens = readFileSync(tokensUrl, "utf8");
    const expectedTokens = [
      ["--color-bg", "#FFF8F0"],
      ["--color-surface", "#FFFEFC"],
      ["--color-primary", "#5E9FD4"],
      ["--color-primary-text", "#2E6DA4"],
      ["--color-positive", "#7FCFA9"],
      ["--color-negative", "#F2A0A0"],
      ["--color-warning", "#E8B45A"],
      ["--color-text", "#4A3F3F"],
      ["--color-muted", "#A89B91"],
      ["--radius-card", "24px"],
      ["--touch-target", "44px"],
      ["--color-positive-surface", "#DFF5EA"],
      ["--color-on-primary", "#FFFFFF"],
      ["--color-primary-hover", "#4A8BC0"],
    ] as const;

    for (const [name, value] of expectedTokens) {
      expect(tokens).toContain(`${name}: ${value};`);
    }
  });

  test("uses the 720px phone breakpoint, safe area, and touch target", () => {
    const layoutUrl = new URL("../styles/layout.css", import.meta.url);
    expect(existsSync(layoutUrl)).toBe(true);
    const layout = readFileSync(layoutUrl, "utf8");

    expect(layout).toContain("@media (max-width: 720px)");
    expect(layout).toContain("env(safe-area-inset-bottom)");
    expect(layout).toContain("min-height: var(--touch-target)");
  });
});
