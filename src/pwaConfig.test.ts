// @ts-expect-error Vitest runs this file in Node; the app intentionally has no Node type dependency.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rootUrl = new URL("../", import.meta.url);

function projectFile(path: string): string {
  return readFileSync(new URL(path, rootUrl), "utf8");
}

function pngDimensions(path: string): { width: number; height: number } {
  const bytes = readFileSync(new URL(path, rootUrl));
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("PWA build contract", () => {
  it("uses vite-plugin-pwa with auto-updating registration", () => {
    const packageJson = JSON.parse(projectFile("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const config = projectFile("vite.config.ts");

    expect(packageJson.dependencies?.["vite-plugin-pwa"] ?? packageJson.devDependencies?.["vite-plugin-pwa"]).toBeTruthy();
    expect(config).toContain('import { VitePWA } from "vite-plugin-pwa"');
    expect(config).toContain("VitePWA(");
    expect(config).toContain('registerType: "autoUpdate"');
  });

  it("defines the exact standalone manifest and required PNG icon purposes", () => {
    const config = projectFile("vite.config.ts");

    for (const expected of [
      'name: "Odds Value Dashboard"',
      'short_name: "Odds Dashboard"',
      'start_url: "/#/dashboard"',
      'scope: "/"',
      'display: "standalone"',
      'theme_color: "#11182B"',
      'background_color: "#11182B"',
      'src: "/icons/icon-192.png"',
      'sizes: "192x192"',
      'src: "/icons/icon-512.png"',
      'sizes: "512x512"',
      'src: "/icons/icon-maskable-512.png"',
      'purpose: "maskable"',
    ]) expect(config).toContain(expected);
  });

  it("limits precaching to static shell assets and denies API navigation without runtime caches", () => {
    const config = projectFile("vite.config.ts");

    expect(config).not.toContain("includeAssets:");
    expect(config).toContain("globPatterns:");
    expect(config).toContain("html,js,css,woff,woff2,png,svg,ico,webmanifest");
    expect(config).toContain("globIgnores:");
    expect(config).toContain("**/*.json");
    expect(config).toContain("**/hkjc-odds.json");
    expect(config).toContain("**/manifest.webmanifest");
    expect(config).toContain("**/icons/icon-192.png");
    expect(config).toContain("**/icons/icon-512.png");
    expect(config).toContain("**/icons/icon-maskable-512.png");
    expect(config).toContain("navigateFallbackDenylist: [/^\\/api\\//]");
    expect(config).toContain("runtimeCaching: []");
    expect(config).not.toMatch(/urlPattern\s*:\s*[^\n]*(?:api|health|fixture|result|odds)/i);
  });

  it("includes matching viewport, theme and Apple touch metadata", () => {
    const html = projectFile("index.html");

    expect(html).toContain('name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"');
    expect(html).toContain('name="theme-color" content="#11182B"');
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="apple-mobile-web-app-status-bar-style" content="black-translucent"');
    expect(html).toContain('rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png"');
  });

  it("ships valid PNG assets at every required size", () => {
    const icons = [
      ["public/icons/icon-192.png", 192],
      ["public/icons/icon-512.png", 512],
      ["public/icons/icon-maskable-512.png", 512],
      ["public/icons/apple-touch-icon.png", 180],
    ] as const;

    for (const [path, size] of icons) {
      expect(existsSync(new URL(path, rootUrl))).toBe(true);
      expect(pngDimensions(path)).toEqual({ width: size, height: size });
    }
  });
});
