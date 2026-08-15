import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockApi } from "./helpers";

test.beforeEach(async ({ page }) => {
  await mockApi(page, "authenticated");
});

test("dashboard shows only fresh pre-match picks from same-origin API", async ({ page }) => {
  await page.goto("/#/today");

  // server-recorded 盤喺今日頁 .landing-page__picks 嘅 PickCard。
  const cards = page.locator(".landing-page__picks .pick-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.filter({ hasText: "Value United" })).toHaveCount(1);
  await expect(cards.filter({ hasText: "Boundary FC" })).toHaveCount(1);
  await expect(page.locator(".landing-page__picks")).not.toContainText("Below United");
  await expect(page.locator(".landing-page__picks")).not.toContainText("Past High Edge");
  await expectNoDocumentOverflow(page);
});

test("renders dashboard when the API serves flat per-selection rows", async ({ page }) => {
  await mockApi(page, "flat-live");
  await page.goto("/#/today");

  await expect(page.locator(".application-shell")).toBeVisible();
  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page.locator("main")).toContainText("Value United");
});

test("responsive navigation, touch targets, fixtures, and performance pages work", async ({ page }, testInfo) => {
  await page.goto("/#/today");
  // Obsidian Neon 改版:≥900px 用左 sidebar,<900px 用頂部 mobile-nav。
  const touchLayout = testInfo.project.name === "phone" || testInfo.project.name === "tablet";
  const nav = page.locator(touchLayout ? ".mobile-nav" : ".sidebar__nav");
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link", { name: "今日概覽" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".landing-page__picks .pick-card")).toHaveCount(2);
  if (touchLayout) {
    await expectMinimumHeight(nav.locator("a"), 44);
  }

  await nav.getByRole("link", { name: "賽程列表" }).click();
  await expect(page).toHaveURL(/#\/fixtures$/);
  // 賽程頁預設「今日」tab;mock 賽事全部喺將來,要切「即將到來」先睇到。
  await page.getByRole("tab", { name: "即將到來" }).click();
  await expect(page.locator(".fixture-card")).toHaveCount(3);
  await expectNoDocumentOverflow(page);

  await nav.getByRole("link", { name: "表現分析" }).click();
  await expect(page).toHaveURL(/#\/performance$/);
  await expect(page.locator(".performance-card")).toHaveCount(4);
  if (touchLayout) await expectMinimumHeight(page.getByRole("button"), 44, true);

  await nav.getByRole("link", { name: "今日概覽" }).click();
  await expect(page).toHaveURL(/#\/today$/);
  await expect(page.locator(".landing-page")).toBeVisible();
});

test("current failures fail closed while a failed live audit feed keeps recorded recommendations", async ({ page }) => {
  const empty = await mockApi(page, "empty");
  await page.goto("/#/today");
  await expect(page.locator(".pick-card")).toHaveCount(0);
  await expect(page.locator(".landing-page__empty")).toBeVisible();
  expect(empty.requestedPaths).toContain("GET /api/v1/recommendations/current");

  const failedCurrent = await mockApi(page, "current-failed");
  await page.reload();
  await expect(page.locator(".pick-card")).toHaveCount(0);
  // recommendations feed 可信先至會出盤;feed 失敗 → fail closed 兼提示數據舊。
  await expect(page.locator(".today-empty")).toBeVisible();
  expect(failedCurrent.requestedPaths).toContain("GET /api/v1/recommendations/current");

  const failedLive = await mockApi(page, "live-failed");
  await page.reload();
  await expect(page.getByRole("alert")).toBeVisible();
  // live 審計 feed 失敗只係警告:server-recorded 盤仍然保留。
  await expect(page.locator(".landing-page__picks .pick-card")).toHaveCount(2);
  const first = page.locator(".landing-page__picks .pick-card").first();
  await first.locator(".pick-card__summary").click();
  await expect(first.locator(".buyable-odds-range__range")).toHaveText("2.30–2.40");
  expect(failedLive.requestedPaths).toContain("GET /api/v1/recommendations/current");
});

test("backtest failure on the performance page fails closed without exposing raw stack details", async ({ page }) => {
  // 舊版 #/history 會出 .empty-state[role=alert];改版後 backtest 失敗係靜默
  // fail closed:表現頁照常 render,樣本顯示「尚未有數據」,唔洩 stack。
  await mockApi(page, "backtest-failed");
  await page.goto("/#/performance");

  await expect(page.locator(".performance-page")).toBeVisible();
  await expect(page.locator(".performance-card")).toHaveCount(4);
  await expect(page.locator(".performance-page")).toContainText("尚未有數據");
  await expect(page.locator("body")).not.toContainText("Error:");
});

test("production PWA exposes its manifest and registers a service worker", async ({ page }) => {
  await page.goto("/#/today");
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifestHref).toBeTruthy();

  const manifest = await page.evaluate(async (href) => {
    const response = await fetch(href!);
    return { ok: response.ok, body: await response.json() };
  }, manifestHref);
  expect(manifest.ok).toBe(true);
  expect(manifest.body.display).toBe("standalone");

  await expect.poll(() => page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration()))).toBe(true);
});

test("fixtures page lists every upcoming fixture and excludes past kickoffs", async ({ page }) => {
  // Neon 改版:賽程卡係 .fixture-card,按 今日/明日/即將到來 分 tab;
  // mock 賽事全部喺將來,切「即將到來」tab 先會列出。
  await page.goto("/#/fixtures");

  await page.getByRole("tab", { name: "即將到來" }).click();
  await expect(page.locator(".fixture-card")).toHaveCount(3);
  await expect(page.locator(".fixtures-page")).toContainText("Value United");
  await expect(page.locator(".fixtures-page")).toContainText("Signal City");
  await expect(page.locator(".fixtures-page")).toContainText("Boundary FC");
  await expect(page.locator(".fixtures-page")).toContainText("Threshold Town");
  await expect(page.locator(".fixtures-page")).toContainText("Below United");
  await expect(page.locator(".fixtures-page")).toContainText("No Buy Rovers");
  await expect(page.locator(".fixtures-page")).not.toContainText("Past High Edge");
});

test("performance page shows model readiness from the backtest feed", async ({ page }) => {
  // 舊版 #/history 嘅 model-readiness + 等緊開賽/已完場分組;改版後 readiness
  // 搬咗去 #/performance 嘅逐模型卡,pending/settled 明細組無替代介面(已廢除)。
  await page.goto("/#/performance");

  await expect(page.locator(".performance-card")).toHaveCount(4);
  await expect(page.locator(".performance-card").filter({ hasText: "主客和" })).toContainText("12/30 場");
  await expect(page.locator(".performance-card").filter({ hasText: "大細波" })).toContainText("30/30 場");
  await expect(page.locator(".performance-card").filter({ hasText: "角球" })).toContainText("7/30 場");
  await expect(page.locator(".performance-card").filter({ hasText: "讓球" })).toContainText("0/30 場");
});

async function expectNoDocumentOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function expectMinimumHeight(locator: Locator, minimum: number, soft = false) {
  const heights = await locator.evaluateAll((elements) => elements
    .filter((element) => getComputedStyle(element).display !== "none")
    .map((element) => element.getBoundingClientRect().height));
  if (soft) {
    expect.soft(heights.length).toBeGreaterThan(0);
    for (const height of heights) expect.soft(height).toBeGreaterThanOrEqual(minimum);
    return;
  }
  expect(heights.length).toBeGreaterThan(0);
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(minimum);
}
