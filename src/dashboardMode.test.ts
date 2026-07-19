import { describe, expect, it } from "vitest";
import {
  DASHBOARD_MODE_STORAGE_KEY,
  readDashboardMode,
  writeDashboardMode,
  type StorageLike,
} from "./dashboardMode";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: StorageLike = {
    getItem: (key) => (data.has(key) ? data.get(key)! : null),
    setItem: (key, value) => { data.set(key, value); },
  };
  return { storage, data };
}

describe("readDashboardMode", () => {
  it("defaults to simple when storage is missing or empty", () => {
    expect(readDashboardMode(undefined)).toBe("simple");
    expect(readDashboardMode(fakeStorage().storage)).toBe("simple");
  });

  it("returns pro only for the exact stored value pro", () => {
    expect(readDashboardMode(fakeStorage({ [DASHBOARD_MODE_STORAGE_KEY]: "pro" }).storage)).toBe("pro");
  });

  it("treats invalid stored values as simple", () => {
    expect(readDashboardMode(fakeStorage({ [DASHBOARD_MODE_STORAGE_KEY]: "weird" }).storage)).toBe("simple");
  });

  it("falls back to simple when storage throws", () => {
    const broken: StorageLike = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    };
    expect(readDashboardMode(broken)).toBe("simple");
  });
});

describe("writeDashboardMode", () => {
  it("persists the mode under the canonical key", () => {
    const { storage, data } = fakeStorage();
    writeDashboardMode("pro", storage);
    expect(data.get(DASHBOARD_MODE_STORAGE_KEY)).toBe("pro");
  });

  it("does not throw when storage is missing or broken", () => {
    expect(() => writeDashboardMode("pro", undefined)).not.toThrow();
    const broken: StorageLike = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    };
    expect(() => writeDashboardMode("simple", broken)).not.toThrow();
  });
});
