# Methodology

## The question

For delivery day `D`, a UK utility must buy thermal cover before the day-ahead gate. It has a wind
forecast, but the forecast is not the outturn. Windline separates three things:

1. **What forecast was actually available** at the decision time.
2. **How large the miss has been**, in MW and in the shortfall direction.
3. **How much cover to buy** so the low-wind outcome is covered.

## Data

| Dataset | Publisher | Resolution | Role |
| --- | --- | --- | --- |
| `WINDFOR` | Elexon Insights / NESO | Hourly, 0–48 h ahead, multiple vintages | Forecast |
| `FUELHH` | Elexon Insights | Half-hourly, by fuel type | Actual |

Snapshot window: delivery **2026-01-01 to 2026-01-31**, Europe/London. Forecast rows were ingested
from 48 h before the window so that a 1 January delivery has a D-1 vintage. Actuals keep the latest
FUELHH revision per settlement period; forecasts keep every vintage for reproducibility.

Committed snapshot: **1,488** actual half-hours, **744** forecast target hours, **11,873** forecast
rows, **264** publish vintages. See `backend/data/meta.json`.

## 1. As-of forecast selection

For each delivery half-hour `T`:

```
decision_time(D) = D-1 at cutoff, Europe/London -> UTC
eligible = { (publishTime, value) for T : publishTime <= decision_time }
chosen   = eligible value with max(publishTime)
```

The default cutoff is **09:00**. The cutoff is adjustable; changing it re-selects vintages but not
the underlying data. A forecast published at 10:00 is never used for a 09:00 decision, even if it is
more accurate. This is the difference between a backtest and an honest as-of evaluation.

## 2. Hourly-to-half-hour alignment

`WINDFOR` is hourly; `FUELHH` is half-hourly. For each forecast target hour, the same MW value is
applied to both settlement periods in that hour. The join is by UTC target timestamp; display and
day grouping use `Europe/London`. January is GMT, so there is no DST transition in this window.

## 3. Error metrics

Error convention:

```
error = forecast - actual
```

Positive error = over-forecast = less wind than planned = shortfall risk. The metrics are computed
over half-hours with both a forecast and an actual.

| Metric | Formula | Interpretation |
| --- | --- | --- |
| MAE | `mean(abs(error))` | Average miss in MW |
| RMSE | `sqrt(mean(error^2))` | Penalises large misses |
| Bias | `mean(error)` | Directional average |
| WAPE | `sum(abs(error)) / sum(actual)` | Robust percentage error |
| P90 absolute | 90th percentile of `abs(error)` | Bad-but-not-worst miss |
| Over-forecast % | share of `error > 0` | How often the desk is short |

January 2026 snapshot: MAE **2,145.2 MW**, RMSE **2,615.8 MW**, bias **+1,851.9 MW**, WAPE
**18.52%**, P90 absolute **4,274.9 MW**, over-forecast **84.9%**, correlation **0.927**.

The bias is not uniform. Forecast ≥15 GW: **+2,797.0 MW** across 644 half-hours. Forecast <9 GW:
**+408.9 MW** across 318 half-hours. The worst delivery day is **2026-01-28** with MAE
**5,374.8 MW** and mean forecast 11,134.6 MW against mean actual 5,759.8 MW.

## 4. Uncertainty band

The 80% band is empirical and signed, not a normal approximation:

```
low  = max(0, forecast - P90(error))
high = max(0, forecast - P10(error))
```

For January 2026, `P10 = -544.1 MW`, `P90 = +4,274.9 MW`. Because the error distribution is skewed
positive, the band is wider below the forecast than above it. At a 15 GW forecast the band is roughly
10.7–15.5 GW. The lower edge is the number that matters for cover.

The band is **in-sample**: it is measured on the same month it describes. It is a pilot estimate,
not a production calibration. A production build would use a rolling out-of-sample window and
recalibrate as vintages arrive.

## 5. Decision math

Inputs: flat demand `D` (MW), forecast `F_t`, low outcome `L_t` (MW), half-hour duration 0.5 h.

```
central cover_t  = max(0, D - F_t) * 0.5   # MWh
low-wind cover_t = max(0, D - L_t) * 0.5   # MWh
reserve          = sum(low-wind cover) - sum(central cover)
```

At 35 GW demand for 15 Jan 2026: central **561.4 GWh**, low-wind **664.0 GWh**, reserve
**102.6 GWh**. This is the amount of extra thermal energy the desk would hold to cover the measured
P10 wind outcome, before portfolio and price considerations.

## 6. Scope caveat

`WINDFOR` forecasts wind farms visible to the ESO. `FUELHH` measures metered transmission-connected
generation. The difference includes:

- forecast skill and timing;
- unconstrained vs delivered wind;
- curtailment (constraints);
- embedded or distribution-connected wind that is not in the transmission meter.

With only these two datasets we cannot decompose the gap. Windline therefore treats the measured
error as the **combined planning risk** and labels it as such. This is a deliberate choice: an
unexplained bias correction would make the backtest look better and the decision worse. Adding
curtailment and embedded-wind data is the first production extension.

## 7. Validation and limits

- 32 pytest tests cover cutoff selection, hourly-to-half-hour mapping, band direction, metric
  identities, day/accuracy/evolution shapes and API contracts.
- One month is a small sample; results are descriptive, not statistically robust.
- Demand is an input; no demand forecast, price forecast, portfolio shape or trade execution.
- The app is decision support, not an automated trading system.

## 8. Reproduce

```bash
python3 backend/scripts/ingest.py --start 2026-01-01 --end 2026-01-31
cd backend && python3 -m pytest -q
uvicorn app.main:app --app-dir backend --port 8000
```
