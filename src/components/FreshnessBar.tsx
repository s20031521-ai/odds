export function FreshnessBar(props: {
  generatedAt: string | null;
  dataFresh: boolean;
  now: number;
}): React.ReactElement {
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
  const minutes = Math.max(0, Math.round((props.now - synced) / 60000));
  return (
    <p className="freshness-bar" role="status">
      {minutes === 0 ? "賠率啱啱更新" : `賠率更新於 ${minutes} 分鐘前`}
    </p>
  );
}
