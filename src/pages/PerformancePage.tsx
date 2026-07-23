import { Mascot } from "../components/Kawaii";

const READINESS_TARGET = 30;

type ModelReadiness = {
  market: string;
  modelVersion: string;
  settledMatches: number;
  pendingMatches: number;
};

type HistoryStats = {
  win: number;
  loss: number;
  push: number;
  winPercent: number;
  lossPercent: number;
};

export function PerformancePage(props: {
  readiness: ModelReadiness[];
  historyStats: Map<string, HistoryStats>;
}): React.ReactElement {
  const markets = [
    { key: "totals", label: "大細波", modelVersion: "totals-loo-v1" },
    { key: "corners", label: "角球", modelVersion: "corner-loo-v1" },
    { key: "handicap", label: "讓球", modelVersion: "hdc-loo-v2" },
    { key: "h2h", label: "主客和", modelVersion: "consensus-v1" },
  ];

  return (
    <section className="performance-page" aria-labelledby="performance-title">
      <h1 id="performance-title" className="page-heading">模型表現</h1>
      <div className="performance-grid">
        {markets.map(({ key, label, modelVersion }) => {
          const readiness = props.readiness.find(
            (r) => r.market === key && r.modelVersion === modelVersion
          );
          const stats = props.historyStats.get(key);
          const settled = readiness?.settledMatches ?? 0;
          const percent = Math.min(100, Math.round((settled / READINESS_TARGET) * 100));
          const hasStats = stats !== undefined && (stats.win + stats.loss) > 0;

          return (
            <article className="performance-card" key={key}>
              <div className="performance-card__head">
                <h2>{label}</h2>
                <span className="performance-card__count">
                  {settled}/{READINESS_TARGET} 場
                </span>
              </div>
              <div className="performance-card__bar" aria-hidden="true">
                <span style={{ width: `${percent}%` }} />
              </div>
              {hasStats ? (
                <p className="performance-card__accuracy">
                  <span className="positive">中 {stats.winPercent.toFixed(1)}%</span>
                  {" · "}
                  <span className="negative">錯 {stats.lossPercent.toFixed(1)}%</span>
                  {stats.push > 0 ? (
                    <small> · 走盤 {stats.push}</small>
                  ) : null}
                </p>
              ) : (
                <p className="performance-card__accuracy muted">
                  {settled === 0 ? "尚未有數據" : "樣本不足"}
                </p>
              )}
            </article>
          );
        })}
      </div>
      <Mascot pose="chiikawa-empty" />
    </section>
  );
}
