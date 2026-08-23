import { AlertTriangle, CalendarX2 } from "lucide-react";

export type EmptyReason = "stale" | "no-fixtures" | "no-value";

export function EmptyState(props: { reason: EmptyReason; fixtureCount?: number; comparableFixtureCount?: number }): React.ReactElement {
  if (props.reason === "stale") {
    return (
      <div className="today-empty" role="status">
        <AlertTriangle size={28} aria-hidden="true" />
        <p>數據舊咗，唔好住落注 — 更新緊</p>
      </div>
    );
  }
  if (props.reason === "no-fixtures") {
    return (
      <div className="today-empty" role="status">
        <CalendarX2 size={28} aria-hidden="true" />
        <p>今日冇波睇，聽日先嚟過</p>
      </div>
    );
  }
  return (
    <div className="today-empty" role="status">
      <CalendarX2 size={28} aria-hidden="true" />
      <p>今日 {props.fixtureCount ?? 0} 場波｜{props.comparableFixtureCount ?? 0} 場已有多莊家比較｜暫時 0 個達 3% 推薦門檻</p>
    </div>
  );
}
