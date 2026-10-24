import { fmtMW } from "../api.js";

function formatValue(value, name) {
  if (Array.isArray(value)) return `${fmtMW(value[0])} – ${fmtMW(value[1])}`;
  if (typeof value === "number" && name && /MAE|RMSE|Bias|MW/i.test(name)) return fmtMW(value);
  return value;
}

export default function ChartTooltip({ active, payload, label, labelFormatter, valueFormatter }) {
  if (!active || !payload || !payload.length) return null;
  const shown = payload.filter((entry) => entry.value !== null && entry.value !== undefined);
  if (!shown.length) return null;
  return (
    <div className="chart-tip">
      <div className="chart-tip-label">{labelFormatter ? labelFormatter(label, payload) : label}</div>
      {shown.map((entry) => {
        const value = valueFormatter ? valueFormatter(entry.value, entry.name, entry) : formatValue(entry.value, entry.name);
        return (
          <div className="chart-tip-row" key={`${entry.dataKey}-${entry.name}`}>
            <span className="chart-tip-swatch" style={{ background: entry.color || entry.stroke }} />
            <span className="chart-tip-name">{entry.name}</span>
            <span className="chart-tip-value">{value}</span>
          </div>
        );
      })}
    </div>
  );
}
