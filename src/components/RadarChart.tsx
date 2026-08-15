/** Radar chart (B4.3): per-market hit-rate polygon, axes follow READINESS_MODELS. */

export type RadarAxis = {
  label: string;
  /** 0–100 */
  value: number;
};

function polarPoint(index: number, total: number, ratio: number, size: number): [number, number] {
  const angle = (Math.PI * 2 * index) / total - Math.PI / 2;
  const radius = (size / 2 - 10) * ratio;
  const center = size / 2;
  return [center + radius * Math.cos(angle), center + radius * Math.sin(angle)];
}

function polygonPoints(total: number, ratio: number, size: number): string {
  return Array.from({ length: total }, (_, i) => polarPoint(i, total, ratio, size).join(",")).join(" ");
}

export function RadarChart(props: { axes: RadarAxis[]; size?: number }): React.ReactElement {
  const size = props.size ?? 200;
  const axes = props.axes;
  if (axes.length < 3) {
    return <p className="muted">需要至少三個玩法先有雷達圖</p>;
  }
  const total = axes.length;
  const dataPoints = axes
    .map((axis, i) => polarPoint(i, total, Math.max(0.05, axis.value / 100), size).join(","))
    .join(" ");

  return (
    <svg
      className="radar-chart"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="各玩法中率雷達圖"
    >
      {[1, 0.66, 0.33].map((ratio) => (
        <polygon
          key={ratio}
          className="radar-chart__grid"
          points={polygonPoints(total, ratio, size)}
        />
      ))}
      {axes.map((_, i) => {
        const [x, y] = polarPoint(i, total, 1, size);
        return (
          <line
            key={i}
            className="radar-chart__axis"
            x1={size / 2}
            y1={size / 2}
            x2={x}
            y2={y}
          />
        );
      })}
      <polygon className="radar-chart__data" points={dataPoints} />
      {axes.map((axis, i) => {
        const [x, y] = polarPoint(i, total, 1.16, size);
        return (
          <text
            key={axis.label}
            className="radar-chart__label"
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {axis.label}
          </text>
        );
      })}
    </svg>
  );
}
