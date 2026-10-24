export default function Kpi({ label, value, hint, tone = "default", icon = null }) {
  return (
    <div className={`kpi kpi-${tone}`}>
      <div className="kpi-label">
        {icon && <span className="kpi-icon">{icon}</span>}
        {label}
      </div>
      <div className="kpi-value">{value}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </div>
  );
}
