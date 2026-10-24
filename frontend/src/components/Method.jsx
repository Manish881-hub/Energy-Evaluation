import { fmtDateTime } from "../api.js";
import { ArrowIcon, CheckIcon, InfoIcon } from "./Icons.jsx";

const steps = [
  {
    n: "01",
    title: "Select the as-of forecast",
    body: "For a delivery day D, take the latest WINDFOR publishTime at or before the D-1 cutoff. Never use a later vintage, even if it is more accurate.",
  },
  {
    n: "02",
    title: "Align the clocks",
    body: "WINDFOR is hourly. Apply each hour to both half-hourly settlement periods in that hour, then join to FUELHH WIND actuals in Europe/London.",
  },
  {
    n: "03",
    title: "Score the gap",
    body: "Error is forecast minus actual. Positive means over-forecast, so the desk is short relative to plan. Summarise MAE, RMSE, bias, WAPE and P90.",
  },
  {
    n: "04",
    title: "Size the cover",
    body: "At each delivery hour, take the central forecast as the available wind and the P10/P90 band as the outcome range. Residual is demand minus wind, floored at zero.",
  },
];

const metrics = [
  ["MAE", "Mean absolute error", "Average miss in MW, ignoring direction."],
  ["RMSE", "Root mean squared error", "Same units as MW, but penalises large misses more."],
  ["Bias", "Mean signed error", "Forecast minus actual. Positive = over-forecast / shortfall risk."],
  ["WAPE", "Weighted absolute percentage error", "Total absolute error ÷ total actual wind. Robust when wind is near zero."],
  ["P90 abs", "90th percentile absolute error", "A bad-but-not-worst half-hour. Used for cover sizing."],
  ["P90 signed", "90th percentile signed error", "Upper tail of the error distribution, in the shortfall direction."],
];

export default function Method({ meta }) {
  return (
    <div className="page method-page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Method</span>
          <h2>What the numbers mean, and what they do not.</h2>
          <p>
            Windline is deliberately small: two Elexon datasets, one as-of rule, one decision. The
            value is in making the forecast's <b>timing</b> and <b>miss</b> explicit before a trade
            is sized.
          </p>
        </div>
      </div>

      <div className="method-grid">
        <section className="card method-flow">
          <div className="card-head">
            <div>
              <h3>The decision loop</h3>
              <p className="card-sub">Four steps, repeated for every delivery day.</p>
            </div>
          </div>
          <ol className="flow-list">
            {steps.map((step) => (
              <li key={step.n}>
                <span className="flow-n">{step.n}</span>
                <div>
                  <h4>{step.title}</h4>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h3>Data in scope</h3>
              <p className="card-sub">A reproducible January 2026 snapshot.</p>
            </div>
          </div>
          <div className="source-list">
            <div className="source-row">
              <div>
                <b>WINDFOR</b>
                <p>Hourly wind generation forecast, 0–48h ahead, every vintage retained.</p>
              </div>
              <span className="badge">forecast</span>
            </div>
            <div className="source-row">
              <div>
                <b>FUELHH</b>
                <p>Half-hourly actual generation by fuel type. Filtered to WIND.</p>
              </div>
              <span className="badge">actual</span>
            </div>
          </div>
          <div className="fact-grid">
            <div>
              <span>Half-hours scored</span>
              <b>{meta.counts.actual_half_hours.toLocaleString("en-GB")}</b>
            </div>
            <div>
              <span>Forecast hours</span>
              <b>{meta.counts.forecast_hours.toLocaleString("en-GB")}</b>
            </div>
            <div>
              <span>Forecast rows</span>
              <b>{meta.counts.forecast_rows.toLocaleString("en-GB")}</b>
            </div>
            <div>
              <span>Publish vintages</span>
              <b>{meta.counts.publish_vintages.toLocaleString("en-GB")}</b>
            </div>
          </div>
          <p className="muted small">
            Snapshot fetched {fmtDateTime(meta.meta?.fetched_at)}. Full provenance is in{" "}
            <code>backend/data/meta.json</code>. Both datasets are public and resettable with{" "}
            <code>scripts/ingest.py</code>.
          </p>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <div>
            <h3>Forecast selection: no hindsight</h3>
            <p className="card-sub">The one rule that makes the evaluation honest.</p>
          </div>
          <span className="badge">as-of {meta.cutoff_default} UK</span>
        </div>
        <p>
          A forecast published at 10:00 is not available for a 09:00 decision, even if it predicts
          the day better. For each delivery day we take the latest vintage with{" "}
          <code>publishTime ≤ D-1 {meta.cutoff_default}</code> Europe/London, then score only the
          delivery periods covered by that vintage. The selected vintage is printed on every
          decision and exported with every row.
        </p>
        <p className="muted small">
          The cutoff is adjustable in the header. Changing it re-selects the vintage for every day;
          it does not change the underlying data. WINDFOR is hourly, so both settlement periods in
          the hour receive the same forecast value.
        </p>
      </section>

      <div className="split-grid">
        <section className="card">
          <div className="card-head">
            <div>
              <h3>How we score</h3>
              <p className="card-sub">Sign convention: forecast minus actual.</p>
            </div>
          </div>
          <div className="table-wrap">
            <table className="metric-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Definition</th>
                  <th>Use</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map(([name, definition, use]) => (
                  <tr key={name}>
                    <td><b>{name}</b></td>
                    <td>{definition}</td>
                    <td className="muted">{use}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h3>Uncertainty band</h3>
              <p className="card-sub">Empirical, signed, and deliberately wide.</p>
            </div>
          </div>
          <p>
            The band is built from the <b>P10 and P90 of the signed error</b>, not from a normal
            distribution and not from the raw forecast. That makes it asymmetric: in this snapshot
            the forecast runs high, so the useful edge for a buyer is the low wind outcome.
          </p>
          <div className="formula">
            <span>low</span> = forecast + P10(error)
            <br />
            <span>high</span> = forecast + P90(error)
          </div>
          <p className="muted small">
            The band is measured on the same month it describes (in-sample). It is a pilot estimate,
            not a validated production calibration. A production build would fit on a rolling
            out-of-sample window and re-calibrate as vintages arrive.
          </p>
        </section>
      </div>

      <section className="card scope-card">
        <div className="scope-icon"><InfoIcon width={20} height={20} /></div>
        <div>
          <h3>Why the raw bias is not "just a bad forecast"</h3>
          <p>
            WINDFOR forecasts wind farms visible to the ESO. FUELHH measures metered
            transmission-connected output. The gap includes forecast skill, unconstrained vs
            delivered wind, curtailment and timing. With these two datasets alone we cannot
            decompose it. Windline therefore treats the gap as the <b>combined planning risk</b>,
            and says so in the product rather than hiding it inside a correction factor.
          </p>
          <div className="scope-next">
            <div><CheckIcon width={16} height={16} /> Add curtailment and embedded-wind data</div>
            <div><CheckIcon width={16} height={16} /> Calibrate out-of-sample</div>
            <div><CheckIcon width={16} height={16} /> Add demand and price forecasts</div>
            <div><CheckIcon width={16} height={16} /> Connect to trade execution</div>
          </div>
        </div>
      </section>

      <div className="method-grid">
        <section className="card">
          <div className="card-head">
            <div>
              <h3>Engineering</h3>
              <p className="card-sub">A small, inspectable stack.</p>
            </div>
          </div>
          <ul className="plain-list">
            <li><b>React + Vite</b> front end, no chart wrapper library beyond Recharts.</li>
            <li><b>FastAPI</b> analysis API; the statistics live in a pure Python module.</li>
            <li><b>Snapshot CSVs</b> committed for deterministic tests and offline demos.</li>
            <li><b>Pytest</b> covers selection, half-hour alignment, metrics and API contracts.</li>
            <li><b>Docker</b> serves the built SPA and API from one container.</li>
            <li><b>Vercel</b> config keeps the Python function and static build together.</li>
          </ul>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h3>AI disclosure</h3>
              <p className="card-sub">What was assisted, and what was checked.</p>
            </div>
          </div>
          <p>
            This build was produced with <b>opencode</b> running <b>DeepSeek V4.1 Flash</b>, using
            Matt Pocock's engineering skills for TDD, codebase design and review. The assistant
            wrote code and tests; the human set the product brief, chose the decision rule (09:00
            D-1), rejected a bias-correction shortcut, and reviewed the domain caveats.
          </p>
          <p className="muted small">
            All metrics in the app are computed from the committed snapshot by the Python analysis
            module. No number is hand-entered into the UI. The tests and the reproducible ingest
            script are the audit trail.
          </p>
        </section>
      </div>

      <section className="card reproduce">
        <div className="card-head">
          <div>
            <h3>Reproduce locally</h3>
            <p className="card-sub">Two processes, or one container.</p>
          </div>
          <a className="button ghost" href="https://github.com/Manish881-hub/Energy-Evaluation" target="_blank" rel="noreferrer">
            Repository <ArrowIcon width={16} height={16} />
          </a>
        </div>
        <pre><code>{`cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8010

cd ../frontend
npm ci
npm run dev`}</code></pre>
        <p className="muted small">
          Docker: <code>docker compose up --build</code>. Tests:{" "}
          <code>cd backend && python3 -m pytest -q</code>. Ingest:{" "}
          <code>python3 scripts/ingest.py --start 2026-01-01 --end 2026-01-31</code>.
        </p>
      </section>
    </div>
  );
}
