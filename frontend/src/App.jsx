import { useEffect, useState } from "react";
import { fmtDate, fmtDateTime } from "./api.js";
import { useApi, useUrlState } from "./hooks.js";
import DecisionDesk from "./components/DecisionDesk.jsx";
import ForecastQuality from "./components/ForecastQuality.jsx";
import Method from "./components/Method.jsx";
import { ErrorState, LoadingState } from "./components/Status.jsx";
import Logo from "./components/Logo.jsx";
import { BookIcon, ChartIcon, GaugeIcon, WindIcon } from "./components/Icons.jsx";

const TABS = [
  { id: "desk", label: "Decision desk", icon: GaugeIcon },
  { id: "quality", label: "Forecast quality", icon: ChartIcon },
  { id: "method", label: "Method", icon: BookIcon },
];

export default function App() {
  const metaState = useApi("meta", {});
  const meta = metaState.data;
  const [tab, setTab] = useUrlState("view", "desk");
  const [cutoff, setCutoff] = useUrlState("cutoff", "");
  const [day, setDay] = useUrlState("day", "");
  const [demand, setDemand] = useUrlState("demand", "35000");
  const [showActual, setShowActual] = useState(false);
  const activeTab = TABS.some((item) => item.id === tab) ? tab : "desk";

  useEffect(() => {
    if (!meta) return;
    if (!day || day < meta.first_day || day > meta.last_day) setDay(meta.default_day);
    if (!cutoff) setCutoff(meta.cutoff_default);
  }, [meta, day, cutoff, setDay, setCutoff]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [activeTab, day]);

  const demandValue = Math.max(0, Number(demand) || 0);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <Logo />
            <div className="brand-text">
              <strong>Windline</strong>
              <span>Day-ahead wind decision desk</span>
            </div>
          </div>
          <div className="topbar-right">
            <span className="pill">
              <WindIcon width={15} height={15} /> GB national wind
            </span>
            <span className="pill subtle">Elexon BMRS · WINDFOR + FUELHH</span>
          </div>
        </div>
      </header>

      <div className="subbar">
        <div className="subbar-inner">
          <nav className="tabs" aria-label="Sections">
            {TABS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={activeTab === item.id ? "tab on" : "tab"}
                  onClick={() => setTab(item.id)}
                  aria-current={activeTab === item.id ? "page" : undefined}
                >
                  <Icon width={17} height={17} />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className="subbar-right">
            <span className="window-pill">January 2026 delivery</span>
            <label className="cutoff-control">
              <span>D-1 cutoff</span>
              <input
                type="time"
                value={cutoff || "09:00"}
                step="900"
                onChange={(event) => event.target.value && setCutoff(event.target.value)}
                aria-label="Decision cutoff on the previous day, UK time"
              />
              <span className="unit">UK</span>
            </label>
          </div>
        </div>
      </div>

      <main className="main">
        {metaState.error && (
          <ErrorState error={metaState.error} onRetry={metaState.reload} />
        )}
        {metaState.loading && !meta && <LoadingState label="Loading the January 2026 snapshot" />}
        {meta && activeTab === "desk" && (
          <DecisionDesk
            meta={meta}
            day={day || meta.default_day}
            setDay={setDay}
            cutoff={cutoff || meta.cutoff_default}
            demand={demandValue}
            setDemand={setDemand}
            showActual={showActual}
            setShowActual={setShowActual}
            onOpenQuality={() => setTab("quality")}
          />
        )}
        {meta && activeTab === "quality" && (
          <ForecastQuality
            cutoff={cutoff || meta.cutoff_default}
            onOpenDay={(nextDay) => {
              if (nextDay) setDay(nextDay);
              setTab("desk");
            }}
          />
        )}
        {meta && activeTab === "method" && <Method meta={meta} />}
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <Logo size={24} />
            <span>
              <b>Windline</b> · pilot build
            </span>
          </div>
          <div>
            Snapshot {fmtDateTime(meta?.meta?.fetched_at)}. Data: Elexon Insights. Decision support
            only, not investment advice.
          </div>
          <div className="footer-links">
            <a href="https://github.com/Manish881-hub/Energy-Evaluation" target="_blank" rel="noreferrer">
              GitHub
            </a>
            <span aria-hidden="true">·</span>
            <button type="button" className="link-button" onClick={() => setTab("method")}>
              Method
            </button>
            <span aria-hidden="true">·</span>
            <span>{meta ? `${fmtDate(meta.first_day)} to ${fmtDate(meta.last_day)}` : ""}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
