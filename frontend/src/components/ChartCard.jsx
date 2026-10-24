export default function ChartCard({ title, subtitle, actions, children, className = "" }) {
  return (
    <section className={`card chart-card ${className}`.trim()}>
      <div className="card-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p className="card-sub">{subtitle}</p>}
        </div>
        {actions && <div className="card-actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
