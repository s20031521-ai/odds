import { useState } from "react";
import type { BuyOpportunity } from "../buyOpportunities";
import {
  readDashboardMode,
  writeDashboardMode,
  type DashboardMode,
  type StorageLike,
} from "../dashboardMode";
import { BuyDashboard } from "./BuyDashboard";
import { SimpleDashboard } from "./SimpleDashboard";

const MODE_ORDER = ["simple", "pro"] as const;
const MODE_LABELS: Record<DashboardMode, string> = { simple: "極簡", pro: "專業" };

export function DashboardPage(props: {
  opportunities: BuyOpportunity[];
  generatedAt: string | null;
  dataFresh: boolean;
  storage?: StorageLike;
}): React.ReactElement {
  const [mode, setMode] = useState<DashboardMode>(() => readDashboardMode(props.storage));

  function selectMode(next: DashboardMode): void {
    setMode(next);
    writeDashboardMode(next, props.storage);
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-mode-bar" role="group" aria-label="顯示模式">
        {MODE_ORDER.map((value) => (
          <button
            aria-pressed={mode === value}
            key={value}
            onClick={() => selectMode(value)}
            type="button"
          >
            {MODE_LABELS[value]}
          </button>
        ))}
      </div>
      {mode === "pro" ? (
        <BuyDashboard opportunities={props.opportunities} generatedAt={props.generatedAt} dataFresh={props.dataFresh} />
      ) : (
        <SimpleDashboard opportunities={props.opportunities} generatedAt={props.generatedAt} dataFresh={props.dataFresh} />
      )}
    </div>
  );
}
