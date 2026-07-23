import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockApi } from "./helpers";

test.beforeEach(async ({ page }) => {
  await mockApi(page, "authenticated");
});

test("dashboard starts behind auth, then only shows fresh pre-match picks from same-origin API", async ({ page }) => {
  await page.goto("/#/today");

  // 舊版斷言 pro 模式 .buy-dashboard .dashboard-card;Chiikawa 改版後
  // server-recorded 盤喺今日頁 .landing-page__picks 嘅 PickCard。
  const cards = page.locator(".landing-page__picks .pick-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.filter({ hasText: "Value United" })).toHaveCount(1);
  await expect(cards.filter({ hasText: "Boundary FC" })).toHaveCount(1);
  await expect(page.locator(".landing-page__picks")).not.toContainText("Below United");
  await expect(page.locator(".landing-page__picks")).not.toContainText("Past High Edge");
  await expect(page.getByRole("button", { name: "登出" })).toBeVisible();
  await expectNoDocumentOverflow(page);
});

test("renders dashboard when the API serves flat per-selection rows", async ({ page }) => {
  // Regression: production /api/v1/odds/live returns one flat row per
  // market+selection; the un-normalized payload crashed the render and the
  // page went completely blank (#root emptied).
  await mockApi(page, "flat-live");
  await page.goto("/#/today");

  await expect(page.locator(".application-shell")).toBeVisible();
  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page.locator("main")).toContainText("Value United");
});

test("guest sees login page and login posts credentials to /api/v1/auth/login", async ({ page }) => {
  let loginBody = "";
  await mockApi(page, "guest", {
    onLogin: async (route) => {
      loginBody = route.request().postData() ?? "";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ authenticated: true, csrfToken: "csrf-after-login", owner: { username: "hugo" } }),
      });
    },
  });

  await page.goto("/#/today");
  await expect(page.locator(".login-panel")).toBeVisible();
  await page.locator(".login-panel input").nth(0).fill("hugo");
  await page.locator(".login-panel input").nth(1).fill("secret");
  await page.getByRole("button", { name: /登入/ }).click();

  await expect(page.locator(".landing-page__picks .pick-card")).toHaveCount(2);
  expect(JSON.parse(loginBody)).toEqual({ username: "hugo", password: "secret" });
});

test("responsive navigation, touch targets, fixtures, and performance pages work", async ({ page }, testInfo) => {
  await page.goto("/#/today");
  const touchLayout = testInfo.project.name !== "desktop";
  // 舊版有 .app-navigation--top/--bottom 雙導航;改版後得一條三格 bottom nav,
  // 所有 viewport 都顯示。
  const nav = page.locator(".app-navigation");
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link", { name: "今日" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".landing-page__picks .pick-card")).toHaveCount(2);
  if (touchLayout) {
    await expectMinimumHeight(nav.locator("a"), 44);
  }

  await nav.getByRole("link", { name: "賽程" }).click();
  await expect(page).toHaveURL(/#\/fixtures$/);
  await expect(page.locator(".fixtures-group__item")).toHaveCount(3);
  await expectNoDocumentOverflow(page);

  await nav.getByRole("link", { name: "表現" }).click();
  await expect(page).toHaveURL(/#\/performance$/);
  await expect(page.locator(".performance-card")).toHaveCount(4);
  if (touchLayout) await expectMinimumHeight(page.getByRole("button"), 44, true);

  await nav.getByRole("link", { name: "今日" }).click();
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

test("401 from protected API clears the session and returns to login", async ({ page }) => {
  await mockApi(page, "live-failed", { status: 401 });
  await page.goto("/#/today");

  await expect(page.locator(".login-panel")).toBeVisible();
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

test("logout calls /api/v1/auth/logout with CSRF and returns to login", async ({ page }) => {
  let csrf = "";
  await mockApi(page, "authenticated", {
    onLogout: async (route) => {
      csrf = route.request().headers()["x-csrf-token"] ?? "";
      await route.fulfill({ status: 204, body: "" });
    },
  });

  await page.goto("/#/today");
  await page.getByRole("button", { name: "登出" }).click();

  expect(csrf).toBe("csrf-token");
  await expect(page.locator(".login-panel")).toBeVisible();
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
  // 舊版斷言聯賽 chip 篩選、球隊搜尋同 buy dot;呢啲 toolbar 功能已喺改版移除,
  // 而家賽程頁按日期分組列出所有未開賽賽事。
  await page.goto("/#/fixtures");

  await expect(page.locator(".fixtures-group__item")).toHaveCount(3);
  await expect(page.locator(".fixtures-page")).toContainText("Value United vs Signal City");
  await expect(page.locator(".fixtures-page")).toContainText("Boundary FC vs Threshold Town");
  await expect(page.locator(".fixtures-page")).toContainText("Below United vs No Buy Rovers");
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
