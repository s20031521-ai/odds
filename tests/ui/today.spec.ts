import { expect, test } from "@playwright/test";
import { mockApi } from "./helpers";

let requestedPaths: string[];

test.beforeEach(async ({ page }) => {
  ({ requestedPaths } = await mockApi(page, "authenticated"));
});

test("today page shows server-recorded pick cards with the current quote range", async ({ page }) => {
  await page.goto("/#/today");
  await expect(page.locator("h1")).toContainText("今日");
  const cards = page.locator(".landing-page__picks .pick-card");
  await expect(cards).toHaveCount(2);
  const card = cards.first();
  await expect(card.locator(".pick-card__summary")).toContainText("Value United vs Signal City");
  // Chiikawa 改版後賠率範圍收咗入 PickCard 嘅 inline expand 入面。
  await card.locator(".pick-card__summary").click();
  await expect(card.locator(".buyable-odds-range__range")).toHaveText("2.30–2.40");
  await expect(card.locator(".buyable-odds-range__summary")).toContainText("最佳 2.40");
  expect(requestedPaths).toContain("GET /api/v1/recommendations/current");
});

test("pick card expands the server-recorded per-bookmaker quote details", async ({ page }) => {
  await page.goto("/#/today");
  const card = page.locator(".landing-page__picks .pick-card").first();
  await card.locator(".pick-card__summary").click();
  const quoteDetails = card.locator(".buyable-odds-range__quotes");
  await quoteDetails.locator("summary").click();
  await expect(quoteDetails).toHaveAttribute("open", "");
  await expect(quoteDetails.locator(".buyable-odds-range__quote")).toHaveCount(2);
  await expect(quoteDetails.locator(".buyable-odds-range__quote").first()).toContainText("Book A");
  await expect(quoteDetails).toContainText("Book A");
  await expect(quoteDetails).toContainText("HKJC");
  await expect(quoteDetails).toContainText("最低 2.06");
  await expect(quoteDetails).toContainText("Edge +20.00%");
});

test("legacy #/dashboard lands on today page", async ({ page }) => {
  await page.goto("/#/dashboard");
  await expect(page.locator(".landing-page")).toBeVisible();
});

test("empty scenario shows a friendly no-pick message", async ({ page }) => {
  await mockApi(page, "empty");
  await page.goto("/#/today");
  await expect(page.locator(".landing-page__empty")).toBeVisible();
  await expect(page.locator(".landing-page__empty")).toContainText("暫無推薦");
});

test("freshness bar is visible with role status", async ({ page }) => {
  await page.goto("/#/today");
  await expect(page.locator(".freshness-bar")).toHaveAttribute("role", "status");
});

test("today page shows every recorded pick without truncation", async ({ page }) => {
  // 取代舊嘅「仲有 X 個盤 → 切 pro dashboard」斷言:pro 模式已喺 Chiikawa 改版移除,
  // 而家所有 server-recorded 盤直接晒喺今日頁,唔再截斷。
  await mockApi(page, "many-picks");
  await page.goto("/#/today");
  await expect(page.locator(".landing-page__picks .pick-card")).toHaveCount(6);
});
