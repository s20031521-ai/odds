import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockApi } from "./helpers";

test.beforeEach(async ({ page }) => {
  await mockApi(page, "authenticated");
});

test("dashboard starts behind auth, then only shows fresh pre-match picks from same-origin API", async ({ page }) => {
  await page.goto("/#/dashboard");

  const cards = page.locator(".buy-dashboard .dashboard-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.filter({ hasText: "Value United" })).toHaveCount(1);
  await expect(cards.filter({ hasText: "Boundary FC" })).toHaveCount(1);
  await expect(page.locator(".buy-dashboard")).not.toContainText("Below United");
  await expect(page.locator(".buy-dashboard")).not.toContainText("Past High Edge");
  await expect(page.getByRole("button", { name: "登出" })).toBeVisible();
  await expectNoDocumentOverflow(page);
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

  await page.goto("/#/dashboard");
  await expect(page.locator(".login-panel")).toBeVisible();
  await page.locator(".login-panel input").nth(0).fill("hugo");
  await page.locator(".login-panel input").nth(1).fill("secret");
  await page.getByRole("button", { name: /登入/ }).click();

  await expect(page.locator(".buy-dashboard .dashboard-card")).toHaveCount(2);
  expect(JSON.parse(loginBody)).toEqual({ username: "hugo", password: "secret" });
});

test("responsive navigation, touch targets, fixtures, and detail work", async ({ page }, testInfo) => {
  await page.goto("/#/dashboard");
  const phone = testInfo.project.name === "phone";
  const touchLayout = testInfo.project.name !== "desktop";
  const top = page.locator(".app-navigation--top");
  const bottom = page.locator(".app-navigation--bottom");

  await expect(top).toHaveCSS("display", phone ? "none" : "block");
  await expect(bottom).toHaveCSS("display", phone ? "block" : "none");
  await expect(page.locator(".dashboard-card")).toHaveCount(2);
  await expectDashboardColumns(page, testInfo.project.name);

  const nav = phone ? bottom : top;
  if (touchLayout) {
    await expectMinimumHeight(nav.locator("a"), 44);
    await expectMinimumHeight(page.locator(".buy-dashboard__filters button"), 44);
  }

  await nav.getByRole("link", { name: "賽程" }).click();
  await expect(page).toHaveURL(/#\/fixtures$/);
  await expect(page.locator(".fixture-card-wrap")).toHaveCount(3);
  if (touchLayout) await expectMinimumHeight(page.locator(".market-tabs button"), 44);

  await page.locator('a[href="#/analysis?match=match-value"]').click();
  await expect(page).toHaveURL(/#\/analysis\?match=match-value$/);
  await expect(page.locator(".match-analysis")).toBeVisible();
  await expectNoDocumentOverflow(page);

  await page.goto("/#/fixtures/match-value");
  await expect(page.locator(".fixture-detail")).toBeVisible();

  await nav.getByRole("link", { name: "紀錄" }).click();
  await expect(page).toHaveURL(/#\/history$/);
  // 等紀錄頁專屬內容出現先度按鈕 — hash 轉 URL 後 React 未切頁,
  // 即刻 evaluateAll 有機會量到舊頁已 detached 嘅按鈕(height 0)。
  await expect(page.locator(".model-readiness")).toBeVisible();
  if (touchLayout) await expectMinimumHeight(page.getByRole("button"), 44, true);

  await nav.getByRole("link", { name: "分析" }).click();
  await expect(page).toHaveURL(/#\/analysis$/);
  await nav.getByRole("link", { name: "今日" }).click();
  await expect(page).toHaveURL(/#\/today$/);
});

test("current failures fail closed while a failed live audit feed keeps recorded recommendations", async ({ page }) => {
  const empty = await mockApi(page, "empty");
  await page.goto("/#/dashboard");
  await expect(page.locator(".dashboard-card")).toHaveCount(0);
  await expect(page.locator(".buy-dashboard__empty")).toBeVisible();
  await expect(page.locator(".current-buyable-range-panel")).toHaveCount(0);
  expect(empty.requestedPaths).toContain("GET /api/v1/recommendations/current");

  const failedCurrent = await mockApi(page, "current-failed");
  await page.reload();
  await expect(page.locator(".dashboard-card")).toHaveCount(0);
  await expect(page.locator(".current-buyable-range-panel")).toHaveCount(0);
  expect(failedCurrent.requestedPaths).toContain("GET /api/v1/recommendations/current");

  const failedLive = await mockApi(page, "live-failed");
  await page.reload();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator(".dashboard-card")).toHaveCount(2);
  await expect(page.locator(".current-buyable-range-panel")).toBeVisible();
  await expect(page.locator(".buyable-odds-range__range").first()).toHaveText("2.30–2.40");
  expect(failedLive.requestedPaths).toContain("GET /api/v1/recommendations/current");
});

test("401 from protected API clears the session and returns to login", async ({ page }) => {
  await mockApi(page, "live-failed", { status: 401 });
  await page.goto("/#/dashboard");

  await expect(page.locator(".login-panel")).toBeVisible();
});

test("backtest failure is shown on History without exposing raw stack details", async ({ page }) => {
  await mockApi(page, "backtest-failed");
  await page.goto("/#/history");

  await expect(page.locator(".empty-state[role='alert']")).toBeVisible();
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

  await page.goto("/#/dashboard");
  await page.getByRole("button", { name: "登出" }).click();

  expect(csrf).toBe("csrf-token");
  await expect(page.locator(".login-panel")).toBeVisible();
});

test("production PWA exposes its manifest and registers a service worker", async ({ page }) => {
  await page.goto("/#/dashboard");
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

test("fixtures toolbar filters by league chip and team search, and marks buy fixtures", async ({ page }) => {
  await page.goto("/#/fixtures");

  await expect(page.locator(".fixture-row")).toHaveCount(3);
  // buyMatchIds 同 buy dashboard 一致:match-value + match-boundary 兩場有貨。
  await expect(page.locator(".fixture-row__buy-dot")).toHaveCount(2);

  await page.getByRole("button", { name: "Serie A" }).click();
  await expect(page.locator(".fixture-row")).toHaveCount(1);
  await expect(page.locator(".fixture-row")).toContainText("Below United");

  await page.getByRole("button", { name: "Serie A" }).click();
  await page.getByLabel("搜尋球隊").fill("Boundary");
  await expect(page.locator(".fixture-row")).toHaveCount(1);
  await expect(page.locator(".fixture-row")).toContainText("Boundary FC");
});

test("history shows model readiness plus pending and settled groups", async ({ page }) => {
  await page.goto("/#/history");

  await expect(page.locator(".model-readiness__item")).toHaveCount(4);
  await expect(page.locator(".model-readiness")).toContainText("12/30 場");

  const groups = page.locator(".history-group");
  await expect(groups.nth(0)).toContainText("等緊開賽");
  await expect(page.locator(".pending-card")).toHaveCount(1);
  await expect(page.locator(".pending-card")).toContainText("Value United vs Signal City");

  await expect(groups.nth(1)).toContainText("已完場");
  await expect(groups.nth(1).locator(".fixture-card")).toHaveCount(1);
  await expect(groups.nth(1)).toContainText("Finished United vs Settled City");
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

async function expectDashboardColumns(page: Page, projectName: string) {
  const boxes = await page.locator(".dashboard-card").evaluateAll((cards) => cards.map((card) => {
    const box = card.getBoundingClientRect();
    return { x: Math.round(box.x), y: Math.round(box.y) };
  }));
  expect(boxes).toHaveLength(2);
  if (projectName === "tablet" || projectName === "phone") {
    expect(boxes[1].x).toBe(boxes[0].x);
    expect(boxes[1].y).toBeGreaterThan(boxes[0].y);
  } else {
    expect(boxes[1].x).toBeGreaterThan(boxes[0].x);
    expect(boxes[1].y).toBe(boxes[0].y);
  }
}
