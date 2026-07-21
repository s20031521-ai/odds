import type { Page } from "@playwright/test";
import { DASHBOARD_MODE_STORAGE_KEY } from "../../src/dashboardMode";

const FUTURE_KICKOFF = "2030-07-17T12:00:00.000Z";
const PAST_KICKOFF = "2020-07-17T12:00:00.000Z";

export type Scenario = "authenticated" | "guest" | "empty" | "live-failed" | "backtest-failed";

export function entry(id: string, matchId: string, homeTeam: string, awayTeam: string, bookmaker: string, odds: { home: number; draw: number; away: number }, commenceTime = FUTURE_KICKOFF) {
  return { id, matchId, homeTeam, awayTeam, commenceTime, bookmaker, odds };
}

export function total(id: string, matchId: string, homeTeam: string, awayTeam: string, bookmaker: string, overOdds: number, underOdds: number) {
  return { id, matchId, homeTeam, awayTeam, commenceTime: FUTURE_KICKOFF, bookmaker, line: 2.5, overOdds, underOdds };
}

export const h2hEntries = [
  entry("value-a", "match-value", "Value United", "Signal City", "Book A", { home: 2.4, draw: 3.2, away: 3.0 }),
  entry("value-b", "match-value", "Value United", "Signal City", "Book B", { home: 1.8, draw: 3.6, away: 4.8 }),
  entry("boundary-a", "match-boundary", "Boundary FC", "Threshold Town", "Book A", { home: 2.0, draw: 3.5, away: 4.0 }),
  entry("boundary-b", "match-boundary", "Boundary FC", "Threshold Town", "Book B", { home: 2.0, draw: 3.5, away: 4.0 }),
  entry("below-a", "match-below", "Below United", "No Buy Rovers", "Book A", { home: 2.0, draw: 3.5, away: 4.0 }),
  entry("below-b", "match-below", "Below United", "No Buy Rovers", "Book B", { home: 2.0, draw: 3.5, away: 4.0 }),
  entry("past-a", "match-past", "Past High Edge", "Expired City", "Book A", { home: 10, draw: 2, away: 2 }, PAST_KICKOFF),
  entry("past-b", "match-past", "Past High Edge", "Expired City", "Book B", { home: 1.1, draw: 10, away: 10 }, PAST_KICKOFF),
];

export const totalEntries = [
  total("value-total-a", "match-value", "Value United", "Signal City", "Book A", 2.2, 1.7),
  total("value-total-b", "match-value", "Value United", "Signal City", "Book B", 1.8, 2.05),
  total("boundary-total-a", "match-boundary", "Boundary FC", "Threshold Town", "Book A", 2.06, 2.06),
  total("boundary-total-b", "match-boundary", "Boundary FC", "Threshold Town", "Book B", 2.0, 2.0),
  total("below-total-a", "match-below", "Below United", "No Buy Rovers", "Book A", 2.0598, 2.0598),
  total("below-total-b", "match-below", "Below United", "No Buy Rovers", "Book B", 2.0, 2.0),
];

export async function mockApi(
  page: Page,
  scenario: Scenario,
  options: {
    status?: number;
    dashboardMode?: "simple" | "pro";
    onLogin?: Parameters<Page["route"]>[1];
    onLogout?: Parameters<Page["route"]>[1];
  } = {},
) {
  await page.unroute("**/api/v1/**").catch(() => undefined);
  await page.unroute("**/hkjc-odds.json").catch(() => undefined);
  await page.unroute("http://127.0.0.1:8787/**").catch(() => undefined);

  // 產品預設 dashboard 模式係「極簡」(simple),但呢個 spec 斷言嘅係「專業」(pro) 模式
  // 嘅 .buy-dashboard 結構。喺每次導航前預設寫入 localStorage,等測試環境一律行 pro。
  // init script 會套用於其後所有導航同 reload。
  await page.addInitScript(
    ([key, value]: [string, string]) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // 寫入失敗(例如私隱模式)就由頁面自己回落到產品預設。
      }
    },
    [DASHBOARD_MODE_STORAGE_KEY, options.dashboardMode ?? "pro"],
  );

  await page.route("**/hkjc-odds.json", (route) => {
    throw new Error(`legacy public odds route used: ${route.request().url()}`);
  });
  await page.route("http://127.0.0.1:8787/**", (route) => {
    throw new Error(`legacy loopback route used: ${route.request().url()}`);
  });

  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());

    if (pathname === "/api/v1/session") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(scenario === "guest"
          ? { authenticated: false }
          : { authenticated: true, csrfToken: "csrf-token", owner: { username: "hugo" } }),
      });
      return;
    }

    if (pathname === "/api/v1/auth/login") {
      if (options.onLogin) {
        await options.onLogin(route, route.request());
        return;
      }
      await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "invalid_credentials" }) });
      return;
    }

    if (pathname === "/api/v1/auth/logout") {
      if (options.onLogout) {
        await options.onLogout(route, route.request());
        return;
      }
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    if (pathname === "/api/v1/odds/live") {
      if (scenario === "live-failed") {
        await route.fulfill({ status: options.status ?? 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) });
        return;
      }
      const empty = scenario === "empty";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          entries: empty ? [] : h2hEntries,
          totalEntries: empty ? [] : totalEntries,
          cornerEntries: [],
          handicapEntries: [],
          resultEntries: [],
        }),
      });
      return;
    }

    if (pathname === "/api/v1/backtest") {
      await route.fulfill({
        status: scenario === "backtest-failed" ? 503 : 200,
        contentType: "application/json",
        body: JSON.stringify(scenario === "backtest-failed"
          ? { error: "unavailable" }
          : { rows: [], readiness: [], snapshotQuality: null }),
      });
      return;
    }

    if (pathname === "/api/v1/predictions") {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    throw new Error(`Unmocked app data request: ${route.request().method()} ${route.request().url()}`);
  });
}
