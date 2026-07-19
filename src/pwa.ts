import { useEffect, useState } from "react";

export type ConnectivityState = {
  online: boolean;
  lastSuccessfulSync: string | null;
};

type OnlineStatusTarget = {
  addEventListener: (type: "online" | "offline", listener: () => void) => void;
  removeEventListener: (type: "online" | "offline", listener: () => void) => void;
};

export function initialConnectivityState(
  source?: { onLine?: boolean } | null,
  lastSuccessfulSync: string | null = null,
): ConnectivityState {
  return {
    online: source?.onLine === true,
    lastSuccessfulSync,
  };
}

export function connectivityAfterEvent(
  state: ConnectivityState,
  online: boolean,
): ConnectivityState {
  return { ...state, online };
}

export function subscribeToOnlineStatus(
  target: OnlineStatusTarget,
  listener: (online: boolean) => void,
): () => void {
  const handleOnline = () => listener(true);
  const handleOffline = () => listener(false);
  target.addEventListener("online", handleOnline);
  target.addEventListener("offline", handleOffline);
  return () => {
    target.removeEventListener("online", handleOnline);
    target.removeEventListener("offline", handleOffline);
  };
}

export function canShowActiveOpportunities(
  state: ConnectivityState,
  dataFresh: boolean,
): boolean {
  return state.online && dataFresh;
}

export function useConnectivityState(
  lastSuccessfulSync: string | null = null,
): ConnectivityState {
  const [state, setState] = useState(() => initialConnectivityState(
    typeof navigator === "undefined" ? undefined : navigator,
    lastSuccessfulSync,
  ));

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    return subscribeToOnlineStatus(window as unknown as OnlineStatusTarget, (online) => {
      setState((current) => connectivityAfterEvent(current, online));
    });
  }, []);

  useEffect(() => {
    setState((current) => current.lastSuccessfulSync === lastSuccessfulSync
      ? current
      : { ...current, lastSuccessfulSync });
  }, [lastSuccessfulSync]);

  return state;
}
