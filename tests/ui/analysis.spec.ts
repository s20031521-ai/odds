import { expect, test } from "@playwright/test";
import { mockApi } from "./helpers";

test.beforeEach(async ({ page }) => {
  await mockApi(page, "authenticated", { dashboardMode: "simple" });
});

test("bare analysis route shows picker with quick links", async ({ page }) => {
  await page.goto("/#/analysis");
  await expect(page.getByText("由今日或賽程揀一場波")).toBeVisible();
  await expect(page.locator('a[href="#/analysis?match=match-value"]')).toBeVisible();
});

test("match analysis page shows four market cards with empty states", async ({ page }) => {
  await page.goto("/#/analysis?match=match-value");
  await expect(page.locator(".match-analysis")).toBeVisible();
  await expect(page.getByText("Value United vs Signal City")).toBeVisible();
  await expect(page.getByText("模型估").first()).toBeVisible();
  await expect(page.getByText("呢個市場冇盤")).toHaveCount(2); // 角球 + 亞洲讓球 mock 冇數據
});

test("switch-match link returns to picker", async ({ page }) => {
  await page.goto("/#/analysis?match=match-value");
  await page.getByRole("link", { name: "轉場" }).click();
  await expect(page).toHaveURL(/#\/analysis$/);
  await expect(page.getByText("由今日或賽程揀一場波")).toBeVisible();
});

test("unknown match shows not-found state", async ({ page }) => {
  await page.goto("/#/analysis?match=no-such-match");
  await expect(page.getByText("搵唔到呢場波")).toBeVisible();
});

test("today page pick card links to match analysis", async ({ page }) => {
  await page.goto("/#/today");
  await page.locator(".pick-card__summary").first().click();
  await page.locator(".pick-card__analysis-link").first().click();
  await expect(page).toHaveURL(/#\/analysis\?match=/);
  await expect(page.locator(".match-analysis")).toBeVisible();
});
