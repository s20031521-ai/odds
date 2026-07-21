import { expect, test } from "@playwright/test";
import { mockApi } from "./helpers";

test.beforeEach(async ({ page }) => {
  await mockApi(page, "authenticated", { dashboardMode: "simple" });
});

test("today page shows pick cards with three-line summary", async ({ page }) => {
  await page.goto("/#/today");
  await expect(page.locator("h1")).toContainText("今日");
  const card = page.locator(".pick-card").first();
  await expect(card).toBeVisible();
  await expect(card.locator(".pick-card__selection")).toContainText("買：");
  await expect(card.locator(".pick-card__odds")).toBeVisible();
});

test("pick card expands in place to show edge and stake", async ({ page }) => {
  await page.goto("/#/today");
  const card = page.locator(".pick-card").first();
  await card.locator("summary").click();
  await expect(card).toHaveAttribute("open", "");
  await expect(card.locator(".pick-card__details")).toContainText("Edge +");
  await expect(card.locator(".pick-card__details")).toContainText("建議注碼 $");
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
