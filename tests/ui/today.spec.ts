import { expect, test } from "@playwright/test";
import { mockApi } from "./helpers";

let requestedPaths: string[];

test.beforeEach(async ({ page }) => {
  ({ requestedPaths } = await mockApi(page, "authenticated", { dashboardMode: "simple" }));
});

test("today page shows server-recorded pick cards with the current quote range", async ({ page }) => {
  await page.goto("/#/today");
  await expect(page.locator("h1")).toContainText("今日");
  const card = page.locator(".pick-card").first();
  await expect(card).toBeVisible();
  await expect(card.locator(".pick-card__match")).toContainText("Value United vs Signal City");
  await expect(card.locator(".buyable-odds-range__range")).toHaveText("2.30–2.40");
  await expect(card.locator(".buyable-odds-range__summary")).toContainText("最佳 2.40");
  expect(requestedPaths).toContain("/api/v1/recommendations/current");
});

test("pick card expands the server-recorded per-bookmaker quote details", async ({ page }) => {
  await page.goto("/#/today");
  const card = page.locator(".pick-card").first();
  const quoteDetails = card.locator(".buyable-odds-range__quotes");
  await quoteDetails.locator("summary").click();
  await expect(quoteDetails).toHaveAttribute("open", "");
  await expect(quoteDetails.locator(".buyable-odds-range__quote")).toHaveCount(2);
  await expect(quoteDetails).toContainText("Book A");
  await expect(quoteDetails).toContainText("HKJC");
  await expect(quoteDetails).toContainText("最低 2.06");
  await expect(quoteDetails).toContainText("Edge +20.00%");
});

test("legacy #/dashboard lands on today page", async ({ page }) => {
  await page.goto("/#/dashboard");
  await expect(page.locator(".today-page")).toBeVisible();
});

test("empty scenario shows a friendly no-pick message", async ({ page }) => {
  await mockApi(page, "empty", { dashboardMode: "simple" });
  await page.goto("/#/today");
  await expect(page.locator(".today-empty")).toBeVisible();
  await expect(page.locator(".today-empty")).toContainText(/冇波睇|冇盤值博/);
});

test("freshness bar is visible with role status", async ({ page }) => {
  await page.goto("/#/today");
  await expect(page.locator(".freshness-bar")).toHaveAttribute("role", "status");
});

test("overflow button switches from today page to the pro dashboard", async ({ page }) => {
  await mockApi(page, "many-picks", { dashboardMode: "simple" });
  await page.goto("/#/today");
  const showAll = page.locator(".today-page__show-all");
  await expect(showAll).toHaveText("仲有 1 個盤 →");
  await showAll.click();
  await expect(page.locator(".buy-dashboard")).toBeVisible();
  await expect(page.locator("#buy-dashboard-title")).toBeVisible();
});
