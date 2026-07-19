import { defineConfig } from "@playwright/test";

const previewPort = 4179;

export default defineConfig({
  testDir: "./tests/ui",
  outputDir: ".superpowers/sdd-responsive-pwa/playwright-output",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: `http://127.0.0.1:${previewPort}`,
    browserName: "chromium",
    channel: "chrome",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { viewport: { width: 820, height: 1180 } } },
    { name: "tablet-landscape", use: { viewport: { width: 1180, height: 820 } } },
    { name: "phone", use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: `npm.cmd run preview -- --port ${previewPort} --strictPort`,
    url: `http://127.0.0.1:${previewPort}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
