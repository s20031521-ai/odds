/** Per-bet profit / ROI / yield maths for the 注單管理 table (B3.3). */

export type BetSettlement =
  | "win"
  | "half-win"
  | "push"
  | "half-loss"
  | "loss"
  | "pending"
  | string;

/** Profit in stake units; null while pending / unknown. */
export function betProfit(
  settlement: BetSettlement,
  stake: number,
  odds: number,
): number | null {
  if (!Number.isFinite(stake) || !Number.isFinite(odds) || stake <= 0) return null;
  switch (settlement) {
    case "win":
      return stake * (odds - 1);
    case "half-win":
      return (stake * (odds - 1)) / 2;
    case "push":
      return 0;
    case "half-loss":
      return -stake / 2;
    case "loss":
      return -stake;
    default:
      return null;
  }
}

/** ROI = profit / stake. Same per-bet figure doubles as yield (profit / turnover). */
export function betRoi(
  settlement: BetSettlement,
  stake: number,
  odds: number,
): number | null {
  const profit = betProfit(settlement, stake, odds);
  if (profit === null) return null;
  return profit / stake;
}

/** e.g. 0.85 → "+85.0%", -1 → "-100%"; null → "--". */
export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  const percent = value * 100;
  const rounded = Math.round(percent * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`;
}

/** Short ticket-style id: "#" + first 6 chars uppercased. */
export function formatBetRef(id: string): string {
  const clean = id.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return `#${clean.slice(0, 6) || "——————"}`;
}

/** Filter buckets for the status dropdown. */
export type BetStatusFilter = "all" | "win" | "loss" | "push" | "pending";

export function betMatchesStatus(settlement: string, filter: BetStatusFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "win":
      return settlement === "win" || settlement === "half-win";
    case "loss":
      return settlement === "loss" || settlement === "half-loss";
    case "push":
      return settlement === "push";
    case "pending":
      return settlement === "pending";
    default:
      return true;
  }
}

/** Quick date filters (今天 / 昨天 / 本週) against commence_time (falls back to created_at). */
export type BetDateFilter = "all" | "today" | "yesterday" | "week";

export function betMatchesDate(
  bet: { commence_time: string | null; created_at?: string },
  filter: BetDateFilter,
  now: number = Date.now(),
): boolean {
  if (filter === "all") return true;
  const raw = bet.commence_time ?? bet.created_at ?? null;
  const time = raw ? Date.parse(raw) : NaN;
  if (!Number.isFinite(time)) return false;
  const startOfDay = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const todayStart = startOfDay(now);
  const betStart = startOfDay(time);
  if (filter === "today") return betStart === todayStart;
  if (filter === "yesterday") return betStart === todayStart - 86_400_000;
  // week: last 7 days including today
  return betStart >= todayStart - 6 * 86_400_000 && betStart <= todayStart;
}
