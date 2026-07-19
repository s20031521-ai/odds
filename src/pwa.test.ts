// @ts-expect-error Vitest runs this file in Node; the app intentionally has no Node type dependency.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as pwaModule from "./pwa";

type PwaContract = {
  initialConnectivityState: (
    source?: { onLine?: boolean } | null,
    lastSuccessfulSync?: string | null,
  ) => { online: boolean; lastSuccessfulSync: string | null };
  connectivityAfterEvent: (
    state: { online: boolean; lastSuccessfulSync: string | null },
    online: boolean,
  ) => { online: boolean; lastSuccessfulSync: string | null };
  subscribeToOnlineStatus: (
    target: {
      addEventListener: (type: "online" | "offline", listener: () => void) => void;
      removeEventListener: (type: "online" | "offline", listener: () => void) => void;
    },
    listener: (online: boolean) => void,
  ) => () => void;
  canShowActiveOpportunities: (
    state: { online: boolean; lastSuccessfulSync: string | null },
    dataFresh: boolean,
  ) => boolean;
};

function contract(): PwaContract {
  const candidate = pwaModule as unknown as Partial<PwaContract>;
  expect(candidate.initialConnectivityState).toBeTypeOf("function");
  expect(candidate.connectivityAfterEvent).toBeTypeOf("function");
  expect(candidate.subscribeToOnlineStatus).toBeTypeOf("function");
  expect(candidate.canShowActiveOpportunities).toBeTypeOf("function");
  return candidate as PwaContract;
}

class FakeOnlineTarget {
  private listeners = new Map<"online" | "offline", Set<() => void>>();
  readonly removed: Array<{ type: "online" | "offline"; listener: () => void }> = [];

  addEventListener(type: "online" | "offline", listener: () => void) {
    const current = this.listeners.get(type) ?? new Set();
    current.add(listener);
    this.listeners.set(type, current);
  }

  removeEventListener(type: "online" | "offline", listener: () => void) {
    this.listeners.get(type)?.delete(listener);
    this.removed.push({ type, listener });
  }

  emit(type: "online" | "offline") {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

describe("PWA module contract", () => {
  it("provides a dedicated typed PWA helper module", () => {
    expect(existsSync(new URL("./pwa.ts", import.meta.url))).toBe(true);
  });

  it("initializes from navigator.onLine and treats missing or unknown status as offline", () => {
    const { initialConnectivityState } = contract();

    expect(initialConnectivityState({ onLine: true })).toEqual({ online: true, lastSuccessfulSync: null });
    expect(initialConnectivityState({ onLine: false })).toEqual({ online: false, lastSuccessfulSync: null });
    expect(initialConnectivityState({})).toEqual({ online: false, lastSuccessfulSync: null });
    expect(initialConnectivityState(undefined)).toEqual({ online: false, lastSuccessfulSync: null });
  });

  it("applies online and offline transitions without changing the last successful sync", () => {
    const { connectivityAfterEvent } = contract();
    const initial = { online: true, lastSuccessfulSync: "2026-07-16T12:00:00.000Z" };

    const offline = connectivityAfterEvent(initial, false);
    const online = connectivityAfterEvent(offline, true);

    expect(offline).toEqual({ online: false, lastSuccessfulSync: initial.lastSuccessfulSync });
    expect(online).toEqual({ online: true, lastSuccessfulSync: initial.lastSuccessfulSync });
  });

  it("subscribes to online and offline events and removes the exact listeners during cleanup", () => {
    const { subscribeToOnlineStatus } = contract();
    const target = new FakeOnlineTarget();
    const transitions: boolean[] = [];

    const cleanup = subscribeToOnlineStatus(target, (online) => transitions.push(online));
    target.emit("offline");
    target.emit("online");
    cleanup();
    target.emit("offline");

    expect(transitions).toEqual([false, true]);
    expect(target.removed).toHaveLength(2);
    expect(target.removed.map(({ type }) => type).sort()).toEqual(["offline", "online"]);
  });

  it("trusts opportunity data only when both health freshness and online status are true", () => {
    const { canShowActiveOpportunities } = contract();
    const online = { online: true, lastSuccessfulSync: "2026-07-16T12:00:00.000Z" };
    const offline = { ...online, online: false };

    expect(canShowActiveOpportunities(online, true)).toBe(true);
    expect(canShowActiveOpportunities(online, false)).toBe(false);
    expect(canShowActiveOpportunities(offline, true)).toBe(false);
    expect(canShowActiveOpportunities(offline, false)).toBe(false);
  });
});
