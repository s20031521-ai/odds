import { describe, expect, it } from "vitest";
import { applyPredictionSnapshots, isPreKickSnapshot, normalizeOutcome, savePredictionSnapshots, settleHighLow, snapshotKey } from "./predictionSnapshots";
import { classifySnapshot, summarizeSnapshotQuality } from "../shared/snapshot-policy.mjs";
// @ts-expect-error Vitest runs this file in Node; the app intentionally has no Node type dependency.
import { readFileSync } from "node:fs";

const validSnapshot = {
  matchId: "m1",
  market: "大細波",
  prediction: "大",
  line: 2.5,
  odds: 2,
  chance: 0.55,
  edge: 0.1,
  savedAt: "2026-07-09T00:00:00Z",
  commenceTime: "2026-07-10T00:00:00Z",
  modelVersion: "totals-loo-v1",
  source: "test",
};

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    dump: () => [...data.values()].join(""),
  };
}

describe("prediction snapshots", () => {
  it("classifies only complete pre-kick current snapshots as valid", () => {
    expect(classifySnapshot(validSnapshot)).toEqual({ status: "valid-current", reason: null });
    expect(classifySnapshot({ ...validSnapshot, commenceTime: undefined }).reason).toBe("missing-commence-time");
    expect(classifySnapshot({ ...validSnapshot, savedAt: validSnapshot.commenceTime }).reason).toBe("post-kickoff");
    expect(classifySnapshot({ ...validSnapshot, odds: 1 }).reason).toBe("invalid-odds");
    expect(classifySnapshot({ ...validSnapshot, chance: 1.1 }).reason).toBe("invalid-chance");
    expect(classifySnapshot({ ...validSnapshot, edge: Number.NaN }).reason).toBe("invalid-edge");
    expect(classifySnapshot({ ...validSnapshot, line: undefined }).reason).toBe("missing-line");
    expect(classifySnapshot({ ...validSnapshot, line: 2.3 }).reason).toBe("invalid-line");
    expect(classifySnapshot({ ...validSnapshot, modelVersion: undefined })).toEqual({ status: "legacy", reason: "legacy-model" });
  });

  it("summarizes snapshot quality without changing input rows", () => {
    const rows = [validSnapshot, { ...validSnapshot, matchId: "bad", odds: 0 }, { ...validSnapshot, matchId: "old", modelVersion: "legacy-v0" }];
    expect(summarizeSnapshotQuality(rows)).toEqual({ raw: 3, validCurrent: 1, legacy: 1, invalid: 1, invalidReasons: { "invalid-odds": 1 } });
    expect(rows[1].odds).toBe(0);
  });

  it("stores only snapshots accepted by the canonical policy", () => {
    const storage = memoryStorage();
    savePredictionSnapshots([validSnapshot, { ...validSnapshot, matchId: "bad", odds: 1 }], storage);
    expect(storage.dump()).toContain('"matchId":"m1"');
    expect(storage.dump()).not.toContain('"matchId":"bad"');
  });

  it("fills completed result rows from saved pre-match picks", () => {
    const storage = memoryStorage();
    savePredictionSnapshots([
      { ...validSnapshot, matchId: "m1" },
      { ...validSnapshot, matchId: "m2", market: "主客和", prediction: "客勝", line: undefined, modelVersion: "consensus-v1" },
      { ...validSnapshot, matchId: "m3", market: "亞洲讓球", prediction: "主", line: -0.75, modelVersion: "hdc-loo-v2" },
    ], storage);

    const rows = applyPredictionSnapshots([
      { matchId: "m1", market: "大細波", actual: "3 球", prediction: "未有賽前快照", hit: null },
      { matchId: "m2", market: "主客和", actual: "主勝", prediction: "未有賽前快照", hit: null },
      { matchId: "m3", market: "亞洲讓球", actual: "2-1", prediction: "未有賽前快照", hit: null },
    ], storage);

    expect(rows[0]).toMatchObject({ prediction: "大", hit: true, line: 2.5 });
    expect(rows[1]).toMatchObject({ prediction: "客勝", hit: false });
    expect(rows[2]).toMatchObject({ prediction: "主", hit: true, line: -0.75 });
  });

  it("settles draws and Asian quarter lines without treating half outcomes as full wins", () => {
    expect(normalizeOutcome("和")).toBe("和局");
    expect(settleHighLow("細", 2.25, 2)).toBe("half-win");
    expect(settleHighLow("大", 2.25, 2)).toBe("half-loss");
    expect(settleHighLow("大", 2.25, 3)).toBe("win");
    expect(settleHighLow("細", 2.75, 2)).toBe("win");
    expect(settleHighLow("大", 2, 2)).toBe("push");
  });

  it("preserves the selected bookmaker", () => {
    const storage = memoryStorage();
    savePredictionSnapshots([{ ...validSnapshot, matchId: "event-1", market: "亞洲讓球", prediction: "主", line: -0.75, modelVersion: "hdc-loo-v2", bookmaker: "Book A" }], storage);
    expect(storage.dump()).toContain('"bookmaker":"Book A"');
  });

  it("keeps line and model version in immutable snapshot identity", () => {
    expect(snapshotKey({ matchId: "m1", market: "大細波", line: 2.5, modelVersion: "market-v1" })).toBe("m1|大細波|2.5|market-v1");
    expect(snapshotKey({ matchId: "m1", market: "主客和" })).toBe("m1|主客和||legacy-v0");
  });

  it("rejects snapshots saved at or after kickoff", () => {
    expect(isPreKickSnapshot({ savedAt: "2026-07-09T23:59:59Z", commenceTime: "2026-07-10T00:00:00Z" })).toBe(true);
    expect(isPreKickSnapshot({ savedAt: "2026-07-10T00:00:00Z", commenceTime: "2026-07-10T00:00:00Z" })).toBe(false);
    const storage = memoryStorage();
    savePredictionSnapshots([{ ...validSnapshot, matchId: "late", savedAt: "2026-07-10T00:00:01Z" }], storage);
    expect(storage.dump()).not.toContain("late");
  });

  it("posts through same-origin api/v1 without loopback defaults", () => {
    const source = readFileSync(new URL("./predictionSnapshots.ts", import.meta.url), "utf8");
    expect(source).toContain('fetch("/api/v1/predictions"');
    expect(source).toContain('credentials: "same-origin"');
    expect(source).toContain('"x-csrf-token"');
    expect(source).not.toContain("127.0.0.1:8787");
  });
});
