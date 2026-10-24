# Architecture

## Shape

```
Browser (React/Vite/Recharts)
        |  /api/*  (fetch)
        v
FastAPI (backend/app/main.py)
        |
        v
analysis.py  <--  backend/data/*.csv  (committed snapshot)
        ^
        |
ingest.py (Elexon WINDFOR + FUELHH, offline/one-off)
```

There is no database and no runtime call to Elexon. January 2026 is fixed history; a committed CSV
snapshot makes the app deterministic, fast, free and reproducible. The same module powers the API,
the tests and the Docker image.

## Backend

### `analysis.py`

Deep module, pure standard library. It owns:

- `Dataset` and cached `load_dataset()`: parse actuals and forecast vintages, Europe/London helpers.
- `decision_time(day, cutoff)`: D-1 cutoff in UTC.
- `latest_forecast(series, decision)`: binary-search the latest eligible vintage.
- `build_points(ds, cutoff, start, end)`: one row per delivery half-hour with forecast, actual,
  error, publish time, lead time.
- `summarise`, `error_quantiles`, `histogram`, `band_from_quantiles`.
- `accuracy_report`, `day_view`, `evolution`, `horizon_report`, `meta`.
- `insights`: high/low wind bias, P90 shortfall, worst day.

`_band_for` maps signed error quantiles back to an outcome band:

```
low  = max(0, forecast - p90_error)
high = max(0, forecast - p10_error)
```

This direction is tested; getting it backwards would understate shortfall risk.

### `main.py`

FastAPI app, GZip, cache headers, input validation (`HH:MM`, January delivery days only). Serves the
SPA from `frontend/dist` when it exists. In Docker that is `/app/frontend/dist`; in local dev the
frontend runs on Vite and proxies `/api`.

Routes: `/api/health`, `/api/meta`, `/api/day`, `/api/accuracy`, `/api/horizon`, `/api/evolution`,
`/api/export.csv`.

## Frontend

- `App.jsx`: shell, tab routing, URL state (`view`, `day`, `cutoff`, `demand`), meta bootstrap.
- `DecisionDesk.jsx`: day/cutoff controls, as-of KPIs, forecast/uncertainty and residual charts,
  vintage evolution, hourly decision sheet, print/CSV.
- `ForecastQuality.jsx`: month chart, histogram, daily/hour/level/horizon breakdowns, percentile
  grid, worst days, scope note.
- `Method.jsx`: methodology and limits in-product.
- `hooks.js`: `useApi` with loading/error/reload, `useUrlState` for shareable links.
- `api.js`: fetch wrapper and en-GB formatters.

Charts use Recharts; there is no state library. Demand is the only client-side what-if; all forecast
and error numbers come from the API.

## Data contract (snapshot)

`backend/data/actuals.csv`: `target_time_utc, actual_mw` (latest FUELHH revision per period).

`backend/data/forecasts.csv`: `target_time_utc, publish_time_utc, forecast_mw` (every WINDFOR
vintage).

`backend/data/meta.json`: fetch timestamp, counts, source URLs, notes.

## Deployment

### Docker

Multi-stage: Node 20 builds `frontend/dist`; Python 3.12 installs `requirements.txt` (no test
dependencies), copies `backend/`, serves SPA + API with Uvicorn on port 8000. `backend/data` is
inside the image.

### Vercel

`vercel.json` builds the SPA to `frontend/dist`, exposes `api/index.py` as a Python 3.12 function and
includes `backend/**`. `api/index.py` adds `backend/` to `sys.path` and imports the same FastAPI app.
Rewrites send `/api/*` to the function.

## Testing

- `test_analysis.py`: cutoff eligibility, latest-vintage selection, hourly mapping, metric identities,
  band direction/monotonicity, day boundaries, evolution vintages, meta shape.
- `test_api.py`: health, meta, day/accuracy/evolution contracts, invalid cutoff/day, CSV export,
  static SPA fallback.

Run: `cd backend && python3 -m pytest -q` (32 passed).

## Trade-offs

| Choice | Why | Cost |
| --- | --- | --- |
| Snapshot in repo | Deterministic, no keys/rate limits, fast cold start | Refresh requires re-ingest |
| Pure stdlib analysis | Small serverless bundle, easy review | No pandas conveniences |
| Hourly forecast copied to both periods | Matches source resolution | No half-hourly forecast detail |
| Raw WINDFOR vs FUELHH | Honest about available data | Bias includes scope/curtailment |
| In-sample band | Simple, transparent pilot | Not out-of-sample calibrated |
| Flat demand input | Keeps scope on wind | No demand/price/portfolio model |
