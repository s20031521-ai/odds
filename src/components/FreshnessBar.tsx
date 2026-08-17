import { useEffect, useState } from "react";

const TICK_MS = 30_000;

/** 內部每 30 秒重計，等「X 分鐘前」開住個 app 都保持準確 */
function useTickingNow(override?: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (override !== undefined) return;
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [override]);
  return override ?? now;
}

export function FreshnessBar(props: {
  generatedAt: string | null;
  dataFresh: boolean;
  now?: number;
}): React.ReactElement {
  const now = useTickingNow(props.now);
  if (!props.dataFresh) {
    return (
      <p className="freshness-bar freshness-bar--stale" role="status">
        數據好耐冇更新，小心舊盤
      </p>
    );
  }
  const synced = Date.parse(props.generatedAt ?? "");
  if (Number.isNaN(synced)) {
    return <p className="freshness-bar" role="status">未有成功同步</p>;
  }
  const minutes = Math.max(0, Math.round((now - synced) / 60000));
  return (
    <p className="freshness-bar" role="status">
      {minutes === 0 ? "賠率啱啱更新" : `賠率更新於 ${minutes} 分鐘前`}
    </p>
  );
}
