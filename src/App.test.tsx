// @ts-expect-error Vitest runs this file in Node; the app intentionally has no Node type dependency.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("App integration source", () => {
  it("wires the shell and both new pages without the old topbar or page tabs", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).toContain('import { AppShell } from "./components/AppShell"');
    expect(source).toContain('import { DashboardPage, recordedOpportunitiesForDashboard } from "./pages/DashboardPage"');
    expect(source).toContain('import { AllFixtures } from "./pages/AllFixtures"');
    expect(source).toContain('import { LoginPage } from "./pages/LoginPage"');
    expect(source).toContain('createApiClient');
    expect(source).toContain("<AppShell");
    expect(source).toContain("<DashboardPage");
    expect(source).toContain("<AllFixtures");
    expect(source).not.toContain('className="topbar"');
    expect(source).not.toContain('className="page-tabs"');
  });

  it("uses authenticated api client instead of loopback or public odds runtime paths", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).toContain("apiClient.session()");
    expect(source).toContain("apiClient.login");
    expect(source).toContain("apiClient.liveOdds");
    expect(source).toContain("apiClient.backtest");
    expect(source).toContain("isModelReadiness");
    expect(source).toContain("isPendingEntry");
    expect(source).toContain("setPendingEntries");
    expect(source).toContain("apiClient.currentRecommendations()");
    expect(source).toContain("apiClient.predictionObservations(sampleId)");
    expect(source).not.toContain("apiClient.savePredictions");
    expect(source).toContain("apiClient.logout");
    expect(source).toContain("normalizeLiveOddsPayload");
    expect(source).toContain("isManualEntry");
    expect(source).toContain("isTotalsMarketEntry");
    expect(source).toContain("isHandicapEntry");
    expect(source).toContain("<LoginPage");
    expect(source).toContain("onLogout={handleLogout}");
    expect(source).not.toContain("127.0.0.1:8787");
    expect(source).not.toContain("/hkjc-odds.json");
  });

  it("uses recorded server opportunities as the only Today and professional source", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).toContain("const [recordedOpportunities, setRecordedOpportunities]");
    expect(source).toContain("recordedOpportunitiesForDashboard(activeRecordedOpportunities)");
    expect(source).toContain("recordedOpportunities={activeRecordedOpportunities}");
    expect(source).toMatch(/<DashboardPage[\s\S]{0,240}opportunities=\{buyOpportunities\}/);
    expect(source).not.toMatch(/<MatchAnalysisPage[\s\S]{0,240}opportunities=\{buyOpportunities\}/);
    expect(source).not.toContain("selectBuyOpportunities(buyCandidates");
    expect(source).not.toContain("buildBuyCandidates({");
  });

  it("loads observation history only from an explicit callback passed to match/history disclosures", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).toContain("async function loadRecommendationObservations(sampleId: number)");
    expect(source).toContain("loadObservations={loadRecommendationObservations}");
    expect(source).not.toMatch(/useEffect\(\(\) => \{[\s\S]{0,300}predictionObservations/);
  });

  it("preserves standalone History and Analysis page headings after removing the old topbar", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).toContain('{page === "history" ? <h1 className="page-heading">完場對比</h1> : null}');
    expect(source).toContain('<MatchAnalysisPage');
    expect(source).toContain('matchId={analysisMatchId}');
    expect(source).toContain("model-readiness");
    expect(source).toContain("等緊開賽");
    expect(source).toContain("已完場");
    expect(source).toContain("PendingCard");
  });

  it("starts freshness fail-closed and only trusts a validated health response", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).toContain("useState(false)");
    expect(source).not.toContain("const [dataFresh, setDataFresh] = useState(true)");
    expect(source).toContain("setDataFresh(dataFreshFromHealth(body))");
    expect(source).toMatch(/catch \{[\s\S]*?setDataFresh\(false\)/);
  });

  it("does not run a browser-side candidate selector clock", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).not.toContain("candidateSelectionRuntime");
    expect(source).not.toContain("selectionNow");
    expect(source).not.toContain("buildBuyCandidates");
    expect(source).not.toContain("selectBuyOpportunities");
  });

  it("marks recommendations usable only after the authenticated current response succeeds", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).toContain("if (!auth.authenticated)");
    expect(source).toContain("apiClient.currentRecommendations()");
    expect(source).toContain('response.strategyVersion !== "unified-buyable-v1"');
    expect(source).toContain("setRecommendationsLoaded(true)");
    expect(source).toContain("setRecommendationsLoaded(false)");
  });

  it("uses the route transition helper when hash navigation changes", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).toContain("tabForRouteTransition");
    expect(source).toContain("setAnalysisTab((current) => tabForRouteTransition(current, window.location.hash))");
  });

  it("combines online status with a successful recorded response before showing opportunities", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).toContain('import { canShowActiveOpportunities, useConnectivityState } from "./pwa"');
    expect(source).toContain("const connectivity = useConnectivityState(lastSuccessfulSync)");
    expect(source).toContain("const recommendationsTrusted = canShowActiveOpportunities(connectivity, recommendationsLoaded)");
    expect(source).toContain("const activeRecordedOpportunities = recommendationsTrusted ? recordedOpportunities : []");
    expect(source).toContain("recordedOpportunities={activeRecordedOpportunities}");
    expect(source).toContain("dataFresh={recommendationsTrusted}");
  });

  it("recomputes freshness when same-origin live odds load state changes", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).toContain("setDataFresh(dataLoadsReady(dataLoads));");
    expect(source).toContain("}, [dataLoads]);");
  });

  it("starts sync disclosure empty and records it only in successful HKJC or HDC load paths", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).toContain("const [lastSuccessfulSync, setLastSuccessfulSync] = useState<string | null>(null)");
    expect(source).toContain("useConnectivityState(lastSuccessfulSync)");
    expect(source).toContain("generatedAt={lastSuccessfulSync}");
    expect(source.match(/setLastSuccessfulSync\(new Date\(\)\.toISOString\(\)\)/g) ?? []).toHaveLength(2);
    expect(source).not.toContain("const [generatedAt, setGeneratedAt]");
  });

  it("composes health with independent HKJC and HDC load success and exposes load warnings", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).toContain("dataLoadsReady(dataLoads)");
    expect(source).toContain("dataLoadWarning(dataLoads)");
    expect(source).toContain('dataLoadStateAfter(current, "hkjc", false)');
    expect(source).toContain('dataLoadStateAfter(current, "hdc", false)');
    expect(source).toContain("const recommendationsTrusted = canShowActiveOpportunities(connectivity, recommendationsLoaded)");
  });

  it("shows the exact offline warning and does not replace health validation on reconnect", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).toContain('const OFFLINE_WARNING = "目前離線；已隱藏值得買機會，連線後會自動恢復。"');
    expect(source).toContain('const dashboardWarning = [loadWarning, dataWarning].filter(Boolean).join(" ")');
    expect(source).toContain("connectivity.online ? dashboardWarning : OFFLINE_WARNING");
    expect(source).toContain("canShowActiveOpportunities(connectivity, recommendationsLoaded)");
    expect(source).not.toContain("setDataFresh(connectivity.online)");
    expect(source).toContain("formatFixtureDayHeading");
    expect(source).toContain("buyMatchIds");
    expect(source).toContain("fixture-row__buy-dot");
    expect(source).toContain("visibleFixtureDayGroups");
    expect(source).toContain("fixture-chip");
    expect(source).toContain("搜尋球隊");
  });

  it("gates buy CTAs behind the post-kickoff label on market cards and fixture rows", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).toContain('import { gatePickLabel } from "./kickoffGate"');
    expect(source).toContain("gatePickLabel(bestPick.label, fixture.commenceTime)");
    expect(source).toContain("gatePickLabel(card.pickLabel, card.commenceTime)");
    expect(source).toContain("gatePickLabel(line.pickLabel, line.commenceTime)");
  });
});
