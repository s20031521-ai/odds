import { expect, test } from "@playwright/test";
import { mockApi } from "./helpers";

// Chiikawa UX 改版(commit 2f25bbe)將四頁減到三頁(今日/賽程/表現),
// 獨立嘅 #/analysis 比賽分析頁已經移除,MatchAnalysisPage 唔再接通路由。
// 舊有嘅分析頁測試(picker、四個市場卡、轉場、未知比賽、pick card 跳分析)
// 全部斷言已唔存在嘅 UI,所以廢除;呢個 spec 而家鎖定替代行為:
// 舊 analysis hash 一律安全落返今日頁,唔會白屏或死路由。

test.beforeEach(async ({ page }) => {
  await mockApi(page, "authenticated");
});

test("legacy #/analysis route lands on the today page", async ({ page }) => {
  await page.goto("/#/analysis");
  await expect(page.locator(".application-shell")).toBeVisible();
  await expect(page.locator(".landing-page")).toBeVisible();
  await expect(page.locator("h1")).toContainText("今日");
});

test("legacy #/analysis?match=... route lands on the today page without crashing", async ({ page }) => {
  await page.goto("/#/analysis?match=match-value");
  await expect(page.locator(".application-shell")).toBeVisible();
  await expect(page.locator(".landing-page")).toBeVisible();
  await expect(page.locator("#root")).not.toBeEmpty();
});
