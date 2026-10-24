# Demo script

Two recordings, each under 5 minutes. Record at 1440×900 with browser zoom 100%. Have the app open
on the decision desk for 15 Jan 2026 before you start.

## A. Customer pitch (≤5:00)

**0:00–0:25 — Hook**
> "A day-ahead wind forecast is not a number you can plan to. It is a number with a vintage, a lead
> time, and a measured miss. Windline is a decision desk that makes all three visible before you buy."

**0:25–1:10 — The problem**
- Show the two KPI rows. Point at **Wind forecast 278.6 GWh** and **80% range 176–292 GWh**.
- Say: "The point forecast is 278.6. The low outcome is 176. If you plan to the point, you are
  planning to be short in the scenario that hurts."
- Point at **Forecast vintage 07:30** and the snapshot strip: "This is the forecast the desk actually
  had at the 09:00 cutoff. No hindsight."

**1:10–2:10 — The decision**
- Set demand to **35 GW** (preset).
- Read **Residual to procure 561.4 GWh**, **Reserve for low wind 102.6 GWh**, **P90 shortfall 4,275 MW**.
- Say: "The desk buys 561 GWh to the central forecast, or 664 GWh if it wants to cover the low-wind
  outcome. The reserve is 103 GWh — that is the price of the measured miss, not a guess."
- Toggle **Reveal actual (hindsight)**. Say: "This is what actually happened. It is off by default
  because the decision was made without it."

**2:10–3:10 — The evidence**
- Click **Forecast quality**.
- Point at **Bias +1,852 MW**, **Over-forecast 85%**, **MAE 2,145 MW**.
- Say: "The forecast ran high in 85% of half-hours. High-wind hours carry +2.8 GW of bias. That is
  where the shortfall risk sits."
- Scroll to the month chart and the worst days. Say: "28 January missed by 5.4 GW on average."

**3:10–4:00 — Why it happens**
- Scroll to **Scope note**. Say: "WINDFOR is a forecast for wind farms visible to the ESO. FUELHH is
  metered transmission output. The gap includes curtailment and embedded wind. We do not hide that
  in a correction factor; we size cover against the combined risk."

**4:00–4:40 — The product**
- Open **Method**. Say: "The method is in the product, not a PDF. Adjustable cutoff, signed error,
  signed band, CSV export, print-ready decision sheet."
- Show the URL state: change day and cutoff; copy URL. Say: "Every view is shareable."

**4:40–5:00 — Close**
> "Windline does not forecast the wind. It makes the forecast's timing and miss explicit, so a buyer
> can size the trade. Next: curtailment data, out-of-sample calibration, demand and prices."

## B. Technical review (≤5:00)

**0:00–0:40 — Architecture**
- Show the README architecture block. Say: "React/Vite → FastAPI → a pure-stdlib analysis module over
  a committed Elexon snapshot. No database, no live API calls at runtime. Docker or Vercel."

**0:40–1:40 — As-of selection**
- Open `backend/app/analysis.py`, show `decision_time` and `latest_forecast`/`build_points`.
- Say: "Latest publishTime ≤ D-1 09:00 Europe/London. Later vintages are ignored. The selected
  publish time is returned on every point, so the UI cannot accidentally use hindsight."

**1:40–2:40 — Alignment and band**
- Show the hourly-to-half-hour mapping and `_band_for`.
- Say: "WINDFOR is hourly; both settlement periods get the same value. The band is forecast minus
  P90/P10 of signed error, with low = forecast - P90. There is a regression test for the direction."

**2:40–3:30 — Tests and reproducibility**
- Run `cd backend && python3 -m pytest -q` (32 passed).
- Say: "Tests cover cutoff selection, alignment, metric identities, band direction, API contracts and
  CSV export. The ingest script rebuilds the snapshot; no numbers are hand-entered."

**3:30–4:20 — Deploy**
- Show `Dockerfile`, `vercel.json`, `api/index.py`.
- Say: "One container serves the SPA and API. On Vercel the same FastAPI app is a Python 3.12
  function with backend/** included."

**4:20–5:00 — Limits**
- Show `docs/methodology.md` limits.
- Say: "In-sample band, one month, no curtailment decomposition, flat demand, no execution. The app
  labels these rather than pretending they are solved. The next step is out-of-sample calibration
  and curtailment data."

## Production notes

- Use a clean browser profile; hide bookmarks.
- Pre-load the pages before recording; wait for charts.
- Keep the cursor still while reading numbers.
- If a number differs, use the value on screen; the committed snapshot is the source of truth.
- Upload as **unlisted** YouTube; put the URL in the README.
