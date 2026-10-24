import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtDate, fmtDateTime, fmtGW, fmtMW, fmtPct, fmtShortDate, fmtSignedMW } from "../api.js";
import { useApi } from "../hooks.js";
import ChartCard from "./ChartCard.jsx";
import ChartTooltip from "./ChartTooltip.jsx";
import Kpi from "./Kpi.jsx";
import Status from "./Status.jsx";
import { AlertIcon, ArrowIcon, DownloadIcon, InfoIcon } from "./Icons.jsx";

const COLORS = {
  wind: "#0f766e",
  actual: "#334155",
  blue: "#2563eb",
  amber: "#d97706",
  amberSoft: "#fde68a",
  slate: "#94a3b8",
  grid: "#e2e8f0",
  axis: "#64748b",
};

const axis = { fontSize: 11, fill: COLORS.axis };
const grid = { stroke: COLORS.grid, strokeDasharray: "3 3", vertical: false };

export default function ForecastQuality({ cutoff, onOpenDay }) {
  const state = useApi("accuracy", { cutoff });
  const data = state.data;
  const summary = data?.summary;
  const insights = data?.insights;
  const quantiles = data?.error_quantiles;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Forecast quality</span>
          <h2>How wrong was the forecast?</h2>
          <p>
            Every half-hour in January 2026, measured against the WINDFOR vintage the desk actually
            had at the <b>{cutoff}</b> D-1 cutoff. No hindsight, no revisions.
          </p>
        </div>
        <div className="page-head-actions">
          <a className="button ghost" href={`/api/export.csv?cutoff=${cutoff}`} download>
            <DownloadIcon width={17} height={17} /> Half-hourly CSV
          </a>
          <button className="button" type="button" onClick={() => onOpenDay(data?.insights?.worst_day?.date)} disabled={!data?.insights?.worst_day?.date}>
            Open worst day <ArrowIcon width={17} height={17} />
          </button>
        </div>
      </div>

      <Status state={state} />

      {data && summary.n > 0 && (
        <>
          <div className="snapshot-strip">
            <span className="live-dot" aria-hidden="true" />
            <span>
              <b>{summary.n.toLocaleString("en-GB")} settlement periods</b> across{" "}
              {data.by_day.length} delivery days. Each pair uses the latest forecast published before{" "}
              {cutoff} on the previous day. Lead times: {data.horizon_min_h?.toFixed(1)}–
              {data.horizon_max_h?.toFixed(1)} hours.
            </span>
            <span className="snapshot-tag">January 2026</span>
          </div>

          <div className="kpi-grid">
            <Kpi
              tone="teal"
              label="MAE"
              value={fmtMW(summary.mae_mw)}
              hint="Average absolute miss"
            />
            <Kpi label="RMSE" value={fmtMW(summary.rmse_mw)} hint="Penalises large misses" />
            <Kpi
              tone={summary.bias_mw > 0 ? "amber" : "teal"}
              label="Bias"
              value={fmtSignedMW(summary.bias_mw)}
              hint={`${summary.bias_mw > 0 ? "Over-forecast" : "Under-forecast"} by ${fmtPct(Math.abs(summary.bias_pct_of_actual))} of actual wind`}
            />
            <Kpi label="WAPE" value={fmtPct(summary.wape_pct)} hint="Total absolute error ÷ total wind" />
            <Kpi label="P90 absolute miss" value={fmtMW(summary.p90_abs_mw)} hint={`Worst ${fmtMW(summary.max_abs_mw)}`} />
            <Kpi
              tone="amber"
              label="Over-forecast"
              value={fmtPct(summary.over_forecast_pct, 0)}
              hint="Of all half-hours"
            />
          </div>

          <section className="insight-card card">
            <div className="insight-mark"><AlertIcon width={22} height={22} /></div>
            <div className="insight-body">
              <span className="eyebrow">What this means for buying</span>
              <h3>The forecast is useful, but the miss is not symmetric.</h3>
              <div className="insight-columns">
                <ul>
                  <li>
                    Forecasts ran <b>{fmtGW(Math.abs(summary.bias_mw))}</b>{" "}
                    {summary.bias_mw > 0 ? "high" : "low"} on average, or{" "}
                    <b>{fmtPct(Math.abs(summary.bias_pct_of_actual))}</b> of actual wind.
                  </li>
                  <li>
                    At high wind (forecast ≥ 15 GW), bias is{" "}
                    <b>{fmtSignedMW(insights.high_wind_bias_mw)}</b> across{" "}
                    {insights.high_wind_n.toLocaleString("en-GB")} half-hours. Below 9 GW it is{" "}
                    <b>{fmtSignedMW(insights.low_wind_bias_mw)}</b>.
                  </li>
                  <li>
                    The worst delivery day was <b>{fmtDate(insights.worst_day?.date)}</b> with a{" "}
                    <b>{fmtMW(insights.worst_day?.mae_mw)}</b> MAE.
                  </li>
                </ul>
                <ul>
                  <li>
                    Plan to the <b>low end of the 80% band</b>, not the point forecast. The P90
                    shortfall is <b>{fmtMW(insights.p90_shortfall_mw)}</b>.
                  </li>
                  <li>
                    This gap combines forecast skill with scope and curtailment. WINDFOR covers wind
                    farms visible to the ESO; FUELHH is metered transmission output.
                  </li>
                  <li>
                    The band is deliberately the <b>combined risk a buyer must hold</b>, not a pure
                    meteorological error estimate.
                  </li>
                </ul>
              </div>
            </div>
          </section>

          <ChartCard
            title="Forecast versus actual, January 2026"
            subtitle="Each point is the as-of forecast and the settled FUELHH WIND outturn for the same settlement period."
            actions={<span className="badge">half-hourly</span>}
          >
            <div className="chart-wrap" role="img" aria-label="Month-long forecast and actual wind chart">
              <ResponsiveContainer width="100%" height={330}>
                <LineChart data={data.series} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid {...grid} />
                  <XAxis
                    dataKey="t"
                    minTickGap={48}
                    tick={axis}
                    tickLine={false}
                    axisLine={{ stroke: COLORS.grid }}
                    tickFormatter={fmtShortDate}
                  />
                  <YAxis
                    tickFormatter={(value) => `${value / 1000} GW`}
                    tick={axis}
                    tickLine={false}
                    axisLine={false}
                    width={58}
                  />
                  <Tooltip
                    content={
                      <ChartTooltip
                        labelFormatter={fmtDateTime}
                        valueFormatter={(value) => fmtMW(value)}
                      />
                    }
                  />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="plainline" />
                  <Line
                    dataKey="actual_mw"
                    name="Actual wind"
                    stroke={COLORS.actual}
                    strokeWidth={1.4}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    dataKey="forecast_mw"
                    name="Forecast at cutoff"
                    stroke={COLORS.wind}
                    strokeWidth={1.7}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <div className="chart-grid">
            <ChartCard
              title="Error distribution"
              subtitle="Forecast minus actual. Right of zero means wind came in below plan."
            >
              <div className="chart-wrap" role="img" aria-label="Histogram of forecast errors">
                <ResponsiveContainer width="100%" height={270}>
                  <BarChart data={data.histogram} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid {...grid} />
                    <XAxis
                      dataKey="mid_mw"
                      type="number"
                      domain={["dataMin", "dataMax"]}
                      tick={axis}
                      tickLine={false}
                      axisLine={{ stroke: COLORS.grid }}
                      tickFormatter={(value) => `${value / 1000} GW`}
                    />
                    <YAxis tick={axis} tickLine={false} axisLine={false} width={40} />
                    <Tooltip
                      content={
                        <ChartTooltip
                          labelFormatter={(_, payload) => {
                            const bin = payload?.[0]?.payload;
                            return bin ? `${fmtSignedMW(bin.from_mw)} to ${fmtSignedMW(bin.to_mw)}` : "";
                          }}
                          valueFormatter={(value) => `${value} half-hours`}
                        />
                      }
                    />
                    <ReferenceLine x={0} stroke={COLORS.slate} strokeDasharray="4 4" />
                    <Bar dataKey="count" name="Half-hours" isAnimationActive={false} radius={[3, 3, 0, 0]}>
                      {data.histogram.map((bin) => (
                        <Cell key={bin.from_mw} fill={bin.mid_mw >= 0 ? COLORS.amber : COLORS.wind} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <ChartCard
              title="Daily error"
              subtitle="MAE bars and signed bias line. The worst days cluster in high-wind periods."
            >
              <div className="chart-wrap" role="img" aria-label="Daily mean absolute error and bias">
                <ResponsiveContainer width="100%" height={270}>
                  <ComposedChart data={data.by_day} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid {...grid} />
                    <XAxis
                      dataKey="date"
                      tick={axis}
                      tickLine={false}
                      axisLine={{ stroke: COLORS.grid }}
                      tickFormatter={(value) => value.slice(8)}
                      minTickGap={16}
                    />
                    <YAxis
                      tickFormatter={(value) => `${value / 1000} GW`}
                      tick={axis}
                      tickLine={false}
                      axisLine={false}
                      width={52}
                    />
                    <Tooltip
                      content={
                        <ChartTooltip
                          labelFormatter={(value) => fmtDate(value)}
                          valueFormatter={(value) => fmtMW(value)}
                        />
                      }
                    />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                    <ReferenceLine y={0} stroke={COLORS.slate} />
                    <Bar dataKey="mae_mw" name="MAE" fill={COLORS.amber} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                    <Line
                      dataKey="bias_mw"
                      name="Bias"
                      stroke={COLORS.blue}
                      strokeWidth={1.8}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <ChartCard
              title="Error by hour of day"
              subtitle="UK local time. Morning and evening peaks carry different forecast risk."
            >
              <div className="chart-wrap" role="img" aria-label="Mean absolute error by hour of day">
                <ResponsiveContainer width="100%" height={270}>
                  <ComposedChart data={data.by_hour} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid {...grid} />
                    <XAxis
                      dataKey="hour"
                      tick={axis}
                      tickLine={false}
                      axisLine={{ stroke: COLORS.grid }}
                      tickFormatter={(value) => `${String(value).padStart(2, "0")}:00`}
                      minTickGap={28}
                    />
                    <YAxis
                      tickFormatter={(value) => `${value / 1000} GW`}
                      tick={axis}
                      tickLine={false}
                      axisLine={false}
                      width={52}
                    />
                    <Tooltip
                      content={
                        <ChartTooltip
                          labelFormatter={(value) => `${String(value).padStart(2, "0")}:00 UK`}
                          valueFormatter={(value) => fmtMW(value)}
                        />
                      }
                    />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                    <ReferenceLine y={0} stroke={COLORS.slate} />
                    <Bar dataKey="mae_mw" name="MAE" fill={COLORS.wind} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                    <Line
                      dataKey="bias_mw"
                      name="Bias"
                      stroke={COLORS.amber}
                      strokeWidth={1.8}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <ChartCard
              title="Error by forecast wind level"
              subtitle="Bias scales with wind. High-wind hours are where the procurement risk sits."
            >
              <div className="chart-wrap" role="img" aria-label="Mean absolute error by forecast wind level">
                <ResponsiveContainer width="100%" height={270}>
                  <ComposedChart data={data.by_level} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid {...grid} />
                    <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: COLORS.grid }} />
                    <YAxis
                      tickFormatter={(value) => `${value / 1000} GW`}
                      tick={axis}
                      tickLine={false}
                      axisLine={false}
                      width={52}
                    />
                    <Tooltip
                      content={
                        <ChartTooltip
                          labelFormatter={(value) => `Forecast ${value}`}
                          valueFormatter={(value) => fmtMW(value)}
                        />
                      }
                    />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                    <ReferenceLine y={0} stroke={COLORS.slate} />
                    <Bar dataKey="mae_mw" name="MAE" fill={COLORS.wind} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                    <Line
                      dataKey="bias_mw"
                      name="Bias"
                      stroke={COLORS.amber}
                      strokeWidth={1.8}
                      dot={{ r: 2.5 }}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          </div>

          <ChartCard
            title="Accuracy by forecast horizon"
            subtitle="All WINDFOR vintages, hourly averages. Shaded range is the lead time of the vintage used at the cutoff."
          >
            <div className="chart-wrap" role="img" aria-label="Forecast error by lead time">
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={data.by_horizon} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid {...grid} />
                  <XAxis
                    dataKey="horizon_h"
                    tick={axis}
                    tickLine={false}
                    axisLine={{ stroke: COLORS.grid }}
                    tickFormatter={(value) => `${value}h`}
                    minTickGap={30}
                  />
                  <YAxis
                    tickFormatter={(value) => `${value / 1000} GW`}
                    tick={axis}
                    tickLine={false}
                    axisLine={false}
                    width={52}
                  />
                  <Tooltip
                    content={
                      <ChartTooltip
                        labelFormatter={(value) => `${value} hours ahead`}
                        valueFormatter={(value) => fmtMW(value)}
                      />
                    }
                  />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  <ReferenceArea x1={16} x2={40} fill="#ccfbf1" fillOpacity={0.5} label={{ value: "decision window", fill: COLORS.wind, fontSize: 11, position: "insideTop" }} />
                  <Line
                    dataKey="mae_mw"
                    name="MAE"
                    stroke={COLORS.wind}
                    strokeWidth={2.2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    dataKey="bias_mw"
                    name="Bias"
                    stroke={COLORS.amber}
                    strokeWidth={1.7}
                    dot={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <div className="split-grid">
            <section className="card">
              <div className="card-head">
                <div>
                  <h3>Error percentiles</h3>
                  <p className="card-sub">Signed error, forecast minus actual. In-sample for January.</p>
                </div>
              </div>
              <div className="quantile-grid">
                {[
                  ["p05", "P5"],
                  ["p10", "P10"],
                  ["p25", "P25"],
                  ["p50", "P50"],
                  ["p75", "P75"],
                  ["p90", "P90"],
                  ["p95", "P95"],
                ].map(([key, label]) => (
                  <div className="quantile-cell" key={key}>
                    <span>{label}</span>
                    <b className={quantiles[key] > 0 ? "negative" : "positive"}>
                      {fmtSignedMW(quantiles[key])}
                    </b>
                  </div>
                ))}
              </div>
              <p className="muted small pad">
                Read: 1 half-hour in 10, wind came in more than {fmtMW(quantiles.p90)} below forecast.
                The 80% outcome band is the P10 to P90 range. It is in-sample, so treat it as a
                pilot estimate.
              </p>
            </section>

            <section className="card">
              <div className="card-head">
                <div>
                  <h3>Worst delivery days</h3>
                  <p className="card-sub">Ranked by MAE. Open a day to inspect the as-of decision.</p>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th className="num">MAE</th>
                      <th className="num">Bias</th>
                      <th className="num">Actual</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.worst_days.map((day) => (
                      <tr key={day.date}>
                        <td className="mono">{fmtShortDate(day.date)}</td>
                        <td className="num">{fmtMW(day.mae_mw)}</td>
                        <td className={`num ${day.bias_mw > 0 ? "negative" : "positive"}`}>
                          {fmtSignedMW(day.bias_mw)}
                        </td>
                        <td className="num muted">{fmtGW(day.mean_actual_mw)}</td>
                        <td className="num">
                          <button className="link-button" type="button" onClick={() => onOpenDay(day.date)}>
                            Open
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <section className="card scope-card">
            <div className="scope-icon"><InfoIcon width={20} height={20} /></div>
            <div>
              <h3>Scope note: read the bias carefully</h3>
              <p>
                WINDFOR is a forecast for wind farms visible to the ESO. FUELHH is metered
                transmission-connected generation. The difference includes forecast error, embedded
                or unconstrained wind, curtailment and timing. With the two datasets in scope we
                cannot separate those effects, so this pilot measures the <b>combined gap a buyer
                must plan for</b>. That is why the portal uses an empirical outcome band rather than
                a pure weather-error band.
              </p>
              <p className="muted small">
                Next production steps: add curtailment and embedded-wind data, calibrate on a rolling
                out-of-sample window, add demand and price forecasts, and connect the decision sheet
                to the trading system. This build is a decision-support pilot, not an automated
                trading system.
              </p>
            </div>
          </section>
        </>
      )}

      {data && summary.n === 0 && (
        <div className="notice">
          No scored settlement periods for this cutoff. Try an earlier cutoff so a forecast vintage
          exists.
        </div>
      )}
    </div>
  );
}
