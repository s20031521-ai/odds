import { Mascot } from "./Kawaii";

export type EmptyReason = "stale" | "no-fixtures" | "no-value";

export function EmptyState(props: { reason: EmptyReason; fixtureCount?: number }): React.ReactElement {
  if (props.reason === "stale") {
    return (
      <div className="today-empty" role="status">
        <Mascot pose="momonga-alert" />
        <p>數據舊咗，唔好住落注 — 更新緊</p>
      </div>
    );
  }
  if (props.reason === "no-fixtures") {
    return (
      <div className="today-empty" role="status">
        <Mascot pose="chiikawa-empty" />
        <p>今日冇波睇，聽日先嚟過</p>
      </div>
    );
  }
  return (
    <div className="today-empty" role="status">
      <Mascot pose="chiikawa-empty" />
      <p>今日 {props.fixtureCount ?? 0} 場波，但冇盤值博 — 慳返啖</p>
    </div>
  );
}
