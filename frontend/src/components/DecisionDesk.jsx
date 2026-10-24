import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { downloadCsv, fmtDate, fmtDateTime, fmtGWh, fmtGW, fmtMW, fmtTime } from "../api.js";
import { useApi } from "../hooks.js";
import ChartCard from "./ChartCard.jsx";
import ChartTooltip from "./ChartTooltip.jsx";
import Kpi from "./Kpi.jsx";
import Status from "./Status.jsx";
import { AlertIcon, ArrowIcon, DownloadIcon, GaugeIcon, PrintIcon, WindIcon } from "./Icons.jsx";

const COLORS = {
  wind: "#0f766e",
  windSoft: "#99f6e4",
  actual: "#334155",
  blue: "#2563eb",
  amber: "#d97706",
  amberSoft: "#fde68a",
  slate: "#94a3b8",
  grid: "#e2e8f0",
  axis: "#64748b",
};

const SNAPSHOT_STYLE = {
  latest: { label: "Latest at cutoff", color: COLORS.wind, dash: false, width: 2.6 },
  previous: { label: "Previous vintage", color: COLORS.blue, dash: true, width: 1.7 },
  day_before: { label: "24h earlier", color: COLORS.slate, dash: true, width: 1.5 },
  oldest: { label: "Oldest vintage", color: "#cbd5e1", dash: true, width: 1.3 },
  other: { label: "Vintage", color: COLORS.slate, dash: true, width: 1.3 },
};

const sum = (values) => values.reduce((total, value) => total + value, 0);
const mean = (values) => (values.length ? sum(values) / values.length : null);

function hourRows(points) {
  const rows = [];
  for (let index = 0; index < points.length; index += 2) {
    const pair = points.slice(index, index + 2);
    if (!pair.length) continue;
    const central = sum(pair.map((point) => point.central)) * 0.5;
    const hedged = pair.every((point) => point.hedged != null)
      ? sum(pair.map((point) => point.hedged)) * 0.5
      : null;
    rows.push({
      hour: fmtTime(pair[0].t),
      forecast: mean(pair.map((point) => point.forecast_mw)),
      low: mean(pair.map((point) => point.low_mw).filter((value) => value != null)),
      high: mean(pair.map((point) => point.high_mw).filter((value) => value != null)),
      central,
      hedged,
    });
  }
  return rows;
}

export default function DecisionDesk({
  meta,
  day,
  setDay,
  cutoff,
  demand,
  setDemand,
  showActual,
  setShowActual,
  onOpenQuality,
}) {
  const dayState = useApi("day", { day, cutoff });
  const evolutionState = useApi("evolution", { day, cutoff });
  const data = dayState.data;

  const points = useMemo(
    () =>
      (data?.points ?? []).map((point) => ({
        ...point,
        time: fmtTime(point.t),
        central: Math.max(0, demand - point.forecast_mw),
        hedged: point.low_mw == null ? null : Math.max(0, demand - point.low_mw),
        actualResidual: point.actual_mw == null ? null : Math.max(0, demand - point.actual_mw),
      })),
    [data, demand]
  );

  const centralMwh = sum(points.map((point) => point.central)) * 0.5;
  const hedgedMwh = points.length && points.every((point) => point.hedged != null)
    ? sum(points.map((point) => point.hedged)) * 0.5
    : null;
  const extraMwh = hedgedMwh == null ? null : hedgedMwh - centralMwh;
  const averageResidualMw = centralMwh / (points.length * 0.5 || 1);
  const cutoffLeadH = data
    ? (new Date(data.decision_time_utc) - new Date(data.latest_publish)) / 3600000
    : null;
  const lowGwh = data?.kpis.low_mwh != null ? data.kpis.low_mwh / 1000 : null;
  const highGwh = data?.kpis.high_mwh != null ? data.kpis.high_mwh / 1000 : null;

  const chartData = points.map((point) => ({
    time: point.time,
    t: point.t,
    forecast: point.forecast_mw,
    band: point.low_mw != null ? [point.low_mw, point.high_mw] : null,
    actual: showActual ? point.actual_mw : null,
  }));

  const residualData = points.map((point) => ({
    time: point.time,
    t: point.t,
    central: point.central,
    hedged: point.hedged,
    actual: showActual ? point.actualResidual : null,
  }));

  const hourly = useMemo(() => hourRows(points), [points]);

  const snapshots = evolutionState.data?.snapshots ?? [];
  const evolutionData = (snapshots[0]?.points ?? []).map((point, index) => {
    const row = {
      time: fmtTime(point.t),
      actual: evolutionState.data?.actual?.[index]?.actual_mw ?? null,
    };
    for (const snapshot of snapshots) {
      row[snapshot.kind] = snapshot.points[index]?.forecast_mw ?? null;
    }
    return row;
  });

  const print = () => window.print();

  const downloadDecision = () => {
    const rows = [
      [
        "delivery_day",
        "target_time_utc",
        "target_time_uk",
        "forecast_mw",
        "low_mw",
        "high_mw",
        "central_cover_mwh",
        "hedged_cover_mwh",
        "actual_mw",
      ],
    ];
    for (const point of points) {
      rows.push([
        day,
        point.t,
        new Date(point.t).toLocaleString("en-GB", { timeZone: "Europe/London" }),
        point.forecast_mw,
        point.low_mw,
        point.high_mw,
        point.central * 0.5,
        point.hedged == null ? "" : point.hedged * 0.5,
        showActual ? point.actual_mw ?? "" : "",
      ]);
    }
    downloadCsv(`windline_decision_${day}.csv`, rows);
  };

  const decisionText = data ? (
    <>
      For delivery on <b>{fmtDate(day)}</b>, the latest WINDFOR vintage available at the{" "}
      <b>{cutoff}</b> D-1 cutoff was published <b>{fmtDateTime(data.latest_publish)}</b>. It implies{" "}
      <b>{fmtGWh(data.kpis.forecast_mwh)}</b> of wind across the day, with an 80% range of{" "}
      <b>{fmtGWh(data.kpis.low_mwh)}</b> to <b>{fmtGWh(data.kpis.high_mwh)}</b>. At{" "}
      <b>{fmtGW(demand)}</b> flat demand, the central thermal requirement is{" "}
      <b>{fmtGWh(centralMwh)}</b>. Holding cover to the low-wind case lifts that to{" "}
      <b>{fmtGWh(hedgedMwh)}</b>, a <b>{fmtGWh(extraMwh)}</b> reserve for forecast risk.
    </>
  ) : null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Decision desk</span>
          <h2>Next-day wind position</h2>
          <p>
            Pick a delivery day, see the forecast the desk actually had at the D-1 cutoff, and size
            the residual thermal cover including the measured error.
          </p>
        </div>
        <div className="page-head-actions">
          <button className="button ghost" type="button" onClick={downloadDecision} disabled={!data}>
            <DownloadIcon width={17} height={17} /> Decision sheet
          </button>
          <button className="button ghost" type="button" onClick={print} disabled={!data}>
            <PrintIcon width={17} height={17} /> Print
          </button>
          <button className="button" type="button" onClick={onOpenQuality}>
            Forecast accuracy <ArrowIcon width={17} height={17} />
          </button>
        </div>
      </div>

      <div className="control-bar card">
        <label className="field">
          <span>Delivery day</span>
          <input
            type="date"
            value={day}
            min={meta.first_day}
            max={meta.last_day}
            onChange={(event) => event.target.value && setDay(event.target.value)}
          />
        </label>
        <label className="field demand-field">
          <span>Demand to serve (MW)</span>
          <input
            type="number"
            min="0"
            step="500"
            value={demand}
            onChange={(event) => setDemand(Math.max(0, Number(event.target.value) || 0))}
          />
        </label>
        <div className="presets" aria-label="Demand presets">
          {[20000, 30000, 35000, 40000].map((value) => (
            <button
              key={value}
              type="button"
              className={demand === value ? "preset on" : "preset"}
              onClick={() => setDemand(value)}
            >
              {value / 1000} GW
            </button>
          ))}
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={showActual}
            onChange={(event) => setShowActual(event.target.checked)}
          />
          <span className="switch-track" aria-hidden="true" />
          Reveal actual (hindsight)
        </label>
        <div className="control-note">
          <GaugeIcon width={17} height={17} />
          Cutoff <b>{cutoff}</b> UK, set in the top bar
        </div>
      </div>

      <Status state={dayState} />

      {data && (
        <>
          <div className="snapshot-strip">
            <span className="live-dot" aria-hidden="true" />
            <span>
              <b>As-of snapshot.</b> Decision {fmtDateTime(data.decision_time_utc)}. Latest usable
              forecast {fmtDateTime(data.latest_publish)}. Lead time{" "}
              {data.kpis.horizon_min_h?.toFixed(1)}–{data.kpis.horizon_max_h?.toFixed(1)} hours.
            </span>
            <span className="snapshot-tag">No hindsight</span>
          </div>

          <div className="kpi-grid">
            <Kpi
              tone="teal"
              icon={<WindIcon width={16} height={16} />}
              label="Wind forecast"
              value={fmtGWh(data.kpis.forecast_mwh)}
              hint={`Peak ${fmtGW(data.kpis.peak_forecast_mw)} · latest vintage`}
            />
            <Kpi
              label="80% wind range"
              value={lowGwh == null || highGwh == null ? "–" : `${lowGwh.toFixed(0)}–${highGwh.toFixed(0)} GWh`}
              hint="P10–P90 of measured error"
            />
            <Kpi
              label="Residual to procure"
              value={fmtGWh(centralMwh)}
              hint={`${fmtGW(averageResidualMw)} average at this demand`}
            />
            <Kpi
              tone="amber"
              label="Reserve for low wind"
              value={fmtGWh(extraMwh)}
              hint={hedgedMwh == null ? "Band unavailable" : `${fmtGWh(hedgedMwh)} hedged total`}
            />
            <Kpi
              label="P90 shortfall"
              value={fmtMW(data.kpis.p90_shortfall_mw)}
              hint="Wind below forecast 1 half-hour in 10"
            />
            <Kpi
              label="Forecast vintage"
              value={fmtTime(data.latest_publish)}
              hint={`${cutoffLeadH?.toFixed(1)}h before cutoff · ${data.kpis.horizon_min_h?.toFixed(1)}–${data.kpis.horizon_max_h?.toFixed(1)}h ahead`}
            />
          </div>

          <div className="chart-grid">
            <ChartCard
              title="Wind forecast and measured uncertainty"
              subtitle="Forecast the desk had at the cutoff. Shaded band is the empirical P10–P90 outcome range."
              className="span-2"
            >
              <div className="chart-wrap" role="img" aria-label="Half-hourly wind forecast with an 80 percent uncertainty band">
                <ResponsiveContainer width="100%" height={330}>
                  <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={COLORS.grid} />
                    <XAxis dataKey="time" minTickGap={36} tick={{ fontSize: 11, fill: COLORS.axis }} tickLine={false} axisLine={{ stroke: COLORS.grid }} />
                    <YAxis
                      tickFormatter={(value) => `${value / 1000} GW`}
                      tick={{ fontSize: 11, fill: COLORS.axis }}
                      tickLine={false}
                      axisLine={false}
                      width={58}
                    />
                    <Tooltip content={<ChartTooltip valueFormatter={(value) => (Array.isArray(value) ? `${fmtMW(value[0])} – ${fmtMW(value[1])}` : fmtMW(value))} />} />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="plainline" />
                    <Area
                      dataKey="band"
                      name="80% outcome range"
                      stroke="none"
                      fill={COLORS.windSoft}
                      fillOpacity={0.55}
                      isAnimationActive={false}
                    />
                    <Line
                      dataKey="forecast"
                      name="Forecast at cutoff"
                      stroke={COLORS.wind}
                      strokeWidth={2.6}
                      dot={false}
                      isAnimationActive={false}
                    />
                    {showActual && (
                      <Line
                        dataKey="actual"
                        name="Actual wind"
                        stroke={COLORS.actual}
                        strokeWidth={2}
                        strokeDasharray="5 4"
                        dot={false}
                        isAnimationActive={false}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <ChartCard
              title="Residual cover to procure"
              subtitle={`Demand minus wind. Central uses the forecast; hedged uses the low end of the 80% wind range.`}
              className="span-2"
            >
              <div className="chart-wrap" role="img" aria-label="Half-hourly residual thermal cover, central and hedged">
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={residualData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={COLORS.grid} />
                    <XAxis dataKey="time" minTickGap={36} tick={{ fontSize: 11, fill: COLORS.axis }} tickLine={false} axisLine={{ stroke: COLORS.grid }} />
                    <YAxis
                      tickFormatter={(value) => `${value / 1000} GW`}
                      tick={{ fontSize: 11, fill: COLORS.axis }}
                      tickLine={false}
                      axisLine={false}
                      width={52}
                    />
                    <Tooltip content={<ChartTooltip valueFormatter={(value) => fmtMW(value)} />} />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="plainline" />
                    <ReferenceLine y={0} stroke={COLORS.slate} />
                    <Area
                      dataKey="hedged"
                      name="Hedged cover"
                      stroke={COLORS.amber}
                      fill={COLORS.amber}
                      fillOpacity={0.1}
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                    <Area
                      dataKey="central"
                      name="Central cover"
                      stroke={COLORS.blue}
                      fill={COLORS.blue}
                      fillOpacity={0.08}
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                    {showActual && (
                      <Line
                        dataKey="actual"
                        name="Actual residual"
                        stroke={COLORS.actual}
                        strokeWidth={1.8}
                        strokeDasharray="5 4"
                        dot={false}
                        isAnimationActive={false}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          </div>

          <div className="split-grid">
            <section className="card decision-card">
              <div className="decision-icon"><AlertIcon width={20} height={20} /></div>
              <div>
                <span className="eyebrow">Decision note</span>
                <h3 className="decision-title">Size the buy, not just the forecast</h3>
                <p className="decision-text">{decisionText}</p>
                <p className="muted small">
                  Demand is an input, not a forecast. The wind band comes from the same month's
                  measured errors, so it includes the WINDFOR/FUELHH scope gap and curtailment risk.
                  Treat it as a pilot estimate, not a production limit.
                </p>
                <div className="decision-actions">
                  <button className="button" type="button" onClick={print}>
                    <PrintIcon width={16} height={16} /> Print decision sheet
                  </button>
                  <button className="button ghost" type="button" onClick={downloadDecision}>
                    <DownloadIcon width={16} height={16} /> CSV
                  </button>
                </div>
              </div>
            </section>

            <ChartCard
              title="How the forecast changed"
              subtitle="WINDFOR vintages available before the cutoff. The latest line is the one used above."
            >
              <Status state={evolutionState} compact />
              {evolutionState.data && (
                <div className="chart-wrap" role="img" aria-label="Forecast evolution across vintages">
                  <ResponsiveContainer width="100%" height={250}>
                    <ComposedChart data={evolutionData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={COLORS.grid} />
                      <XAxis dataKey="time" minTickGap={36} tick={{ fontSize: 11, fill: COLORS.axis }} tickLine={false} axisLine={{ stroke: COLORS.grid }} />
                      <YAxis
                        tickFormatter={(value) => `${value / 1000} GW`}
                        tick={{ fontSize: 11, fill: COLORS.axis }}
                        tickLine={false}
                        axisLine={false}
                        width={52}
                      />
                      <Tooltip content={<ChartTooltip valueFormatter={(value) => fmtMW(value)} />} />
                      <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="plainline" />
                      {snapshots.map((snapshot) => {
                        const style = SNAPSHOT_STYLE[snapshot.kind] ?? SNAPSHOT_STYLE.other;
                        return (
                          <Line
                            key={`${snapshot.kind}-${snapshot.publish_time}`}
                            dataKey={snapshot.kind}
                            name={style.label}
                            stroke={style.color}
                            strokeWidth={style.width}
                            strokeDasharray={style.dash ? "4 4" : undefined}
                            dot={false}
                            connectNulls
                            isAnimationActive={false}
                          />
                        );
                      })}
                      {showActual && (
                        <Line
                          dataKey="actual"
                          name="Actual wind"
                          stroke={COLORS.actual}
                          strokeWidth={1.8}
                          strokeDasharray="5 4"
                          dot={false}
                          isAnimationActive={false}
                        />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ChartCard>
          </div>

          <section className="card table-card">
            <div className="card-head">
              <div>
                <h3>Hourly decision sheet</h3>
                <p className="card-sub">
                  Settlement periods are paired for readability. Cover is MWh over the hour at the
                  demand you entered.
                </p>
              </div>
              <span className="badge">{hourly.length} hours</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Hour (UK)</th>
                    <th className="num">Forecast</th>
                    <th className="num">80% low</th>
                    <th className="num">80% high</th>
                    <th className="num">Central cover</th>
                    <th className="num">Hedged cover</th>
                  </tr>
                </thead>
                <tbody>
                  {hourly.map((row) => (
                    <tr key={row.hour}>
                      <td className="mono">{row.hour}</td>
                      <td className="num">{fmtMW(row.forecast)}</td>
                      <td className="num muted">{fmtMW(row.low)}</td>
                      <td className="num muted">{fmtMW(row.high)}</td>
                      <td className="num">{fmtGWh(row.central)}</td>
                      <td className="num">{fmtGWh(row.hedged)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Day mean / total</td>
                    <td className="num">{fmtMW(mean(points.map((point) => point.forecast_mw)))}</td>
                    <td className="num">{fmtMW(mean(points.map((point) => point.low_mw).filter((value) => value != null)))}</td>
                    <td className="num">{fmtMW(mean(points.map((point) => point.high_mw).filter((value) => value != null)))}</td>
                    <td className="num">{fmtGWh(centralMwh)}</td>
                    <td className="num">{fmtGWh(hedgedMwh)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <div className="footnote">
            <InfoLine>
              Error is measured as forecast minus actual. Positive means the forecast was high and the
              desk is short. The band is built from the full January sample, not a separate holdout.
            </InfoLine>
          </div>
        </>
      )}
    </div>
  );
}

function InfoLine({ children }) {
  return (
    <p className="inline-note">
      <span className="inline-note-dot" aria-hidden="true" />
      {children}
    </p>
  );
}
