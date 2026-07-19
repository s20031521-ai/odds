import { describe, expect, it } from "vitest";
import { dataHealthWarning } from "./dataHealth";
import * as dataHealthModule from "./dataHealth";

describe("data health warning", () => {
  it("stays quiet while every source is fresh", () => {
    expect(dataHealthWarning({ ok: true, dataFresh: true, staleSources: [] })).toBeNull();
  });

  it("names stale sources in a user-facing warning", () => {
    expect(dataHealthWarning({ ok: true, dataFresh: false, staleSources: ["collector", "hkjc"] }))
      .toBe("資料已過期：後台收集器、HKJC。畫面可能唔係最新，請先恢復資料收集。");
  });
});

describe("data freshness runtime", () => {
  it("keeps unknown, delayed, stale and invalid health fail-closed", () => {
    const resolveFreshness = (dataHealthModule as {
      dataFreshFromHealth?: (health: unknown) => boolean;
    }).dataFreshFromHealth;

    expect(resolveFreshness).toBeTypeOf("function");
    if (!resolveFreshness) return;
    expect(resolveFreshness(undefined)).toBe(false);
    expect(resolveFreshness(null)).toBe(false);
    expect(resolveFreshness({ dataFresh: false, staleSources: [] })).toBe(false);
    expect(resolveFreshness({ dataFresh: true })).toBe(false);
    expect(resolveFreshness({ dataFresh: true, staleSources: [] })).toBe(true);
  });

  it("keeps independently failed HKJC or HDC loads fail-closed after fresh health wins a race", () => {
    type SourceLoadState = { hkjc: boolean | null; hdc: boolean | null };
    type SourceLoadContract = {
      dataLoadStateAfter: (state: SourceLoadState, source: keyof SourceLoadState, succeeded: boolean) => SourceLoadState;
      dataLoadsReady: (state: SourceLoadState) => boolean;
      dataLoadWarning: (state: SourceLoadState) => string | null;
    };
    const candidate = dataHealthModule as unknown as Partial<SourceLoadContract>;

    expect(candidate.dataLoadStateAfter).toBeTypeOf("function");
    expect(candidate.dataLoadsReady).toBeTypeOf("function");
    expect(candidate.dataLoadWarning).toBeTypeOf("function");
    if (!candidate.dataLoadStateAfter || !candidate.dataLoadsReady || !candidate.dataLoadWarning) return;

    const initial: SourceLoadState = { hkjc: null, hdc: null };
    const hdcFailed = candidate.dataLoadStateAfter(
      candidate.dataLoadStateAfter(initial, "hkjc", true),
      "hdc",
      false,
    );
    const hkjcFailed = candidate.dataLoadStateAfter(
      candidate.dataLoadStateAfter(initial, "hdc", true),
      "hkjc",
      false,
    );
    const bothSucceeded = candidate.dataLoadStateAfter(hdcFailed, "hdc", true);

    expect(candidate.dataLoadsReady(initial)).toBe(false);
    expect(candidate.dataLoadsReady(hdcFailed)).toBe(false);
    expect(candidate.dataLoadsReady(hkjcFailed)).toBe(false);
    expect(candidate.dataLoadsReady(bothSucceeded)).toBe(true);
    expect(candidate.dataLoadWarning(hdcFailed)).toContain("HDC");
    expect(candidate.dataLoadWarning(hkjcFailed)).toContain("HKJC");
    expect(candidate.dataLoadWarning(bothSucceeded)).toBeNull();
  });
});
